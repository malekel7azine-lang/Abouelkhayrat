import { createTask, getTask, updateTask, type TaskRecord } from "@/lib/tasks";
import { acquireTaskLock, releaseTaskLock } from "@/lib/task-lock";
import { ProviderError } from "@/lib/provider-errors";
import { createKieTask, getKieTask } from "@/lib/providers/kie";
import { createCometImage, createCometVideo, getCometVideo } from "@/lib/providers/cometapi";
import { createInternalMergeJob, getInternalMergeStatus } from "@/lib/merge-store";
import { processMerge } from "@/lib/merge-engine";

type MediaKind = "image" | "video" | "merge";
type StoredResult = { providerTaskId?: string; provider?: string; providerKeyId?: string; retryAfter?: number; processRequested?: boolean; output?: unknown; error?: string };

function parseStored(value: string | null): StoredResult {
  if (!value) return {};
  try { return JSON.parse(value) as StoredResult; } catch { return {}; }
}

async function setPending(taskId: string, message = "TEMPORARY_PROVIDER_FAILURE") {
  await updateTask(taskId, { status: "processing", result: { retryAfter: Date.now() + 45_000, error: message } });
}

async function beginWithFallback(taskId: string, kind: "image" | "video", input: Record<string, unknown>): Promise<void> {
  await updateTask(taskId, { status: "processing" });
  const providers: Array<"kie" | "cometapi"> = ["kie", "cometapi"];
  let lastError: ProviderError | undefined;
  for (const provider of providers) {
    try {
      if (provider === "kie") {
        const created = await createKieTask(kind, input);
        await updateTask(taskId, {
          status: "processing", provider: "kie",
          model: String(input.model || (kind === "image" ? process.env.IMAGE_MODEL : process.env.VIDEO_MODEL) || ""),
          result: { provider: "kie", providerTaskId: created.taskId, providerKeyId: created.providerKeyId }
        });
        return;
      }
      if (provider === "cometapi" && kind === "image") {
        const output = await createCometImage(input);
        await updateTask(taskId, { status: "completed", provider: "cometapi", model: String(process.env.COMET_IMAGE_MODEL || "gpt-image-2.6-flare"), result: { provider: "cometapi", output } });
        return;
      }
      if (provider === "cometapi" && kind === "video") {
        const created = await createCometVideo(input);
        await updateTask(taskId, { status: "processing", provider: "cometapi", model: String(process.env.COMET_VIDEO_MODEL || "grok-imagine-video-1.5"), result: { provider: "cometapi", providerTaskId: created.taskId } });
        return;
      }
    } catch (error) {
      if (error instanceof ProviderError && (error.kind === "parameter" || error.kind === "fatal")) {
        await updateTask(taskId, { status: "failed", errorCode: error.kind.toUpperCase() });
        return;
      }
      lastError = error instanceof ProviderError ? error : new ProviderError("Provider request failed", "temporary");
    }
  }
  await setPending(taskId, lastError?.kind.toUpperCase() || "TEMPORARY_PROVIDER_FAILURE");
}

export async function startMediaTask(kind: "image" | "video", input: Record<string, unknown>): Promise<string> {
  const taskId = await createTask(kind, input);
  await beginWithFallback(taskId, kind, input);
  return taskId;
}

export async function startMergeTask(clips: string[]): Promise<string> {
  const taskId = await createTask("merge", { clips });
  try {
    const jobId = await createInternalMergeJob(clips);
    await updateTask(taskId, { status: "processing", provider: "merger", model: "ffmpeg-turso-v2", result: { provider: "merger", providerTaskId: jobId, processRequested: true } });
    try {
      const result = await processMerge(jobId);
      await updateTask(taskId, { status: "completed", result: { provider: "merger", output: { ...result, videoUrl: "/api/jobs/" + jobId + "/video", downloadUrl: "/api/jobs/" + jobId + "/video?download=1" } } });
    } catch (error) {
      await updateTask(taskId, { status: "failed", errorCode: "MERGER_PROCESS_FAILED", result: { provider: "merger", error: error instanceof Error ? error.message : "Merge failed" } });
    }
  } catch (error) {
    await updateTask(taskId, { status: "failed", errorCode: error instanceof Error ? "MERGER_FAILED" : "MERGER_PROCESS_FAILED" });
  }
  return taskId;
}

