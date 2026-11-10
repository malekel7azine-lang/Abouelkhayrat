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
        model: String(process.env.COMET_IMAGE_MODEL || "gpt-image-2.6-flare"),
        prompt: input.prompt,
        n: 1,
        size: input.size || "1024x1024",
        quality: input.quality || "medium",
        output_format: input.output_format || "png"
      }),
      cache: "no-store"
    });
    const body = await parseResponse(response);
    const item = body?.data?.[0];
    if (!item?.url && !item?.b64_json) throw new ProviderError("CometAPI image response contained no image", "fatal");
    return item.url ? { url: item.url } : { b64_json: item.b64_json, revised_prompt: item.revised_prompt, format: body.output_format || input.output_format || "png" };
  });
}

export async function createCometVideo(input: Record<string, unknown>): Promise<{ taskId: string }> {
  return withCometKeys(async key => {
    const imageUrls = Array.isArray(input.image_urls) ? input.image_urls : [];
    const payload: Record<string, unknown> = {
      model: String(process.env.COMET_VIDEO_MODEL || "grok-imagine-video-1.5"),
      prompt: input.prompt,
      duration: Math.max(1, Math.min(15, Number(input.duration || 8))),
      aspect_ratio: input.aspect_ratio || "16:9",
      resolution: input.resolution || "720p"
    };
    if (imageUrls.length) payload.image = imageUrls[0];
    const response = await fetch(BASE + "/grok/v1/videos/generations", {
      method: "POST",
      headers: { Authorization: "Bearer " + key.secret, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store"
    });
    const body = await parseResponse(response);
    const taskId = body?.request_id || body?.id || body?.data?.request_id;
    if (!taskId) throw new ProviderError("CometAPI did not return a video task ID", "fatal");
    return { taskId: String(taskId) };
  });
}

export async function getCometVideo(taskId: string): Promise<{ state: string; result: unknown; error?: string }> {
  return withCometKeys(async key => {
    const response = await fetch(BASE + "/grok/v1/videos/" + encodeURIComponent(taskId), {
      headers: { Authorization: "Bearer " + key.secret }, cache: "no-store"
    });
    const body = await parseResponse(response);
    const data = body?.data || body;
    const nested = data?.data || data?.result || {};
    const videoUrl = nested?.video?.url || nested?.video_url || data?.video_url || body?.video_url;
    const state = String(data?.status || body?.status || "processing").toLowerCase();
    return {
      state,
      result: videoUrl ? { url: videoUrl } : nested,
      error: data?.error?.message || data?.error || body?.error?.message
    };
  });
}
