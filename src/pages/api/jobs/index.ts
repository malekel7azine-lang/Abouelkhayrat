import type {NextApiRequest,NextApiResponse} from "next";
import {cleanupExpired,mergeSchema,makeId,LIMITS,getDb,UPLOAD_BYTES} from "@/lib/merge-store";
export const config={api:{bodyParser:{sizeLimit:"1mb"}}};
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type,Range");
 if(req.method==="OPTIONS")return res.status(204).end();if(req.method!=="POST")return res.status(405).json({error:"طريقة الطلب غير مدعومة"});
 try{
  await cleanupExpired();await mergeSchema();
  const body=req.body||{};let sources=Array.isArray(body.sources)?body.sources:Array.isArray(body.videos)?body.videos.map((url:string)=>({kind:"url",url})):[];
  if(sources.length<2||sources.length>LIMITS.maxSources)return res.status(400).json({error:"أرسل من مصدرين إلى "+LIMITS.maxSources+" مصادر"});
  for(const s of sources){if(s.kind==="url"){let u;try{u=new URL(s.url)}catch{return res.status(400).json({error:"رابط فيديو غير صالح"})}if(!["http:","https:"].includes(u.protocol))return res.status(400).json({error:"يسمح بروابط HTTP وHTTPS فقط"});}else if(s.kind!=="file"||!s.name||!Number.isFinite(Number(s.size))||Number(s.size)<=0)return res.status(400).json({error:"بيانات الملف غير صالحة"});else if(Number(s.size)>LIMITS.sourceMaxBytes)return res.status(413).json({error:"حجم الملف يتجاوز الحد المسموح"});}
  const id=makeId(),now=Date.now(),expires=now+24*60*60*1000;const db=getDb();
  await db.execute({sql:"INSERT INTO jobs(id,status,progress,created_at,expires_at) VALUES(?,?,?,?,?)",args:[id,sources.some((s:any)=>s.kind==="file")?"uploading":"queued",0,now,expires]});
  for(let i=0;i<sources.length;i++){const s=sources[i];await db.execute({sql:"INSERT INTO sources(job_id,seq,kind,url,name,size,mime) VALUES(?,?,?,?,?,?,?)",args:[id,i,s.kind,s.url||null,s.name||null,s.size||null,s.mime||null]});}
  const origin="https://"+(req.headers["x-forwarded-host"]||req.headers.host);
  return res.status(201).json({jobId:id,status:sources.some((s:any)=>s.kind==="file")?"uploading":"queued",statusUrl:origin+"/api/jobs/"+id,processUrl:origin+"/api/jobs/"+id+"/process",expiresAt:new Date(expires).toISOString(),uploads:sources.map((s:any,seq:number)=>s.kind==="file"?{seq,url:origin+"/api/upload?job="+id+"&seq="+seq,uploadChunkBytes:UPLOAD_BYTES}:null).filter(Boolean),uploadChunkBytes:UPLOAD_BYTES});
 }catch(e){return res.status(500).json({error:e instanceof Error?e.message:"تعذر إنشاء المهمة"});}
}
