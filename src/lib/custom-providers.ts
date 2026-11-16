import { randomUUID } from "node:crypto";
import { ensureSchema, getDb } from "@/lib/db";
import { encryptProviderSecret, decryptProviderSecret } from "@/lib/secret-crypto";

export type CustomProvider = {
  id: string; name: string; base_url: string; api_key: string;
  image_model: string; enabled: number; created_at: string;
};

export async function ensureCustomProviderSchema() {
  await ensureSchema();
  await getDb().execute(`CREATE TABLE IF NOT EXISTS custom_providers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL,
    api_key TEXT NOT NULL, image_model TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

export async function listCustomProviders(includeSecrets = false) {
  await ensureCustomProviderSchema();
  const r = await getDb().execute("SELECT * FROM custom_providers ORDER BY created_at ASC, id ASC");
  return (r.rows as unknown as CustomProvider[]).map(p => ({
    id:p.id, name:p.name, base_url:p.base_url, image_model:p.image_model,
    enabled:Boolean(p.enabled), created_at:p.created_at,
    masked:p.api_key.length > 8 ? p.api_key.slice(0,3)+"••••••"+p.api_key.slice(-3) : "••••••••",
    ...(includeSecrets ? { api_key:decryptProviderSecret(p.api_key) } : {})
  }));
}

export async function saveCustomProvider(input:{id?:string;name:string;baseUrl:string;apiKey?:string;imageModel:string;enabled?:boolean}) {
  await ensureCustomProviderSchema();
  const name=input.name.trim().slice(0,80), base=input.baseUrl.trim().replace(/\/$/,""), model=input.imageModel.trim().slice(0,120);
  if (!name || !model || !/^https:\/\//i.test(base) || !/^https:\/\//i.test(base)) throw new Error("Name, HTTPS API base URL and image model are required");
  if (!input.id && !input.apiKey?.trim()) throw new Error("API key is required");
  if (input.id) {
    const old=await getDb().execute({sql:"SELECT api_key FROM custom_providers WHERE id=?",args:[input.id]});
    if (!old.rows.length) throw new Error("Provider not found");
    await getDb().execute({sql:"UPDATE custom_providers SET name=?,base_url=?,api_key=?,image_model=?,enabled=?,updated_at=datetime('now') WHERE id=?",args:[name,base,input.apiKey?.trim()?encryptProviderSecret(input.apiKey.trim()):String(old.rows[0].api_key),model,input.enabled===false?0:1,input.id]});
    return input.id;
  }
  const id=randomUUID();
  await getDb().execute({sql:"INSERT INTO custom_providers(id,name,base_url,api_key,image_model,enabled) VALUES(?,?,?,?,?,?)",args:[id,name,base,encryptProviderSecret(input.apiKey!.trim()),model,input.enabled===false?0:1]});
  return id;
}

export async function deleteCustomProvider(id:string) {
  await ensureCustomProviderSchema();
  await getDb().execute({sql:"DELETE FROM custom_providers WHERE id=?",args:[id]});
}

export async function setCustomProviderEnabled(id:string,enabled:boolean) {
  await ensureCustomProviderSchema();
  await getDb().execute({sql:"UPDATE custom_providers SET enabled=?,updated_at=datetime('now') WHERE id=?",args:[enabled?1:0,id]});
}
