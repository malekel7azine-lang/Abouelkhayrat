import { NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/auth";
import { addProviderKey, providerKeySummary, type ProviderName } from "@/lib/provider-keys";
export const runtime = "nodejs";
export async function GET(request: Request) {
 if(!isAdminAuthorized(request)) return NextResponse.json({error:"Unauthorized"},{status:401});
 try { const keys=await providerKeySummary(); return NextResponse.json({keys,config:{
  kieConfigured:keys.some(k=>k.provider==="kie"&&k.status!=="disabled"),
  cometapiConfigured:keys.some(k=>k.provider==="cometapi"&&k.status!=="disabled"),
  pollinationsConfigured:keys.some(k=>k.provider==="pollinations"&&k.status!=="disabled"),
  magicHourConfigured:keys.some(k=>k.provider==="magic_hour"&&k.status!=="disabled")
 }}); } catch { return NextResponse.json({error:"Unable to load provider keys"},{status:503}); }
}
export async function POST(request: Request) {
 if(!isAdminAuthorized(request)) return NextResponse.json({error:"Unauthorized"},{status:401});
 try { const b=await request.json() as {provider?:ProviderName;label?:string;secret?:string}; const secret=b.secret?.trim();
  if(!["kie","cometapi","pollinations","magic_hour"].includes(String(b.provider))||!secret) return NextResponse.json({error:"Provider and API key are required"},{status:400});
  await addProviderKey(b.provider!,b.label||b.provider||"provider",secret);return NextResponse.json({success:true},{status:201});
 } catch { return NextResponse.json({error:"Unable to save provider key"},{status:400}); }
}
