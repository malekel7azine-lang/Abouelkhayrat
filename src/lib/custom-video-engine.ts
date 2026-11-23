import { listCustomVideoProviders } from "@/lib/custom-video-providers";
import { ProviderError } from "@/lib/provider-errors";

function findUrl(value:any,depth=0):string|null{
 if(depth>8||value==null)return null;
 if(typeof value==="string")return /^https?:\/\//i.test(value)?value:null;
 if(Array.isArray(value)){for(const v of value){const u=findUrl(v,depth+1);if(u)return u;}return null;}
 if(typeof value==="object"){for(const k of ["video_url","videoUrl","url","output","result","data","videos","assets"]){if(k in value){const u=findUrl(value[k],depth+1);if(u)return u;}}}
 return null;
}
async function createForProvider(p:any,input:Record<string,unknown>):Promise<{provider:string;taskId:string}>{
 const response=await fetch(new URL(p.create_path,p.base_url),{method:"POST",headers:{Authorization:"Bearer "+p.api_key,"Content-Type":"application/json"},body:JSON.stringify({model:p.video_model,prompt:String(input.prompt||""),duration:input.duration,aspect_ratio:input.aspect_ratio,resolution:input.resolution,image_urls:input.image_urls}),cache:"no-store",signal:AbortSignal.timeout(30000)});
 const body:any=await response.json().catch(()=>({}));
 if(!response.ok)throw new ProviderError("Custom video provider rejected request ("+response.status+")","temporary");
 const id=body?.id||body?.task_id||body?.taskId||body?.request_id||body?.data?.id;
 if(!id)throw new ProviderError("Custom video provider response has no task id","fatal");
 return {provider:p.name,taskId:String(id)};
}
export async function createCustomVideoTask(input:Record<string,unknown>):Promise<{provider:string;taskId:string}|null>{
 const providers=await listCustomVideoProviders(true) as any[];
 for(const p of providers.filter(x=>x.enabled)){
  try{return await createForProvider(p,input);}catch(e){if(e instanceof ProviderError&&e.kind==="parameter")throw e;}
 }
 return null;
}
export async function createCustomVideoProviderTest(id:string):Promise<{provider:string;taskId:string}>{
 const providers=await listCustomVideoProviders(true) as any[];const p=providers.find(x=>x.id===id&&x.enabled);
 if(!p)throw new ProviderError("Custom video provider is disabled or missing","parameter");
 return createForProvider(p,{prompt:"A short cinematic test video: calm ocean at sunrise, gentle waves, smooth camera movement, realistic lighting.",duration:5,aspect_ratio:"16:9",resolution:"720p"});
}
export async function getCustomVideoTask(providerName:string,taskId:string):Promise<{state:string;result:unknown;error?:string}|null>{
 const providers=await listCustomVideoProviders(true) as any[];const p=providers.find(x=>x.name===providerName);if(!p)return null;
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
export async function getCustomVideoProviderTest(id:string,taskId:string){
 const providers=await listCustomVideoProviders(true) as any[];const p=providers.find(x=>x.id===id);if(!p)return null;
 try{const path=String(p.status_path).replaceAll("{id}",encodeURIComponent(taskId));const response=await fetch(new URL(path,p.base_url),{headers:{Authorization:"Bearer "+p.api_key},cache:"no-store",signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error("status failed");const body:any=await response.json();const state=String(body?.status||body?.state||body?.data?.status||"processing").toLowerCase();const videoUrl=findUrl(body?.output||body?.result||body);return {state,videoUrl,error:body?.error?.message||body?.error||null};}catch{return {state:"processing",videoUrl:null,error:"تعذر جلب الحالة حالياً"};}
}
