import type {NextApiRequest,NextApiResponse} from "next";
import {cleanupExpired,getJob} from "@/lib/merge-store";
import {processMerge} from "@/lib/merge-engine";
export const config={maxDuration:300};
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type");if(req.method==="OPTIONS")return res.status(204).end();if(req.method!=="POST")return res.status(405).json({error:"طريقة الطلب غير مدعومة"});
 const id=String(req.query.id||"");const origin=(req.headers["x-forwarded-proto"]||"https")+"://"+(req.headers["x-forwarded-host"]||req.headers.host);const videoUrl=origin+"/api/jobs/"+id+"/video";try{await cleanupExpired();const job=await getJob(id);if(!job)return res.status(404).json({error:"المهمة غير موجودة"});
 if(job.status==="processing")return res.status(202).json({status:"processing",progress:job.progress});
 if(job.status==="done")return res.status(200).json({status:"done",videoUrl,downloadUrl:videoUrl+"?download=1",size:job.output_size,duration:job.duration,resolution:job.width+"x"+job.height,expiresAt:new Date(Number(job.expires_at)).toISOString()});
 const result=await processMerge(id);return res.status(200).json({...result,videoUrl,downloadUrl:videoUrl+"?download=1",expiresAt:new Date(Number(job.expires_at)).toISOString()});
 }catch(e){const message=e instanceof Error?e.message:"فشل دمج الفيديو";const code=message.includes("يتجاوز الحد")?413:message.includes("غير موجودة")?404:message.includes("قيد المعالجة")?409:(message.includes("رابط")||message.includes("مصدرين")||message.includes("مدة")||message.includes("صوت")||message.includes("شبكة")||message.includes("غير صالح"))?400:500;return res.status(code).json({error:message});}
}
