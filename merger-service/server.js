import http from "node:http";
import { randomUUID, timingSafeEqual, createHmac } from "node:crypto";
import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import dns from "node:dns/promises";
import net from "node:net";
import { spawn } from "node:child_process";
import { createClient } from "@libsql/client";
import { put, get, del } from "@vercel/blob";

const PORT = Number(process.env.PORT || 80);
const TOKEN = process.env.MERGER_API_TOKEN || "";
const RETENTION_MS = 24 * 60 * 60 * 1000;
const DOWNLOAD_URL_TTL = 60 * 60;
const MAX_CLIP_BYTES = 150 * 1024 * 1024;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;
const jobsDb = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || ""
});
let schemaReady;

function send(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}
function auth(req) {
  const supplied = Buffer.from(req.headers.authorization || "");
  const expected = Buffer.from("Bearer " + TOKEN);
  return !!TOKEN && supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
async function ensureSchema() {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) throw Error("Turso database is not configured");
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw Error("Vercel Blob is not configured");
  if (!schemaReady) {
    schemaReady = jobsDb.execute(`CREATE TABLE IF NOT EXISTS merger_jobs (
      id TEXT PRIMARY KEY,
      videos_json TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      blob_path TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`).catch((error) => { schemaReady = undefined; throw error; });
  }
  await schemaReady;
}
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const x = ip.toLowerCase();
  return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") ||
    /^fe[89ab]/.test(x) || x.startsWith("::ffff:127.") || x.startsWith("::ffff:10.");
}
async function publicUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw Error("Invalid video URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw Error("Only public HTTP(S) URLs are allowed");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw Error("Private host rejected");
  const ips = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true, verbatim: true });
  if (!ips.length || ips.some((entry) => privateIp(entry.address))) throw Error("URL resolves to a private address");
  return url;
}
async function download(url, file) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "error" });
    if (!response.ok || !response.body) throw Error("Could not download source clip");
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_CLIP_BYTES) throw Error("Source clip exceeds 150 MB");
    const handle = await fs.open(file, "w");
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_CLIP_BYTES) throw Error("Source clip exceeds 150 MB");
        await handle.write(chunk);
      }
    } finally { await handle.close(); }
    return size;
  } finally { clearTimeout(timer); }
}
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-5000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(Error(stderr || "FFmpeg failed")));
  });
}
async function updateJob(id, fields) {
  const sets = [];
  const args = [];
  for (const [key, value] of Object.entries(fields)) { sets.push(key + " = ?"); args.push(value); }
  args.push(id);
  await jobsDb.execute({ sql: "UPDATE merger_jobs SET " + sets.join(", ") + " WHERE id = ?", args });
}
async function readJob(id) {
  const result = await jobsDb.execute({ sql: "SELECT * FROM merger_jobs WHERE id = ?", args: [id] });
  return result.rows[0] || null;
}
function signedDownloadUrl(req, id, expiresAt) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const expires = Math.min(expiresAt, Math.floor(Date.now() / 1000) + DOWNLOAD_URL_TTL);
  const signature = createHmac("sha256", TOKEN).update(id + ":" + expires).digest("hex");
  return proto + "://" + host + "/api/jobs/" + id + "/download?expires=" + expires + "&sig=" + signature;
}
function validDownloadSignature(id, expires, signature) {
  if (!TOKEN || !/^\d+$/.test(expires || "") || !/^[a-f0-9]{64}$/i.test(signature || "")) return false;
  const expiry = Number(expires);
  if (!Number.isSafeInteger(expiry) || expiry < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(createHmac("sha256", TOKEN).update(id + ":" + expiry).digest("hex"));
  const supplied = Buffer.from(signature);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
async function cleanupExpired() {
  const now = Date.now();
  const expired = await jobsDb.execute({ sql: "SELECT id, blob_path FROM merger_jobs WHERE expires_at <= ?", args: [now] });
  for (const row of expired.rows) {
    if (row.blob_path) await del(String(row.blob_path), { access: "private" }).catch(() => undefined);
    await jobsDb.execute({ sql: "DELETE FROM merger_jobs WHERE id = ?", args: [String(row.id)] });
  }
}
async function processJob(job) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "merger-"));
  try {
    const videos = JSON.parse(String(job.videos_json));
    const inputs = [];
    let totalBytes = 0;
    for (let i = 0; i < videos.length; i++) {
      const url = await publicUrl(videos[i]);
      const file = path.join(dir, "clip-" + i + ".mp4");
      totalBytes += await download(url.href, file);
      if (totalBytes > MAX_TOTAL_BYTES) throw Error("Combined source clips exceed 500 MB");
      inputs.push(file);
      await updateJob(String(job.id), { progress: Math.round(5 + ((i + 1) / videos.length) * 30) });
    }
    const args = [];
    for (const file of inputs) args.push("-i", file);
    const filters = inputs.map((_, i) =>
      "[" + i + ":v:0]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v" + i + "];" +
      "[" + i + ":a:0]aresample=48000[a" + i + "]"
    ).join(";");
    const concat = inputs.map((_, i) => "[v" + i + "][a" + i + "]").join("") +
      "concat=n=" + inputs.length + ":v=1:a=1[v][a]";
    const output = path.join(dir, "merged.mp4");
    args.push("-y", "-filter_complex", filters + ";" + concat, "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart", "-t", "3600", output);
    await updateJob(String(job.id), { progress: 40 });
    await runFfmpeg(args);
    await updateJob(String(job.id), { progress: 85 });
    const blob = await put("merged/" + String(job.id) + ".mp4", createReadStream(output), {
      access: "private",
      addRandomSuffix: true,
      contentType: "video/mp4"
    });
    await updateJob(String(job.id), { status: "completed", progress: 100, blob_path: blob.pathname });
  } catch (error) {
    await updateJob(String(job.id), { status: "failed", error: String(error?.message || "Merge failed").slice(0, 500) });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://" + (req.headers.host || "localhost"));
    if (url.pathname === "/health" && req.method === "GET") {
      await ensureSchema();
      return send(res, 200, { status: "ok", service: "merger-api-v2", database: "connected", storage: "connected" });
    }
    const match = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)(?:\/(process|download))?$/i);
    if (match && req.method === "GET" && match[2] === "download") {
      if (!validDownloadSignature(match[1], url.searchParams.get("expires"), url.searchParams.get("sig"))) return send(res, 401, { error: "Invalid or expired download link" });
      await ensureSchema();
      const job = await readJob(match[1]);
      if (!job || job.status !== "completed" || !job.blob_path || Number(job.expires_at) <= Date.now()) return send(res, 404, { error: "Video not found or expired" });
      const blob = await get(String(job.blob_path), { access: "private" });
      if (!blob || blob.statusCode !== 200 || !blob.stream) return send(res, 404, { error: "Video file not found" });
      res.writeHead(200, {
        "content-type": "video/mp4",
        "content-disposition": 'attachment; filename="merged.mp4"',
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff"
      });
      const { Readable } = await import("node:stream");
      return Readable.fromWeb(blob.stream).on("error", () => res.destroy()).pipe(res);
    }
    if (!auth(req)) return send(res, 401, { error: "Unauthorized" });
    await ensureSchema();
    await cleanupExpired();

    if (url.pathname === "/api/jobs" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 200000) return send(res, 413, { error: "Request too large" });
      }
      let data;
      try { data = JSON.parse(raw); } catch { return send(res, 400, { error: "Invalid JSON" }); }
      if (!Array.isArray(data.videos) || data.videos.length < 2 || data.videos.length > 10 || data.videos.some((v) => typeof v !== "string")) {
        return send(res, 400, { error: "Provide 2 to 10 video URLs" });
      }
      const id = randomUUID();
      const now = Date.now();
      await jobsDb.execute({
        sql: "INSERT INTO merger_jobs (id, videos_json, status, progress, created_at, expires_at) VALUES (?, ?, 'queued', 0, ?, ?)",
        args: [id, JSON.stringify(data.videos), now, now + RETENTION_MS]
      });
      return send(res, 201, { jobId: id, status: "queued" });
    }

    if (!match) return send(res, 404, { error: "Not found" });
    const job = await readJob(match[1]);
    if (!job || Number(job.expires_at) <= Date.now()) return send(res, 404, { error: "Job not found or expired" });

    if (req.method === "POST" && match[2] === "process") {
      const claim = await jobsDb.execute({
        sql: "UPDATE merger_jobs SET status = 'processing', progress = 1 WHERE id = ? AND status = 'queued'",
        args: [match[1]]
      });
      if (Number(claim.rowsAffected) > 0) {
        const claimed = await readJob(match[1]);
        await processJob(claimed);
      }
      const updated = await readJob(match[1]);
      return send(res, updated?.status === "failed" ? 200 : 202, {
        jobId: match[1], status: updated?.status || "failed", progress: Number(updated?.progress || 0), error: updated?.error || null
      });
    }

    if (req.method === "GET" && !match[2]) {
      const state = String(job.status);
      return send(res, 200, {
        jobId: match[1], status: state, progress: Number(job.progress || 0),
        videoUrl: state === "completed" && job.blob_path
          ? signedDownloadUrl(req, match[1], Math.floor(Number(job.expires_at) / 1000))
          : null,
        expiresAt: new Date(Number(job.expires_at)).toISOString(),
        error: job.error || null
      });
    }
    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("Merger API error:", error);
    if (!res.headersSent) send(res, 500, { error: String(error?.message || "Internal server error").slice(0, 300) });
    else res.destroy();
  }
});

server.listen(PORT, "0.0.0.0", () => console.log("Merger API v2 listening on " + PORT));
