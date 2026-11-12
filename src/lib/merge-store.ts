import { randomUUID } from "node:crypto";
import { ensureSchema, getDb } from "@/lib/db";
export { getDb } from "@/lib/db";

export const CHUNK_BYTES = 2 * 1024 * 1024;
export const UPLOAD_BYTES = 4 * 1024 * 1024;
export const RETENTION_MS = 24 * 60 * 60 * 1000;
export const LIMITS = {
  maxSources: Number(process.env.MAX_SOURCES || 10),
  sourceMaxBytes: Number(process.env.SOURCE_MAX_MB || 200) * 1024 * 1024,
  outputMaxBytes: Number(process.env.OUTPUT_MAX_MB || 150) * 1024 * 1024,
  maxDuration: Number(process.env.MAX_TOTAL_DURATION_SEC || 600)
};

export async function mergeSchema() {
  await ensureSchema();
  const db = getDb();
  await db.batch([
    `CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,status TEXT NOT NULL,progress INTEGER NOT NULL DEFAULT 0,error TEXT,output_size INTEGER,duration REAL,width INTEGER,height INTEGER,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sources (job_id TEXT NOT NULL,seq INTEGER NOT NULL,kind TEXT NOT NULL,url TEXT,name TEXT,size INTEGER,mime TEXT,PRIMARY KEY(job_id,seq))`,
    `CREATE TABLE IF NOT EXISTS source_chunks (job_id TEXT NOT NULL,seq INTEGER NOT NULL,chunk INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(job_id,seq,chunk))`,
    `CREATE TABLE IF NOT EXISTS output_chunks (job_id TEXT NOT NULL,chunk INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(job_id,chunk))`,
    "CREATE INDEX IF NOT EXISTS idx_jobs_expiry ON jobs(expires_at)"
  ], "write");
}
export function makeId(){ return randomUUID(); }
export async function cleanupExpired(){
  await mergeSchema(); const db=getDb(); const now=Date.now();
  const old=await db.execute({sql:"SELECT id FROM jobs WHERE expires_at <= ?",args:[now]});
  for(const row of old.rows){ await deleteJob(String(row.id)); }
}
export async function deleteJob(id:string){
  await mergeSchema(); const db=getDb();
  await db.batch([
    {sql:"DELETE FROM source_chunks WHERE job_id = ?",args:[id]},
    {sql:"DELETE FROM output_chunks WHERE job_id = ?",args:[id]},
    {sql:"DELETE FROM sources WHERE job_id = ?",args:[id]},
    {sql:"DELETE FROM jobs WHERE id = ?",args:[id]}
  ],"write");
}
export async function getJob(id:string){
  await mergeSchema(); const r=await getDb().execute({sql:"SELECT * FROM jobs WHERE id = ?",args:[id]});
  const job=r.rows[0]||null;if(job&&Number(job.expires_at)<=Date.now()){await deleteJob(id);return null;}return job;
}
export async function setProgress(id:string,status:string,progress:number,error?:string){
  await mergeSchema(); await getDb().execute({sql:"UPDATE jobs SET status=?,progress=?,error=? WHERE id=?",args:[status,progress,error||null,id]});
}
export async function storeBlob(table:"source_chunks"|"output_chunks",id:string,seq:number,data:Buffer){
  await mergeSchema(); const db=getDb(); const statements=[];
  for(let offset=0,chunk=0;offset<data.length;offset+=CHUNK_BYTES,chunk++){
    statements.push({sql:table==="source_chunks"?"INSERT OR REPLACE INTO source_chunks(job_id,seq,chunk,data) VALUES(?,?,?,?)":"INSERT OR REPLACE INTO output_chunks(job_id,chunk,data) VALUES(?,?,?)",args:table==="source_chunks"?[id,seq,chunk,data.subarray(offset,offset+CHUNK_BYTES)]:[id,chunk,data.subarray(offset,offset+CHUNK_BYTES)]});
  }
  for(const statement of statements) await db.execute(statement);
}
export async function readBlob(table:"source_chunks"|"output_chunks",id:string,seq=0):Promise<Buffer>{
  await mergeSchema(); const db=getDb(); const chunks:Buffer[]=[]; let offset=0;
  while(true){
    const r=table==="source_chunks"
      ? await db.execute({sql:"SELECT data FROM source_chunks WHERE job_id=? AND seq=? AND chunk>=? ORDER BY chunk LIMIT 8",args:[id,seq,offset]})
      : await db.execute({sql:"SELECT data FROM output_chunks WHERE job_id=? AND chunk>=? ORDER BY chunk LIMIT 8",args:[id,offset]});
    if(!r.rows.length) break;
    for(const row of r.rows) chunks.push(Buffer.from(row.data as ArrayBuffer));
    offset+=r.rows.length;
    if(r.rows.length<8) break;
  }
  return Buffer.concat(chunks);
}

export async function* iterateBlob(table:"source_chunks"|"output_chunks",id:string,seq=0){
  await mergeSchema();const db=getDb();let offset=0;
  while(true){
    const r=table==="source_chunks"
      ? await db.execute({sql:"SELECT chunk,data FROM source_chunks WHERE job_id=? AND seq=? AND chunk>=? ORDER BY chunk LIMIT 8",args:[id,seq,offset]})
      : await db.execute({sql:"SELECT chunk,data FROM output_chunks WHERE job_id=? AND chunk>=? ORDER BY chunk LIMIT 8",args:[id,offset]});
    if(!r.rows.length)break;
    for(const row of r.rows){offset=Number(row.chunk)+1;yield Buffer.from(row.data as unknown as ArrayBuffer);}
    if(r.rows.length<8)break;
  }
}

export async function createInternalMergeJob(urls:string[]){
  await cleanupExpired();await mergeSchema();
  if(urls.length<2||urls.length>LIMITS.maxSources)throw new Error("عدد روابط الفيديو يجب أن يكون بين 2 و"+LIMITS.maxSources);
  const id=makeId(),now=Date.now(),expires=now+RETENTION_MS,db=getDb();
  await db.execute({sql:"INSERT INTO jobs(id,status,progress,created_at,expires_at) VALUES(?,?,?,?,?)",args:[id,"queued",0,now,expires]});
  for(let i=0;i<urls.length;i++){
    const u=new URL(urls[i]);if(!["http:","https:"].includes(u.protocol))throw new Error("رابط الفيديو غير صالح");
    await db.execute({sql:"INSERT INTO sources(job_id,seq,kind,url) VALUES(?,?,?,?)",args:[id,i,"url",u.toString()]});
  }
  return id;
}
export async function getInternalMergeStatus(id:string){
  const job=await getJob(id);if(!job)return null;
  const host=process.env.VERCEL_PROJECT_PRODUCTION_URL||process.env.VERCEL_URL;const origin=host?"https://"+host:"";
  return {state:String(job.status),progress:Number(job.progress||0),error:job.error?String(job.error):undefined,videoUrl:job.status==="done"?origin+"/api/jobs/"+id+"/video":null,size:job.output_size?Number(job.output_size):undefined,duration:job.duration?Number(job.duration):undefined,resolution:job.width&&job.height?String(job.width)+"x"+String(job.height):undefined,expiresAt:new Date(Number(job.expires_at)).toISOString()};
}
