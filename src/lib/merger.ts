import { ProviderError } from "@/lib/provider-errors";

const BASE = (process.env.MERGER_API_BASE || "").replace(/\/$/, "");

async function mergerRequest(path: string, init?: RequestInit): Promise<any> {
  if (!BASE) throw new ProviderError("Merger service is not configured", "fatal");
  let response: Response;
  try {
    response = await fetch(BASE + path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) }, cache: "no-store" });
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
    const url = new URL(clip);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new ProviderError("Only public HTTP(S) URLs are supported", "parameter");
  }
  const created = await mergerRequest("/api/jobs", { method: "POST", body: JSON.stringify({ clips }) });
  const jobId = created.jobId || created.id || created.data?.jobId;
  if (!jobId) throw new ProviderError("Merger service did not return a job ID", "fatal");
  await mergerRequest("/api/jobs/" + encodeURIComponent(String(jobId)) + "/process", { method: "POST", body: JSON.stringify({}) });
  return { jobId: String(jobId) };
}

export async function getMergeJob(jobId: string): Promise<{ state: string; result: unknown; error?: string }> {
  const body = await mergerRequest("/api/jobs/" + encodeURIComponent(jobId), { method: "GET" });
  const state = String(body.status || body.state || "processing").toLowerCase();
  return { state, result: body.result || body.output || body, error: body.error ? String(body.error) : undefined };
}
