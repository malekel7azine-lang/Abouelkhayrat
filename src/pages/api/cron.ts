import type {NextApiRequest,NextApiResponse} from "next";
import {cleanupExpired} from "@/lib/merge-store";
export default async function handler(req:NextApiRequest,res:NextApiResponse){const secret=process.env.CRON_SECRET;if(secret&&req.headers.authorization!=="Bearer "+secret)return res.status(401).json({error:"غير مصرح"});if(req.method!=="GET")return res.status(405).json({error:"طريقة الطلب غير مدعومة"});try{await cleanupExpired();return res.status(200).json({ok:true});}catch{return res.status(500).json({error:"تعذر تنظيف المهام"});}}
