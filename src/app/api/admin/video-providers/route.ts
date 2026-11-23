import {NextResponse} from "next/server";
import {isAdminAuthorized} from "@/lib/auth";
import {listCustomVideoProviders,saveCustomVideoProvider} from "@/lib/custom-video-providers";
export const runtime="nodejs";
export async function GET(req:Request){if(!isAdminAuthorized(req))return NextResponse.json({error:"Unauthorized"},{status:401});try{return NextResponse.json({providers:await listCustomVideoProviders()});}catch{return NextResponse.json({error:"تعذر تحميل موصلات الفيديو"},{status:503});}}
export async function POST(req:Request){if(!isAdminAuthorized(req))return NextResponse.json({error:"Unauthorized"},{status:401});try{const b=await req.json();const id=await saveCustomVideoProvider({id:b.id,name:String(b.name||""),baseUrl:String(b.baseUrl||""),createPath:String(b.createPath||""),statusPath:String(b.statusPath||""),model:String(b.model||""),apiKey:typeof b.apiKey==="string"?b.apiKey:undefined,enabled:b.enabled!==false});return NextResponse.json({success:true,id},{status:b.id?200:201});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"تعذر حفظ موصل الفيديو"},{status:400});}}
