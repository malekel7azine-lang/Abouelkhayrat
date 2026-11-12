const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const fs=require("node:fs/promises");
const os=require("node:os");
const path=require("node:path");
const crypto=require("node:crypto");
const ffmpeg=require("ffmpeg-static");
const base=process.env.SMOKE_BASE_URL||"http://127.0.0.1:3000";
function run(bin,args){return new Promise((resolve,reject)=>{const p=spawn(bin,args,{stdio:"ignore"});p.on("error",reject);p.on("close",c=>c===0?resolve():reject(Error("ffmpeg failed")));});}
async function json(url,options){const r=await fetch(url,options);const body=await r.json().catch(()=>({}));return {r,body};}
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"merge-http-"));
 try{
  const a=path.join(dir,"a.mp4"),b=path.join(dir,"b.mp4");
  await run(ffmpeg,["-y","-f","lavfi","-i","testsrc2=size=320x240:rate=24:duration=1","-f","lavfi","-i","sine=frequency=440:duration=1","-shortest","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac",a]);
  await run(ffmpeg,["-y","-f","lavfi","-i","testsrc2=size=640x360:rate=25:duration=1","-an","-c:v","libx264","-pix_fmt","yuv420p",b]);
  const fa=await fs.readFile(a),fb=await fs.readFile(b);
  let x=await json(base+"/api/jobs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sources:[{kind:"file",name:"a.mp4",size:fa.length,mime:"video/mp4"},{kind:"file",name:"b.mp4",size:fb.length,mime:"video/mp4"}]})});
  assert.equal(x.r.status,201);const id=x.body.jobId;assert.ok(id);
  const badChunk=await fetch(base+"/api/upload?job="+id+"&seq=0&chunk=0",{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:Buffer.from("x")});assert.equal(badChunk.status,400);
  for(const [seq,buf] of [[0,fa],[1,fb]]){const up=await fetch(base+"/api/upload?job="+id+"&seq="+seq+"&chunk=0",{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:buf});assert.equal(up.status,200);}
  x=await json(base+"/api/jobs/"+id+"/process",{method:"POST"});assert.equal(x.r.status,200);assert.equal(x.body.status,"done");assert.equal(x.body.resolution,"640x360");
  const full=await fetch(base+"/api/jobs/"+id+"/video");assert.equal(full.status,200);const output=Buffer.from(await full.arrayBuffer());const digest=crypto.createHash("sha256").update(output).digest("hex");assert.equal(output.length,x.body.size);
  const fullAgain=await fetch(base+"/api/jobs/"+id+"/video");const digestAgain=crypto.createHash("sha256").update(Buffer.from(await fullAgain.arrayBuffer())).digest("hex");assert.equal(digest,digestAgain);
  const ranged=await fetch(base+"/api/jobs/"+id+"/video",{headers:{Range:"bytes=0-99"}});assert.equal(ranged.status,206);assert.equal(ranged.headers.get("content-range").startsWith("bytes 0-99/"),true);assert.equal((await ranged.arrayBuffer()).byteLength,100);
  const suffix=await fetch(base+"/api/jobs/"+id+"/video",{headers:{Range:"bytes=-100"}});assert.equal(suffix.status,206);assert.equal((await suffix.arrayBuffer()).byteLength,100);
  const deleted=await fetch(base+"/api/jobs/"+id,{method:"DELETE"});assert.equal(deleted.status,200);
  const missing=await fetch(base+"/api/jobs/"+id);assert.equal(missing.status,404);
  const malformed=await json(base+"/api/jobs",{method:"POST",headers:{"Content-Type":"application/json"},body:"{"});assert.equal(malformed.r.status,400);assert.ok(malformed.body.error);
  const empty=await json(base+"/api/jobs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({videos:[]})});assert.equal(empty.r.status,400);
  console.log("Merge HTTP smoke passed: upload chunks, Turso persistence, FFmpeg merge, output metadata, Range 206, delete/404, malformed JSON, empty sources.");
 }finally{await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
