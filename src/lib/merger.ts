import { ProviderError } from "@/lib/provider-errors";

const BASE = (process.env.MERGER_API_BASE || "").replace(/\/$/, "");

async function mergerRequest(path: string, init?: RequestInit): Promise<any> {
  if (!BASE) throw new ProviderError("Merger service is not configured", "fatal");
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      cache: "no-store"
    });
  } catch {
    throw new ProviderError("Merger service network failure", "temporary");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ProviderError("Merger service rejected the request", "fatal", response.status);
  return body;
}

export async function createMergeJob(clips: string[]): Promise<{ jobId: string }> {
  if (clips.length < 2 || clips.length > 10) throw new ProviderError("Provide between 2 and 10 public video URLs", "parameter");
  for (const clip of clips) {
    let url: URL;
    try { url = new URL(clip); } catch { throw new ProviderError("Invalid video URL", "parameter"); }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new ProviderError("Only public HTTP(S) URLs are supported", "parameter");
  }
  const created = await mergerRequest("/api/jobs", { method: "POST", body: JSON.stringify({ videos: clips }) });
  if (!created.jobId || typeof created.jobId !== "string") throw new ProviderError("Merger service did not return a job ID", "fatal");
  return { jobId: created.jobId };
}

export async function processMergeJob(jobId: string): Promise<void> {
  // Called once only after the job ID has been persisted in the tasks table.
  await mergerRequest("/api/jobs/" + encodeURIComponent(jobId) + "/process", { method: "POST" });
}

export async function getMergeJob(jobId: string): Promise<{ state: string; result: unknown; error?: string }> {
  const body = await mergerRequest("/api/jobs/" + encodeURIComponent(jobId), { method: "GET" });
  const state = String(body.status || "processing").toLowerCase();
  const result = {
    url: body.videoUrl || body.downloadUrl || null,
    progress: typeof body.progress === "number" ? body.progress : null,
    expiresAt: body.expiresAt || null,
    format: "mp4",
    videoCodec: "h264",
    audioCodec: "aac"
  };
  return { state, result, error: body.error ? String(body.error) : undefined };
}
