import type {NextApiRequest,NextApiResponse} from "next";
import {getJob,iterateBlob,CHUNK_BYTES} from "@/lib/merge-store";
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 if(req.method!=="GET")return res.status(405).json({error:"طريقة الطلب غير مدعومة"});
 try{
  const id=String(req.query.id||"");const job=await getJob(id);
  if(!job)return res.status(404).json({error:"المهمة غير موجودة"});
  if(job.status!=="done")return res.status(409).json({error:"الفيديو لم يكتمل بعد"});
  const size=Number(job.output_size);const range=req.headers.range;const download=req.query.download==="1";
  res.setHeader("Content-Type","video/mp4");res.setHeader("Accept-Ranges","bytes");res.setHeader("Cache-Control","private, max-age=60");
  if(download)res.setHeader("Content-Disposition",'attachment; filename="merged-'+id+'.mp4"');
  let start=0,end=size-1;
  if(range){const m=/bytes=(\d*)-(\d*)/.exec(range);if(!m)return res.status(416).end();if(m[1])start=Number(m[1]);if(m[2])end=Number(m[2]);if(start>end||start>=size){res.setHeader("Content-Range","bytes */"+size);return res.status(416).end();}end=Math.min(end,size-1);res.status(206);res.setHeader("Content-Range","bytes "+start+"-"+end+"/"+size);}else res.status(200);
  res.setHeader("Content-Length",String(end-start+1));
  let absolute=0;
  for await(const chunk of iterateBlob("output_chunks",id)){
    const chunkStart=absolute,chunkEnd=absolute+chunk.length-1;absolute+=chunk.length;
    if(chunkEnd<start)continue;if(chunkStart>end)break;
    const from=Math.max(0,start-chunkStart),to=Math.min(chunk.length,end-chunkStart+1);
    if(to>from&&!res.write(chunk.subarray(from,to)))await new Promise<void>(resolve=>res.once("drain",resolve));
  }
  return res.end();
 }catch(e){if(!res.headersSent)return res.status(500).json({error:e instanceof Error?e.message:"تعذر بث الفيديو"});return res.end();}
}
