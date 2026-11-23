import { listCustomVideoProviders } from "@/lib/custom-video-providers";
import { ProviderError } from "@/lib/provider-errors";

function findUrl(value:any,depth=0):string|null{
 if(depth>8||value==null)return null;
 if(typeof value==="string")return /^https?:\/\//i.test(value)?value:null;
 if(Array.isArray(value)){for(const v of value){const u=findUrl(v,depth+1);if(u)return u;}return null;}
 if(typeof value==="object"){for(const k of ["video_url","videoUrl","url","output","result","data","videos","assets"]){if(k in value){const u=findUrl(value[k],depth+1);if(u)return u;}}}
 return null;
}
export async function createCustomVideoTask(input:Record<string,unknown>):Promise<{provider:string;taskId:string}|null>{
 const providers=await listCustomVideoProviders(true) as any[];
 for(const p of providers.filter(x=>x.enabled)){
  try{
   const response=await fetch(new URL(p.create_path,p.base_url),{method:"POST",headers:{Authorization:"Bearer "+p.api_key,"Content-Type":"application/json"},body:JSON.stringify({model:p.video_model,prompt:String(input.prompt||""),duration:input.duration,aspect_ratio:input.aspect_ratio,resolution:input.resolution,image_urls:input.image_urls}),cache:"no-store",signal:AbortSignal.timeout(30000)});
   const body:any=await response.json().catch(()=>({}));
   if(!response.ok){if([401,402,403,429].includes(response.status)||response.status>=500)continue;throw new ProviderError("Custom video provider rejected the request ("+response.status+")","parameter");}
   const id=body?.id||body?.task_id||body?.taskId||body?.request_id||body?.data?.id;
   if(id)return {provider:p.name,taskId:String(id)};
  }catch(e){if(e instanceof ProviderError&&e.kind==="parameter")throw e;}
 }
 return null;
}
export async function getCustomVideoTask(providerName:string,taskId:string):Promise<{state:string;result:unknown;error?:string}|null>{
 const providers=await listCustomVideoProviders(true) as any[];const p=providers.find(x=>x.name===providerName&&x.enabled);if(!p)return null;
 try{
  const path=String(p.status_path).replaceAll("{id}",encodeURIComponent(taskId));
  const response=await fetch(new URL(path,p.base_url),{headers:{Authorization:"Bearer "+p.api_key},cache:"no-store",signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error("status request failed");
  const body:any=await response.json();const state=String(body?.status||body?.state||body?.data?.status||"processing").toLowerCase();
  const url=findUrl(body?.output||body?.result||body);
  if(["done","completed","success","succeeded"].includes(state))return {state,result:url?{url}:body?.output||body?.result||body};
  if(["failed","error","cancelled","canceled"].includes(state))return {state,result:body,error:String(body?.error?.message||body?.error||"Provider task failed")};
  return {state,result:body};
 }catch{return {state:"processing",result:{},error:"Temporary status check failure"};}
}
