import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { LIMITS, mergeSchema, getDb, setProgress, storeBlob, readBlob, CHUNK_BYTES } from "@/lib/merge-store";

function binPath(value:string|null|undefined){ if(!value) throw new Error("FFmpeg binary is unavailable"); return value; }
async function ensureExecutable(binary:string,name:string){const target=path.join(os.tmpdir(),name);try{await fs.access(target);await fs.chmod(target,0o755);}catch{await fs.copyFile(binary,target);await fs.chmod(target,0o755);}return target;}
function run(bin:string,args:string[],onProgress?:(line:string)=>void){
 return new Promise<void>((resolve,reject)=>{
  const p=spawn(bin,args,{stdio:["ignore","pipe","pipe"]}); let err="";
  p.stdout.on("data",d=>{for(const line of d.toString().split(/\r?\n/)) if(line) onProgress?.(line);});
  p.stderr.on("data",d=>{err=(err+d.toString()).slice(-8000);});
  p.on("error",reject); p.on("close",code=>code===0?resolve():reject(new Error(err||"FFmpeg execution failed")));
 });
}
async function probe(file:string){
 const probeBin=await ensureExecutable(binPath(ffprobeStatic.path),"ffprobe");
 const out=await new Promise<string>((resolve,reject)=>{
  const p=spawn(probeBin,["-v","error","-show_streams","-show_format","-of","json",file],{stdio:["ignore","pipe","pipe"]});
  let data="",err="";p.stdout.on("data",d=>data+=d);p.stderr.on("data",d=>err+=d);p.on("error",reject);p.on("close",c=>c===0?resolve(data):reject(new Error(err)));
 });
 const x=JSON.parse(out);const v=x.streams.find((s:any)=>s.codec_type==="video");if(!v)throw new Error("Source has no video stream");
 return {width:Number(v.width),height:Number(v.height),duration:Number(x.format.duration||v.duration||0),hasAudio:x.streams.some((s:any)=>s.codec_type==="audio")};
}
export async function processMerge(id:string){
 await mergeSchema();const db=getDb();const lock=await db.execute({sql:"UPDATE jobs SET status='processing',progress=1 WHERE id=? AND status IN ('queued','uploading','failed')",args:[id]});
 const jr=await db.execute({sql:"SELECT * FROM jobs WHERE id=?",args:[id]});if(!jr.rows.length)throw new Error("المهمة غير موجودة");
 const sources=await db.execute({sql:"SELECT * FROM sources WHERE job_id=? ORDER BY seq",args:[id]});
 if(sources.rows.length<2)throw new Error("أضف مصدرين على الأقل");
 if(sources.rows.length>LIMITS.maxSources)throw new Error("تجاوز عدد المصادر المسموح");
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"video-merge-"));const inputs:string[]=[];
 try{
  let downloaded=0;const total=sources.rows.length;
  for(let i=0;i<total;i++){
   const s=sources.rows[i];const file=path.join(dir,"input-"+i+".mp4");let buf:Buffer;
   if(s.kind==="file") buf=await readBlob("source_chunks",id,Number(s.seq));
   else{
    const url=new URL(String(s.url));if(!["http:","https:"].includes(url.protocol))throw new Error("رابط المصدر غير صالح");
    const res=await fetch(url,{redirect:"error"});if(!res.ok)throw new Error("تعذر تنزيل المصدر "+(i+1));
    const arr=await res.arrayBuffer();buf=Buffer.from(arr);
   }
   if(buf.length>LIMITS.sourceMaxBytes)throw new Error("حجم أحد المصادر يتجاوز الحد");
   if(s.kind==="file" && buf.length!==Number(s.size))throw new Error("لم يكتمل رفع الملف؛ أعد رفع الأجزاء الناقصة");
   await fs.writeFile(file,buf);inputs.push(file);downloaded+=buf.length;
   await setProgress(id,"processing",Math.round(40*(i+1)/total));
  }
  const metadata=[];for(const f of inputs)metadata.push(await probe(f));
  const duration=metadata.reduce((a,b)=>a+b.duration,0);if(duration>LIMITS.maxDuration)throw new Error("المدة الإجمالية تتجاوز الحد المسموح");
  const width=Math.min(1920,Math.max(...metadata.map(x=>x.width)));const height=Math.min(1080,Math.max(...metadata.map(x=>x.height)));
  const w=width%2?width-1:width,h=height%2?height-1:height;
  const args=["-y"];for(const f of inputs)args.push("-i",f);
  const filters:string[]=[];const concatInputs:string[]=[];
  metadata.forEach((m,i)=>{
   filters.push(`[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1,format=yuv420p[v${i}]`);
   if(m.hasAudio){filters.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);}
   else{filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=${m.duration},asetpts=PTS-STARTPTS[a${i}]`);}
   concatInputs.push(`[v${i}][a${i}]`);
  });
  filters.push(concatInputs.join("")+`concat=n=${inputs.length}:v=1:a=1[outv][outa]`);
  const output=path.join(dir,"merged.mp4");
  args.push("-filter_complex",filters.join(";"),"-map","[outv]","-map","[outa]","-c:v","libx264","-preset",process.env.FFMPEG_PRESET||"medium","-crf","18","-c:a","aac","-b:a","192k","-ar","44100","-movflags","+faststart","-progress","pipe:1","-nostats",output);
  await run(await ensureExecutable(binPath(ffmpegPath),"ffmpeg"),args,line=>{
   if(line.startsWith("out_time_us=")){const t=Number(line.slice(12))/1e6;const pct=40+Math.min(50,Math.floor(50*t/Math.max(duration,0.1)));void setProgress(id,"processing",pct);}
  });
  const stat=await fs.stat(output);if(stat.size>LIMITS.outputMaxBytes)throw new Error("حجم الفيديو الناتج يتجاوز الحد");
  const out=await fs.readFile(output);await storeBlob("output_chunks",id,0,out);
  await db.execute({sql:"UPDATE jobs SET status='done',progress=100,output_size=?,duration=?,width=?,height=? WHERE id=?",args:[out.length,duration,w,h,id]});
  await db.execute({sql:"DELETE FROM source_chunks WHERE job_id=?",args:[id]});
  return {status:"done",size:out.length,duration,resolution:w+"x"+h};
 }catch(e){await setProgress(id,"failed",0,e instanceof Error?e.message:"فشل الدمج");throw e;}
 finally{await fs.rm(dir,{recursive:true,force:true});}
}
