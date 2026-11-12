const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const ffmpeg = require("ffmpeg-static");
const ffprobe = require("ffprobe-static").path;

function run(bin,args){return new Promise((resolve,reject)=>{const p=spawn(bin,args,{stdio:["ignore","pipe","pipe"]});let out="",err="";p.stdout.on("data",d=>out+=d);p.stderr.on("data",d=>err+=d);p.on("error",reject);p.on("close",c=>c===0?resolve(out):reject(Error(err)));});}
async function probe(file){const out=await run(ffprobe,["-v","error","-show_streams","-show_format","-of","json",file]);return JSON.parse(out);}
test("FFmpeg merges different resolutions, synthesizes missing audio, and preserves total duration",async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"merge-test-"));
 try{
  const a=path.join(dir,"a.mp4"),b=path.join(dir,"b.mp4"),out=path.join(dir,"out.mp4");
  await run(ffmpeg,["-y","-f","lavfi","-i","testsrc2=size=640x360:rate=24:duration=1","-f","lavfi","-i","sine=frequency=440:duration=1","-shortest","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac",a]);
  await run(ffmpeg,["-y","-f","lavfi","-i","testsrc2=size=1280x720:rate=25:duration=1","-an","-c:v","libx264","-pix_fmt","yuv420p",b]);
  const filters="[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1,format=yuv420p[v0];[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a0];[1:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1,format=yuv420p[v1];anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=1,asetpts=PTS-STARTPTS[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]";
  await run(ffmpeg,["-y","-i",a,"-i",b,"-filter_complex",filters,"-map","[outv]","-map","[outa]","-c:v","libx264","-preset","ultrafast","-crf","18","-c:a","aac","-b:a","192k","-ar","44100","-movflags","+faststart",out]);
  const meta=await probe(out);const video=meta.streams.find(x=>x.codec_type==="video");const audio=meta.streams.find(x=>x.codec_type==="audio");
  assert.equal(video.width,1280);assert.equal(video.height,720);assert.ok(audio);assert.ok(Number(meta.format.duration)>=1.8&&Number(meta.format.duration)<=2.3);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
