import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import dns from "node:dns/promises";
import net from "node:net";
import { spawn } from "node:child_process";

const PORT=Number(process.env.PORT||10000), TOKEN=process.env.MERGER_API_TOKEN||"";
const RETENTION=24*60*60*1000, MAX_BYTES=500*1024*1024, jobs=new Map(), locks=new Set();
function send(res,status,data){res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});res.end(JSON.stringify(data));}
function auth(req){const v=Buffer.from(req.headers.authorization||""),e=Buffer.from("Bearer "+TOKEN);return !!TOKEN&&v.length===e.length&&timingSafeEqual(v,e);}
function privateIp(ip){
 if(net.isIPv4(ip)){const [a,b]=ip.split(".").map(Number);return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127);}
 const x=ip.toLowerCase();return x==="::"||x==="::1"||x.startsWith("fc")||x.startsWith("fd")||/^fe[89ab]/.test(x)||x.startsWith("::ffff:127.")||x.startsWith("::ffff:10.");
}
async function publicUrl(value){
 let u;try{u=new URL(value);}catch{throw Error("Invalid video URL");}
 if(!["http:","https:"].includes(u.protocol)||u.username||u.password)throw Error("Only public HTTP(S) URLs are allowed");
 const h=u.hostname.toLowerCase();if(h==="localhost"||h.endsWith(".localhost")||h.endsWith(".local"))throw Error("Private host rejected");
 const ips=net.isIP(h)?[{address:h}]:await dns.lookup(h,{all:true,verbatim:true});
 if(!ips.length||ips.some(x=>privateIp(x.address)))throw Error("URL resolves to a private address");
 return u;
}
async function download(url,file){
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),120000);
 try{
  const r=await fetch(url,{signal:c.signal,redirect:"error"});if(!r.ok||!r.body)throw Error("Could not download source clip");
  if(Number(r.headers.get("content-length")||0)>MAX_BYTES)throw Error("Source clip exceeds 500 MB");
  const f=await fs.open(file,"w");let n=0;
  try{for await(const chunk of r.body){n+=chunk.length;if(n>MAX_BYTES)throw Error("Source clip exceeds 500 MB");await f.write(chunk);}}finally{await f.close();}
 }finally{clearTimeout(timer);}
}
function execFfmpeg(args){return new Promise((resolve,reject)=>{const p=spawn("ffmpeg",args,{stdio:["ignore","ignore","pipe"]});let err="";p.stderr.on("data",d=>err=(err+d.toString()).slice(-4000));p.on("error",reject);p.on("close",code=>code===0?resolve():reject(Error(err||"FFmpeg failed")));});}
async function processJob(j){
 if(locks.has(j.id))return;locks.add(j.id);const dir=await fs.mkdtemp(path.join(os.tmpdir(),"merger-"));j.status="processing";j.progress=1;
 try{
  const inputs=[];
  for(let i=0;i<j.videos.length;i++){const u=await publicUrl(j.videos[i]);const f=path.join(dir,"clip-"+i+".mp4");await download(u.href,f);inputs.push(f);j.progress=Math.round((i+1)/j.videos.length*35);}
  const args=[];for(const f of inputs)args.push("-i",f);
  const filters=inputs.map((_,i)=>"["+i+":v:0]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v"+i+"];["+i+":a:0]aresample=48000[a"+i+"]").join(";");
  const concat=inputs.map((_,i)=>"[v"+i+"][a"+i+"]").join("")+"concat=n="+inputs.length+":v=1:a=1[v][a]";
  const output=path.join(dir,"merged.mp4");args.push("-filter_complex",filters+";"+concat,"-map","[v]","-map","[a]","-c:v","libx264","-preset","veryfast","-crf","18","-c:a","aac","-b:a","192k","-movflags","+faststart","-t","3600",output);
  j.progress=40;await execFfmpeg(args);const st=await fs.stat(output);j.outputPath=output;j.outputSize=st.size;j.directory=dir;j.status="completed";j.progress=100;j.expiresAt=new Date(Date.now()+RETENTION).toISOString();
 }catch(e){j.status="failed";j.error=String(e?.message||"Merge failed").slice(0,500);await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});}finally{locks.delete(j.id);}
}
const server=http.createServer(async(req,res)=>{
 if(req.url==="/health"&&req.method==="GET")return send(res,200,{status:"ok",service:"merger-api-v2"});
 if(!auth(req))return send(res,401,{error:"Unauthorized"});
 const u=new URL(req.url||"/","http://localhost");
 if(u.pathname==="/api/jobs"&&req.method==="POST"){
  let raw="";for await(const c of req){raw+=c;if(raw.length>200000)return send(res,413,{error:"Request too large"});}
  let data;try{data=JSON.parse(raw);}catch{return send(res,400,{error:"Invalid JSON"});}
  if(!Array.isArray(data.videos)||data.videos.length<2||data.videos.length>10||data.videos.some(x=>typeof x!=="string"))return send(res,400,{error:"Provide 2 to 10 video URLs"});
  const id=randomUUID();jobs.set(id,{id,videos:data.videos,status:"queued",progress:0,createdAt:Date.now()});return send(res,201,{jobId:id,status:"queued"});
 }
 const m=u.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)(?:\/(process|download))?$/i);if(!m)return send(res,404,{error:"Not found"});
 const j=jobs.get(m[1]);if(!j)return send(res,404,{error:"Job not found"});
 if(req.method==="POST"&&m[2]==="process"){if(j.status==="queued")void processJob(j);return send(res,202,{jobId:j.id,status:j.status});}
 if(req.method==="GET"&&!m[2])return send(res,200,{jobId:j.id,status:j.status,progress:j.progress,videoUrl:j.status==="completed"?"/api/jobs/"+j.id+"/download":null,expiresAt:j.expiresAt||null,error:j.error||null});
 if(req.method==="GET"&&m[2]==="download"){if(j.status!=="completed"||!j.outputPath)return send(res,409,{error:"Video is not ready"});res.writeHead(200,{"content-type":"video/mp4","content-length":j.outputSize,"content-disposition":'attachment; filename="merged.mp4"',"cache-control":"private, max-age=300"});return createReadStream(j.outputPath).on("error",()=>res.destroy()).pipe(res);}
 return send(res,405,{error:"Method not allowed"});
});
setInterval(async()=>{const cutoff=Date.now()-RETENTION;for(const [id,j] of jobs)if(j.createdAt<cutoff&&!locks.has(id)){if(j.directory)await fs.rm(j.directory,{recursive:true,force:true}).catch(()=>{});jobs.delete(id);}},3600000).unref();
server.listen(PORT,"0.0.0.0",()=>console.log("Merger API v2 listening on "+PORT));
