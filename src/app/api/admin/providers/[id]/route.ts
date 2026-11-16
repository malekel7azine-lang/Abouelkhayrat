import { NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/auth";
import { deleteCustomProvider, setCustomProviderEnabled } from "@/lib/custom-providers";
export const runtime="nodejs";
type C={params:Promise<{id:string}>};
export async function PATCH(req:Request,c:C){
 if(!isAdminAuthorized(req)) return NextResponse.json({error:"Unauthorized"},{status:401});
 try{const {id}=await c.params;const b=await req.json();await setCustomProviderEnabled(id,Boolean(b.enabled));return NextResponse.json({success:true});}
 catch{return NextResponse.json({error:"تعذر تحديث المزوّد"},{status:400});}
}
export async function DELETE(req:Request,c:C){
 if(!isAdminAuthorized(req)) return NextResponse.json({error:"Unauthorized"},{status:401});
 try{const {id}=await c.params;await deleteCustomProvider(id);return NextResponse.json({success:true});}
 catch{return NextResponse.json({error:"تعذر حذف المزوّد"},{status:400});}
}
