import type {NextApiRequest,NextApiResponse} from "next";
import {access} from "node:fs/promises";
import {spawn} from "node:child_process";
import {randomUUID,createHash} from "node:crypto";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import {deleteJob,getDb,mergeSchema,readBlob,storeBlob} from "@/lib/merge-store";
async function version(binary:string|undefined|null){if(!binary)return false;try{await access(binary);}catch{return false;}return new Promise<boolean>(resolve=>{const p=spawn(binary,["-version"],{stdio:"ignore"});p.on("error",()=>resolve(false));p.on("close",code=>resolve(code===0));});}
let blobCheck:Promise<boolean>|null=null;
async function verifyBlobStorage(){
 if(!blobCheck)blobCheck=(async()=>{const id="health-"+randomUUID(),now=Date.now(),sample=Buffer.from("Turso BLOB storage self-check v2");try{
  await getDb().execute({sql:"INSERT INTO jobs(id,status,progress,created_at,expires_at) VALUES(?,?,?,?,?)",args:[id,"done",100,now,now+60000]});
  await storeBlob("output_chunks",id,0,sample);const restored=await readBlob("output_chunks",id);
  return createHash("sha256").update(sample).digest("hex")===createHash("sha256").update(restored).digest("hex");
 }catch{return false;}finally{await deleteJob(id).catch(()=>undefined);}})();
 const ok=await blobCheck;if(!ok)blobCheck=null;return ok;
}
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 res.setHeader("Access-Control-Allow-Origin","*");if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
 let database="connected";try{await mergeSchema();}catch{database="unavailable";}
 const [f,p,blob]=await Promise.all([version(ffmpeg),version(ffprobe?.path),database==="connected"?verifyBlobStorage():Promise.resolve(false)]);
 const status=database==="connected"&&f&&p&&blob?"ok":"degraded";
 return res.status(status==="ok"?200:503).json({status,database,ffmpeg:f?"ready":"unavailable",ffprobe:p?"ready":"unavailable",tursoBlob:blob?"read-write-verified":"unverified"});
}
