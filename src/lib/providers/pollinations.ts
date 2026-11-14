import { ProviderError } from "@/lib/provider-errors";

const BASE = "https://gen.pollinations.ai";

function getKey(): string {
  const key = process.env.POLLINATIONS_KEY || process.env.Pollinations_key || process.env.POLLINATIONS_API_KEY;
  if (!key) throw new ProviderError("Pollinations key is not configured", "temporary");
  return key.trim();
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      ...init,
      headers: { Authorization: "Bearer " + getKey(), ...(init.headers || {}) },
      cache: "no-store"
    });
  } catch {
    throw new ProviderError("Pollinations network request failed", "temporary");
  }
  if (!response.ok) {
    const message = (await response.text().catch(() => "")).slice(0, 300);
    if (response.status === 401 || response.status === 403) throw new ProviderError("Pollinations authentication failed", "unauthorized", response.status);
    if (response.status === 402) throw new ProviderError("Pollinations balance or key budget exhausted", "exhausted", 402);
    if (response.status === 429 || response.status >= 500) throw new ProviderError("Pollinations temporarily unavailable", "temporary", response.status);
    if (response.status === 400 || response.status === 422) throw new ProviderError("Pollinations rejected the request: " + message, "parameter", response.status);
    throw new ProviderError("Pollinations request failed (" + response.status + ")", "fatal", response.status);
  }
  return response;
}

export async function createPollinationsImage(input: Record<string, unknown>): Promise<unknown> {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new ProviderError("Image prompt is required", "parameter");
  const response = await request("/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: String(input.model || process.env.POLLINATIONS_IMAGE_MODEL || "black-forest-labs/flux.1-schnell"),
      prompt,
      n: 1,
      size: typeof input.size === "string" ? input.size : "1024x1024",
      response_format: "url"
    })
  });
  const body = await response.json().catch(() => ({})) as any;
  const item = body?.data?.[0];
  if (item?.url) return { url: item.url };
  if (item?.b64_json) return { b64_json: item.b64_json, format: body?.output_format || "png" };
  throw new ProviderError("Pollinations image response contained no image URL or data", "fatal");
}

export async function createPollinationsVideo(input: Record<string, unknown>): Promise<{ taskId: string }> {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new ProviderError("Video prompt is required", "parameter");
  const model = String(input.model || process.env.POLLINATIONS_VIDEO_MODEL || "google/veo-3.1-fast");
  const params = new URLSearchParams({ model });
  const duration = Number(input.duration || 4);
  if (Number.isFinite(duration) && duration > 0) params.set("duration", String(Math.min(10, Math.max(1, duration))));
  if (Array.isArray(input.image_urls) && input.image_urls[0]) params.set("image", String(input.image_urls[0]));
  const response = await request("/video/" + encodeURIComponent(prompt) + "?" + params.toString(), {
    headers: { Prefer: "respond-async" }
  });
  const body = await response.json().catch(() => ({})) as any;
  const taskId = body?.id || body?.job_id || body?.jobId;
  if (!taskId) {
    if (response.status === 200 && body?.data?.[0]?.url) {
      // A synchronous response is represented by a synthetic completed result in the caller.
      throw new ProviderError("Pollinations returned a completed video without an async task ID; retry with a supported async response", "fatal");
    }
    throw new ProviderError("Pollinations did not return an asynchronous job ID", "fatal");
  }
  return { taskId: String(taskId) };
}

export async function getPollinationsVideo(taskId: string): Promise<{ state: string; result: unknown; error?: string }> {
  const response = await request("/v1/jobs/" + encodeURIComponent(taskId));
  const body = await response.json().catch(() => ({})) as any;
  const state = String(body?.status || "processing").toLowerCase();
  if (state === "succeeded" || state === "completed" || state === "done") {
    const url = body?.result_url || body?.result?.url || body?.result?.data?.[0]?.url;
    return { state, result: url ? { url } : body?.result || body };
  }
  return { state, result: body?.result || body, error: body?.error?.message || body?.error };
}
