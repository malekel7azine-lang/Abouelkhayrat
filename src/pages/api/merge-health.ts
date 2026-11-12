import type {NextApiRequest,NextApiResponse} from "next";
import {access} from "node:fs/promises";
import {spawn} from "node:child_process";
import ffmpeg from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import {mergeSchema} from "@/lib/merge-store";
async function version(binary:string|undefined|null){if(!binary)return false;try{await access(binary);}catch{return false;}return new Promise<boolean>(resolve=>{const p=spawn(binary,["-version"],{stdio:"ignore"});p.on("error",()=>resolve(false));p.on("close",code=>resolve(code===0));});}
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 res.setHeader("Access-Control-Allow-Origin","*");if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
 let database="connected";try{await mergeSchema();}catch{database="unavailable";}
 const [f,p]=await Promise.all([version(ffmpeg),version(ffprobe?.path)]);
 const status=database==="connected"&&f&&p?"ok":"degraded";
 return res.status(status==="ok"?200:503).json({status,database,ffmpeg:f?"ready":"unavailable",ffprobe:p?"ready":"unavailable"});
}
