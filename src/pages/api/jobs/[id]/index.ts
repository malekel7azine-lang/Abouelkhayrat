import type {NextApiRequest,NextApiResponse} from "next";
import {cleanupExpired,getJob,deleteJob} from "@/lib/merge-store";
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Methods","GET,DELETE,OPTIONS");if(req.method==="OPTIONS")return res.status(204).end();
 const id=String(req.query.id||"");
 try{await cleanupExpired();const job=await getJob(id);if(!job)return res.status(404).json({error:"المهمة غير موجودة"});
 if(req.method==="DELETE"){await deleteJob(id);return res.status(200).json({deleted:true});}
 if(req.method!=="GET")return res.status(405).json({error:"طريقة الطلب غير مدعومة"});
 const host=req.headers["x-forwarded-host"]||req.headers.host;const base="https://"+host;
 return res.status(200).json({jobId:id,status:job.status,progress:job.progress,error:job.error,videoUrl:job.status==="done"?base+"/api/jobs/"+id+"/video":null,size:job.output_size,duration:job.duration,resolution:job.width&&job.height?job.width+"x"+job.height:null,expiresAt:new Date(Number(job.expires_at)).toISOString()});
 }catch(e){return res.status(500).json({error:e instanceof Error?e.message:"تعذر قراءة المهمة"});}
}
