import {NextResponse} from "next/server";
import {isAdminAuthorized} from "@/lib/auth";
import {createCustomVideoProviderTest,getCustomVideoProviderTest} from "@/lib/custom-video-engine";
export const runtime="nodejs";
type C={params:Promise<{id:string}>};
export async function POST(req:Request,c:C){if(!isAdminAuthorized(req))return NextResponse.json({error:"Unauthorized"},{status:401});try{const {id}=await c.params;const task=await createCustomVideoProviderTest(id);return NextResponse.json({success:true,...task},{status:202});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"تعذر بدء اختبار التوليد"},{status:400});}}
export async function GET(req:Request,c:C){if(!isAdminAuthorized(req))return NextResponse.json({error:"Unauthorized"},{status:401});const {id}=await c.params;const taskId=new URL(req.url).searchParams.get("taskId");if(!taskId)return NextResponse.json({error:"taskId required"},{status:400});const result=await getCustomVideoProviderTest(id,taskId);return result?NextResponse.json(result):NextResponse.json({error:"Provider not found"},{status:404});}
