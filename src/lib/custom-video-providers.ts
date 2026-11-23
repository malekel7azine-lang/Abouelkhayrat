import { randomUUID } from "node:crypto";
import { ensureSchema, getDb } from "@/lib/db";
import { encryptProviderSecret, decryptProviderSecret } from "@/lib/secret-crypto";

export type CustomVideoProvider = {id:string;name:string;base_url:string;create_path:string;status_path:string;video_model:string;api_key:string;enabled:number};
export async function ensureCustomVideoSchema(){
 await ensureSchema();
 await getDb().execute(`CREATE TABLE IF NOT EXISTS custom_video_providers(
 id TEXT PRIMARY KEY,name TEXT NOT NULL,base_url TEXT NOT NULL,create_path TEXT NOT NULL,
 status_path TEXT NOT NULL,video_model TEXT NOT NULL,api_key TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT(datetime('now')),
 updated_at TEXT NOT NULL DEFAULT(datetime('now')))`);
}
function validBase(value:string){try{const u=new URL(value);return u.protocol==="https:"&&!u.username&&!u.password&&!["localhost","127.0.0.1","0.0.0.0","::1"].includes(u.hostname)&&!/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname);}catch{return false;}}
export async function listCustomVideoProviders(secrets=false){
 await ensureCustomVideoSchema();const r=await getDb().execute("SELECT * FROM custom_video_providers ORDER BY created_at,id");
 return (r.rows as unknown as CustomVideoProvider[]).map(p=>({id:p.id,name:p.name,base_url:p.base_url,create_path:p.create_path,status_path:p.status_path,video_model:p.video_model,enabled:Boolean(p.enabled),masked:p.api_key.length>8?p.api_key.slice(0,3)+"••••••"+p.api_key.slice(-3):"••••••••",...(secrets?{api_key:decryptProviderSecret(p.api_key)}:{})}));
}
export async function saveCustomVideoProvider(input:{id?:string;name:string;baseUrl:string;createPath:string;statusPath:string;model:string;apiKey?:string;enabled?:boolean}){
 await ensureCustomVideoSchema();const name=input.name.trim().slice(0,80),base=input.baseUrl.trim().replace(/\/$/,""),create=input.createPath.trim(),status=input.statusPath.trim(),model=input.model.trim().slice(0,120);
 if(!name||!validBase(base)||!create.startsWith("/")||!status.startsWith("/")||!status.includes("{id}")||!model)throw new Error("أدخل اسماً ورابط HTTPS ومسارات API صحيحة، ويجب أن يحتوي مسار الحالة على {id}");
 if(!input.id&&!input.apiKey?.trim())throw new Error("API Key مطلوب");
 if(input.id){const old=await getDb().execute({sql:"SELECT api_key FROM custom_video_providers WHERE id=?",args:[input.id]});if(!old.rows.length)throw new Error("المزوّد غير موجود");await getDb().execute({sql:"UPDATE custom_video_providers SET name=?,base_url=?,create_path=?,status_path=?,video_model=?,api_key=?,enabled=?,updated_at=datetime('now') WHERE id=?",args:[name,base,create,status,model,input.apiKey?.trim()?encryptProviderSecret(input.apiKey.trim()):String(old.rows[0].api_key),input.enabled===false?0:1,input.id]});return input.id;}
 const id=randomUUID();await getDb().execute({sql:"INSERT INTO custom_video_providers(id,name,base_url,create_path,status_path,video_model,api_key,enabled) VALUES(?,?,?,?,?,?,?,?)",args:[id,name,base,create,status,model,encryptProviderSecret(input.apiKey!.trim()),input.enabled===false?0:1]});return id;
}
export async function setCustomVideoProviderEnabled(id:string,enabled:boolean){await ensureCustomVideoSchema();await getDb().execute({sql:"UPDATE custom_video_providers SET enabled=?,updated_at=datetime('now') WHERE id=?",args:[enabled?1:0,id]});}
export async function deleteCustomVideoProvider(id:string){await ensureCustomVideoSchema();await getDb().execute({sql:"DELETE FROM custom_video_providers WHERE id=?",args:[id]});}
