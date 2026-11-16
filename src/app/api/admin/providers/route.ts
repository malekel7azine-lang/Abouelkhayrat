import { NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/auth";
import { listCustomProviders, saveCustomProvider } from "@/lib/custom-providers";
export const runtime="nodejs";
export async function GET(req:Request){
 if(!isAdminAuthorized(req)) return NextResponse.json({error:"Unauthorized"},{status:401});
 try{return NextResponse.json({providers:await listCustomProviders()});}
 catch{return NextResponse.json({error:"تعذر تحميل المزوّدين"},{status:503});}
}
export async function POST(req:Request){
 if(!isAdminAuthorized(req)) return NextResponse.json({error:"Unauthorized"},{status:401});
 try{
  const b=await req.json();
  const id=await saveCustomProvider({id:b.id,name:String(b.name||""),baseUrl:String(b.baseUrl||""),apiKey:typeof b.apiKey==="string"?b.apiKey:undefined,imageModel:String(b.imageModel||""),enabled:b.enabled!==false});
  return NextResponse.json({success:true,id},{status:b.id?200:201});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"تعذر حفظ المزوّد"},{status:400});}
}
