import type {NextApiRequest,NextApiResponse} from "next";
import {cleanupExpired,getJob} from "@/lib/merge-store";
import {processMerge} from "@/lib/merge-engine";
export const config={maxDuration:300};
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 res.setHeader("Access-Control-Allow-Origin","*");if(req.method!=="POST")return res.status(405).json({error:"طريقة الطلب غير مدعومة"});
 const id=String(req.query.id||"");try{await cleanupExpired();const job=await getJob(id);if(!job)return res.status(404).json({error:"المهمة غير موجودة"});
 if(job.status==="processing")return res.status(202).json({status:"processing",progress:job.progress});
 if(job.status==="done")return res.status(200).json({status:"done",videoUrl:"/api/jobs/"+id+"/video",downloadUrl:"/api/jobs/"+id+"/video?download=1",size:job.output_size,duration:job.duration,resolution:job.width+"x"+job.height,expiresAt:new Date(Number(job.expires_at)).toISOString()});
 const result=await processMerge(id);return res.status(200).json({...result,videoUrl:"/api/jobs/"+id+"/video",downloadUrl:"/api/jobs/"+id+"/video?download=1"});
 }catch(e){return res.status(400).json({error:e instanceof Error?e.message:"فشل دمج الفيديو"});}
}
