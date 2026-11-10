import { ProviderError, classifyProviderFailure } from "@/lib/provider-errors";
import { listProviderKeys, markKeyStatus, type ProviderKey } from "@/lib/provider-keys";

const BASE = (process.env.KIE_BASE_URL || "https://api.kie.ai").replace(/\/$/, "");

async function requestWithKeys<T>(path: string, init: RequestInit, parse: (body: any, status: number) => T): Promise<{ value: T; key: ProviderKey }> {
  const keys = await listProviderKeys("kie");
  if (!keys.length) throw new ProviderError("No Kie.ai API keys configured", "temporary");
  let lastTemporary: ProviderError | undefined;
  for (const key of keys) {
    try {
      const response = await fetch(BASE + path, {
        ...init,
        headers: { Authorization: "Bearer " + key.secret, "Content-Type": "application/json", ...(init.headers || {}) },
        cache: "no-store"
      });
      const body = await response.json().catch(() => ({}));
      const code = body?.code;
      if (!response.ok || (code !== undefined && Number(code) !== 200)) {
        const error = classifyProviderFailure(response.status, code, String(body?.msg || body?.message || ""));
        if (error.kind === "unauthorized") { await markKeyStatus(key, "disabled"); continue; }
        if (error.kind === "exhausted") { await markKeyStatus(key, "exhausted"); lastTemporary = error; continue; }
        if (error.kind === "temporary") { lastTemporary = error; continue; }
        throw error;
      }
      return { value: parse(body, response.status), key };
    } catch (error) {
      if (error instanceof ProviderError) {
        if (error.kind === "parameter" || error.kind === "fatal") throw error;
        lastTemporary = error;
      } else {
        lastTemporary = new ProviderError("Kie.ai network request failed", "temporary");
      }
    }
  }
  throw lastTemporary || new ProviderError("No usable Kie.ai API key", "temporary");
}

export async function createKieTask(type: "image" | "video", input: Record<string, unknown>): Promise<{ taskId: string; providerKeyId: string }> {
  const model = String(input.model || (type === "image" ? process.env.IMAGE_MODEL : process.env.VIDEO_MODEL) || (type === "image" ? "gpt-image-2-6/flare-text-to-image" : "grok-imagine-video-1-5-preview"));
  const payload: Record<string, unknown> = { model, input: { prompt: input.prompt } };
  if (type === "image") {
    payload.input = {
      prompt: input.prompt,
      aspect_ratio: input.aspect_ratio || "1:1",
      resolution: input.resolution || "1K",
      quality: input.quality || "medium",
      output_format: input.output_format || "png"
    };
  } else {
    payload.input = {
      prompt: input.prompt,
      image_urls: Array.isArray(input.image_urls) ? input.image_urls : [],
      aspect_ratio: input.aspect_ratio || "16:9",
      resolution: input.resolution || "720p",
      duration: Math.max(1, Math.min(15, Number(input.duration || 8)))
    };
  }
  const result = await requestWithKeys("/api/v1/jobs/createTask", {
    method: "POST",
    body: JSON.stringify(payload)
  }, (body) => {
    const taskId = body?.data?.taskId;
    if (!taskId) throw new ProviderError("Kie.ai did not return a task ID", "fatal");
    return String(taskId);
  });
  return { taskId: result.value, providerKeyId: result.key.id };
}

export async function getKieTask(taskId: string, keyId?: string): Promise<{ state: string; result: unknown; error?: string }> {
  const keys = await listProviderKeys("kie");
  const ordered = keyId ? [...keys.filter(k => k.id === keyId), ...keys.filter(k => k.id !== keyId)] : keys;
  if (!ordered.length) throw new ProviderError("No Kie.ai API keys configured", "temporary");
  let last: ProviderError | undefined;
  for (const key of ordered) {
    try {
      const response = await fetch(BASE + "/api/v1/jobs/recordInfo?taskId=" + encodeURIComponent(taskId), {
        headers: { Authorization: "Bearer " + key.secret }, cache: "no-store"
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || (body?.code !== undefined && Number(body.code) !== 200)) {
        const error = classifyProviderFailure(response.status, body?.code, String(body?.msg || ""));
        if (error.kind === "unauthorized") { await markKeyStatus(key, "disabled"); continue; }
        if (error.kind === "exhausted") { await markKeyStatus(key, "exhausted"); last = error; continue; }
        if (error.kind === "temporary") { last = error; continue; }
        throw error;
      }
      const data = body?.data || {};
      let result: any = data.resultJson;
      if (typeof result === "string") { try { result = JSON.parse(result); } catch { result = { raw: result }; } }
      const state = String(data.state || "generating").toLowerCase();
      return { state, result, error: data.failMsg ? String(data.failMsg) : undefined };
    } catch (error) {
      if (error instanceof ProviderError && (error.kind === "parameter" || error.kind === "fatal")) throw error;
      last = error instanceof ProviderError ? error : new ProviderError("Kie.ai status request failed", "temporary");
    }
  }
  throw last || new ProviderError("Kie.ai task status unavailable", "temporary");
}