function terminalSuccess(state: string): boolean { return ["success", "completed", "succeeded", "done"].includes(state); }
function terminalFailure(state: string): boolean { return ["fail", "failed", "error", "cancelled", "canceled"].includes(state); }

async function refreshRemote(task: TaskRecord, stored: StoredResult): Promise<void> {
  if (!stored.providerTaskId) return;
  try {
    let status: { state: string; result: unknown; error?: string };
    if (task.provider === "kie") status = await getKieTask(stored.providerTaskId, stored.providerKeyId);
    else if (task.provider === "cometapi") status = await getCometVideo(stored.providerTaskId);
    else if (task.provider === "merger") { const internal = await getInternalMergeStatus(stored.providerTaskId); if (!internal) throw new ProviderError("Merge task not found", "fatal"); status = { state: internal.state, result: internal, error: internal.error }; }
    else return;

    if (terminalSuccess(status.state)) {
      await updateTask(task.id, { status: "completed", result: { provider: task.provider, output: status.result } });
    } else if (terminalFailure(status.state)) {
      await updateTask(task.id, { status: "failed", errorCode: "PROVIDER_TASK_FAILED", result: { provider: task.provider, error: "Provider task failed" } });
    } else {
      const pollDelay = task.provider === "cometapi" ? 10_000 : task.provider === "merger" ? 5_000 : 3_000;
      await updateTask(task.id, { status: "processing", result: { ...stored, retryAfter: Date.now() + pollDelay } });
    }
  } catch (error) {
    if (error instanceof ProviderError && (error.kind === "parameter" || error.kind === "fatal")) {
      await updateTask(task.id, { status: "failed", errorCode: "PROVIDER_TASK_FAILED" });
    } else {
      await updateTask(task.id, { status: "processing", result: { ...stored, retryAfter: Date.now() + 45_000 } });
    }
  }
}

export async function getTaskWithRefresh(taskId: string): Promise<TaskRecord | null> {
  const lockToken = await acquireTaskLock(taskId);
  if (!lockToken) return getTask(taskId);
  try {
    let task = await getTask(taskId);
    if (!task || task.status !== "processing") return task;
    const stored = parseStored(task.result_json);
    if (task.type === "video_batch") {
      if (!stored.retryAfter || Date.now() >= stored.retryAfter) {
        const { refreshVideoBatch } = await import("@/lib/video-batch");
        await refreshVideoBatch(task.id, stored as Record<string, unknown>);
      }
    } else if (stored.providerTaskId) {
      if (!stored.retryAfter || Date.now() >= stored.retryAfter) await refreshRemote(task, stored);
    } else if (stored.retryAfter && Date.now() >= stored.retryAfter) {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(task.input_json) as Record<string, unknown>; } catch { /* keep empty */ }
      if (task.type === "merge") {
        try {
          const jobId = await createInternalMergeJob(Array.isArray(input.clips) ? input.clips.map(String) : []);
          await updateTask(task.id, { status: "processing", provider: "merger", model: "ffmpeg-turso-v2", result: { provider: "merger", providerTaskId: jobId, processRequested: true } });
          try { const output = await processMerge(jobId); await updateTask(task.id, { status: "completed", result: { provider: "merger", output: { ...output, videoUrl: "/api/jobs/" + jobId + "/video" } } }); }
          catch { await updateTask(task.id, { status: "failed", errorCode: "MERGER_PROCESS_FAILED" }); }
        } catch (error) {
          if (error instanceof ProviderError && error.kind !== "temporary") await updateTask(task.id, { status: "failed", errorCode: error.kind.toUpperCase() });
          else await setPending(task.id);
        }
      } else {
        await beginWithFallback(task.id, task.type as "image" | "video", input);
      }
    }
    task = await getTask(taskId);
    return task;
  } finally {
    await releaseTaskLock(taskId, lockToken).catch(() => undefined);
  }
}

export function publicTask(task: TaskRecord) {
  const stored = parseStored(task.result_json);
  return {
    id: task.id, type: task.type, status: task.status, provider: task.provider, model: task.model,
    result: stored.output ?? (task.type === "video_batch" ? { stage: (stored as Record<string, unknown>).stage || "generating", child_task_ids: (stored as Record<string, unknown>).childTaskIds || [] } : null), error_code: task.error_code,
    created_at: task.created_at, updated_at: task.updated_at
  };
}
