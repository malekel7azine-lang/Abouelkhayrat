import type {NextApiRequest,NextApiResponse} from "next";
import {access} from "node:fs/promises";
import {spawn} from "node:child_process";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import {ensureSchema} from "@/lib/db";
async function version(binary:string){await access(binary);return new Promise<boolean>(resolve=>{const p=spawn(binary,["-version"],{stdio:"ignore"});p.on("error",()=>resolve(false));p.on("close",code=>resolve(code===0));});}
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 res.setHeader("Access-Control-Allow-Origin","*");if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
 try{await ensureSchema();const [f,p]=await Promise.all([version(ffmpeg||""),version(ffprobe.path)]);return res.status(f&&p?200:503).json({status:f&&p?"ok":"degraded",database:"connected",ffmpeg:f?"ready":"unavailable",ffprobe:p?"ready":"unavailable"});}
 catch{return res.status(503).json({status:"error",database:"unavailable",ffmpeg:"unknown",ffprobe:"unknown"});}
}
