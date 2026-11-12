import type {NextApiRequest,NextApiResponse} from "next";
import {mergeSchema,getDb,UPLOAD_BYTES,LIMITS} from "@/lib/merge-store";
export const config={api:{bodyParser:false}};
async function raw(req:NextApiRequest){const chunks:Buffer[]=[];let n=0;for await(const c of req){const b=Buffer.from(c);n+=b.length;if(n>UPLOAD_BYTES)throw new Error("CHUNK_TOO_LARGE");chunks.push(b);}return Buffer.concat(chunks);}
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type");
 if(req.method==="OPTIONS")return res.status(204).end();if(req.method!=="POST")return res.status(405).json({error:"طريقة الطلب غير مدعومة"});
 try{await mergeSchema();const job=String(req.query.job||""),seq=Number(req.query.seq),chunk=Number(req.query.chunk||0);if(!job||!Number.isInteger(seq)||seq<0||!Number.isInteger(chunk)||chunk<0)return res.status(400).json({error:"معلمات الرفع غير صالحة"});
 const src=await getDb().execute({sql:"SELECT size,kind FROM sources WHERE job_id=? AND seq=?",args:[job,seq]});if(!src.rows.length)return res.status(404).json({error:"المصدر غير موجود"});
 const buf=await raw(req);if(!buf.length)return res.status(400).json({error:"الجزء فارغ"});const total=Number(src.rows[0].size);if(total>LIMITS.sourceMaxBytes)return res.status(413).json({error:"الملف يتجاوز الحد"});
 const expectedChunks=Math.ceil(total/UPLOAD_BYTES);if(chunk>=expectedChunks)return res.status(400).json({error:"رقم الجزء خارج نطاق الملف"});
 const expectedBytes=Math.min(UPLOAD_BYTES,total-chunk*UPLOAD_BYTES);if(buf.length!==expectedBytes)return res.status(400).json({error:"حجم الجزء لا يطابق الحجم المتوقع"});
 for(let offset=0,part=0;offset<buf.length;offset+=2*1024*1024,part++){
  await getDb().execute({sql:"INSERT OR REPLACE INTO source_chunks(job_id,seq,chunk,data) VALUES(?,?,?,?)",args:[job,seq,chunk*2+part,buf.subarray(offset,offset+2*1024*1024)]});
 }
 return res.status(200).json({uploaded:true,seq,chunk,bytes:buf.length});
 }catch(e){return res.status(e instanceof Error&&e.message==="CHUNK_TOO_LARGE"?413:500).json({error:e instanceof Error?e.message:"فشل رفع الجزء"});}
}
