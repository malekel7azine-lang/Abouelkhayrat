import { listCustomProviders } from "@/lib/custom-providers";
import { ProviderError } from "@/lib/provider-errors";

export async function tryCustomImageProviders(input:Record<string,unknown>):Promise<{provider:string;output:unknown}|null>{
 const prompt=String(input.prompt||"").trim();
 if(!prompt) throw new ProviderError("Image prompt is required","parameter");
 const providers=await listCustomProviders(true) as Array<any>;
 for(const p of providers.filter(x=>x.enabled)){
  try{
   const base=String(p.base_url).replace(/\/$/,"");
   const endpoint=base.endsWith("/v1")?base+"/images/generations":base+"/v1/images/generations";
   const response=await fetch(endpoint,{method:"POST",headers:{Authorization:"Bearer "+p.api_key,"Content-Type":"application/json"},body:JSON.stringify({model:p.image_model,prompt,n:1,size:typeof input.size==="string"?input.size:"1024x1024",response_format:"url"}),cache:"no-store"});
   const body:any=await response.json().catch(()=>({}));
   if(!response.ok) {
    if(response.status===401||response.status===403) continue;
    if(response.status===429||response.status===402||response.status>=500) continue;
    throw new ProviderError("Custom provider rejected image request ("+response.status+")","parameter");
   }
   const item=body?.data?.[0];
   if(item?.url)return {provider:p.name,output:{url:item.url}};
   if(item?.b64_json)return {provider:p.name,output:{b64_json:item.b64_json,format:body.output_format||"png"}};
   continue;
  }catch(e){if(e instanceof ProviderError&&e.kind==="parameter")throw e;}
 }
 return null;
}
