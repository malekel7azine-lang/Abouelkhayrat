import { ProviderError, classifyProviderFailure } from "@/lib/provider-errors";
import { listProviderKeys, markKeyStatus, type ProviderKey } from "@/lib/provider-keys";

const BASE = (process.env.COMETAPI_BASE_URL || "https://api.cometapi.com").replace(/\/$/, "");

async function withCometKeys<T>(call: (key: ProviderKey) => Promise<T>): Promise<T> {
  const keys = await listProviderKeys("cometapi");
  if (!keys.length) throw new ProviderError("No CometAPI keys configured", "temporary");
  let last: ProviderError | undefined;
  for (const key of keys) {
    try { return await call(key); }
    catch (error) {
      const e = error instanceof ProviderError ? error : new ProviderError("CometAPI network request failed", "temporary");
      if (e.kind === "unauthorized") { await markKeyStatus(key, "disabled"); continue; }
      if (e.kind === "exhausted") { await markKeyStatus(key, "exhausted"); last = e; continue; }
      if (e.kind === "temporary") { last = e; continue; }
      throw e;
    }
  }
  throw last || new ProviderError("No usable CometAPI key", "temporary");
}

async function parseResponse(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw classifyProviderFailure(response.status, body?.error?.code || body?.code, String(body?.error?.message || body?.message || ""));
  if (body?.error) throw classifyProviderFailure(response.status || 400, body.error.code, String(body.error.message || ""));
  return body;
}

export async function createCometImage(input: Record<string, unknown>): Promise<unknown> {
  return withCometKeys(async key => {
    const response = await fetch(BASE + "/v1/images/generations", {
      method: "POST",
      headers: { Authorization: "Bearer " + key.secret, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: String(input.model || process.env.COMET_IMAGE_MODEL || "gpt-image-2.6"),
        prompt: input.prompt,
        n: 1,
        size: input.size || "1024x1024"
      }),
      cache: "no-store"
    });
    const body = await parseResponse(response);
    const item = body?.data?.[0];
    if (!item?.url && !item?.b64_json) throw new ProviderError("CometAPI image response contained no image", "fatal");
    return item.url ? { url: item.url } : { b64_json: item.b64_json, revised_prompt: item.revised_prompt };
  });
}

export async function createCometVideo(input: Record<string, unknown>): Promise<{ taskId: string }> {
  return withCometKeys(async key => {
    const form = new FormData();
    form.set("model", String(input.model || process.env.COMET_VIDEO_MODEL || "grok-imagine-video-1-5-preview"));
    form.set("prompt", String(input.prompt || ""));
    if (input.duration !== undefined) form.set("duration", String(input.duration));
    if (input.aspect_ratio) form.set("aspect_ratio", String(input.aspect_ratio));
    const response = await fetch(BASE + "/v1/videos", {
      method: "POST",
      headers: { Authorization: "Bearer " + key.secret },
      body: form,
      cache: "no-store"
    });
    const body = await parseResponse(response);
    const taskId = body?.task_id || body?.id;
    if (!taskId) throw new ProviderError("CometAPI did not return a video task ID", "fatal");
    return { taskId: String(taskId) };
  });
}

export async function getCometVideo(taskId: string): Promise<{ state: string; result: unknown; error?: string }> {
  return withCometKeys(async key => {
    const response = await fetch(BASE + "/v1/videos/" + encodeURIComponent(taskId), {
      headers: { Authorization: "Bearer " + key.secret }, cache: "no-store"
    });
    const body = await parseResponse(response);
    const state = String(body.status || "processing").toLowerCase();
    return { state, result: body.video_url ? { url: body.video_url } : body.result || body, error: body.error?.message };
  });
}
