import { createTask, getTask, updateTask } from "@/lib/tasks";
import { startMediaTask, startMergeTask, getTaskWithRefresh } from "@/lib/media-engine";

type ChildResult = { output?: unknown };
function parse(value: string | null): ChildResult { try { return value ? JSON.parse(value) as ChildResult : {}; } catch { return {}; } }
function findUrl(value: unknown, depth = 0): string | null {
  if (depth > 8 || value == null) return null;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("[") || value.startsWith("{")) { try { return findUrl(JSON.parse(value), depth + 1); } catch { return null; } }
    return null;
  }
  if (Array.isArray(value)) { for (const item of value) { const u = findUrl(item, depth + 1); if (u) return u; } return null; }
  if (typeof value === "object") { const o = value as Record<string, unknown>; for (const k of ["videoUrl","video_url","url","resultUrls","result_urls","videos","output","result","data"]) { if (k in o) { const u = findUrl(o[k], depth + 1); if (u) return u; } } }
  return null;
}
export async function startVideoBatch(prompts: string[], options: Record<string, unknown> = {}) {
  if (prompts.length < 2 || prompts.length > 10) throw new Error("أرسل من 2 إلى 10 أوصاف فيديو");
  const parent = await createTask("video_batch", { prompts, options });
  const childIds: string[] = [];
  for (const prompt of prompts) childIds.push(await startMediaTask("video", { ...options, prompt }));
  await updateTask(parent, { status: "processing", provider: "pipeline", model: "video-batch-auto-merge", result: { childIds, stage: "generating", retryAfter: Date.now() + 5000 } });
  return parent;
}
export async function refreshVideoBatch(parentId: string, state: Record<string, unknown>) {
  if (state.mergeTaskId) {
    const merged = await getTaskWithRefresh(String(state.mergeTaskId));
    if (merged?.status === "completed") await updateTask(parentId, { status: "completed", result: { stage: "done", output: parse(merged.result_json).output } });
    else if (merged?.status === "failed") await updateTask(parentId, { status: "failed", errorCode: "AUTO_MERGE_FAILED" });
    else await updateTask(parentId, { status: "processing", result: { ...state, retryAfter: Date.now() + 5000 } });
    return;
  }
  const ids = Array.isArray(state.childIds) ? state.childIds.map(String) : [];
  if (ids.length < 2) { await updateTask(parentId, { status: "failed", errorCode: "PIPELINE_INVALID" }); return; }
  const children = await Promise.all(ids.map(getTaskWithRefresh));
  if (children.some(c => !c || c.status === "failed")) { await updateTask(parentId, { status: "failed", errorCode: "VIDEO_GENERATION_FAILED" }); return; }
  if (!children.every(c => c?.status === "completed")) { await updateTask(parentId, { status: "processing", result: { ...state, stage: "generating", retryAfter: Date.now() + 5000 } }); return; }
  const urls = children.map(c => findUrl(parse(c!.result_json).output));
  if (urls.some(u => !u)) { await updateTask(parentId, { status: "failed", errorCode: "VIDEO_URL_MISSING" }); return; }
  const mergeTaskId = await startMergeTask(urls as string[]);
  await updateTask(parentId, { status: "processing", provider: "pipeline", model: "video-batch-auto-merge", result: { ...state, stage: "merging", mergeTaskId, retryAfter: Date.now() + 5000 } });
}
