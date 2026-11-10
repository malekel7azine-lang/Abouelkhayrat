import { createTask, getTask, updateTask, type TaskRecord } from "@/lib/tasks";
import { ProviderError } from "@/lib/provider-errors";
import { createKieTask, getKieTask } from "@/lib/providers/kie";
import { createCometImage, createCometVideo, getCometVideo } from "@/lib/providers/cometapi";
import { createMergeJob, getMergeJob } from "@/lib/merger";

type MediaKind = "image" | "video" | "merge";
type StoredResult = { providerTaskId?: string; provider?: string; retryAfter?: number; output?: unknown; error?: string };

function parseStored(value: string | null): StoredResult {
  if (!value) return {};
  try { return JSON.parse(value) as StoredResult; } catch { return {}; }
}

async function setPending(taskId: string, input: unknown, message = "TEMPORARY_PROVIDER_FAILURE") {
  await updateTask(taskId, { status: "processing", result: { retryAfter: Date.now() + 45_000, error: message } });
}

async function beginWithFallback(taskId: string, kind: MediaKind, input: Record<string, unknown>): Promise<void> {
  await updateTask(taskId, { status: "processing", errorCode: undefined });
  const providers: Array<"kie" | "cometapi"> = ["kie", "cometapi"];
  let lastError: ProviderError | undefined;
  for (const provider of providers) {
    try {
      if (provider === "kie" && kind !== "merge") {
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
        await updateTask(taskId, { status: "completed", provider: "cometapi", model: String(input.model || process.env.COMET_IMAGE_MODEL || ""), result: { provider: "cometapi", output } });
        return;
      }
      if (provider === "cometapi" && kind === "video") {
        const created = await createCometVideo(input);
        await updateTask(taskId, { status: "processing", provider: "cometapi", model: String(input.model || process.env.COMET_VIDEO_MODEL || ""), result: { provider: "cometapi", providerTaskId: created.taskId } });
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
  await setPending(taskId, input, lastError?.kind.toUpperCase() || "TEMPORARY_PROVIDER_FAILURE");
}

export async function startMediaTask(kind: "image" | "video", input: Record<string, unknown>): Promise<string> {
  const taskId = await createTask(kind, input);
  await beginWithFallback(taskId, kind, input);
  return taskId;
}

export async function startMergeTask(clips: string[]): Promise<string> {
  const taskId = await createTask("merge", { clips });
  try {
    const job = await createMergeJob(clips);
    await updateTask(taskId, { status: "processing", provider: "merger", model: "merger-v2", result: { provider: "merger", providerTaskId: job.jobId } });
  } catch (error) {
    if (error instanceof ProviderError && error.kind === "temporary") await setPending(taskId, { clips });
    else await updateTask(taskId, { status: "failed", errorCode: error instanceof ProviderError ? error.kind.toUpperCase() : "MERGER_FAILED" });
  }
  return taskId;
}

function terminalSuccess(state: string): boolean { return ["success", "completed", "succeeded", "done"].includes(state); }
function terminalFailure(state: string): boolean { return ["fail", "failed", "error", "cancelled", "canceled"].includes(state); }

async function refreshRemote(task: TaskRecord, stored: StoredResult): Promise<void> {
  if (!stored.providerTaskId) return;
  try {
    let status: { state: string; result: unknown; error?: string };
    if (task.provider === "kie") status = await getKieTask(stored.providerTaskId, String((stored as any).providerKeyId || ""));
    else if (task.provider === "cometapi") status = await getCometVideo(stored.providerTaskId);
    else if (task.provider === "merger") status = await getMergeJob(stored.providerTaskId);
    else return;

    if (terminalSuccess(status.state)) {
      await updateTask(task.id, { status: "completed", result: { provider: task.provider, output: status.result } });
    } else if (terminalFailure(status.state)) {
      await updateTask(task.id, { status: "failed", errorCode: "PROVIDER_TASK_FAILED", result: { provider: task.provider, error: "Provider task failed" } });
    }
  } catch (error) {
    if (error instanceof ProviderError && (error.kind === "parameter" || error.kind === "fatal")) {
      await updateTask(task.id, { status: "failed", errorCode: "PROVIDER_TASK_FAILED" });
    }
  }
}

export async function getTaskWithRefresh(taskId: string): Promise<TaskRecord | null> {
  let task = await getTask(taskId);
  if (!task || task.status !== "processing") return task;
  const stored = parseStored(task.result_json);
  if (stored.providerTaskId) {
    await refreshRemote(task, stored);
  } else if (stored.retryAfter && Date.now() >= stored.retryAfter) {
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(task.input_json) as Record<string, unknown>; } catch { /* keep empty */ }
    if (task.type === "merge") {
      const clips = Array.isArray(input.clips) ? input.clips.map(String) : [];
      try {
        const job = await createMergeJob(clips);
        await updateTask(task.id, { status: "processing", provider: "merger", model: "merger-v2", result: { provider: "merger", providerTaskId: job.jobId } });
      } catch (error) {
        if (error instanceof ProviderError && error.kind !== "temporary") await updateTask(task.id, { status: "failed", errorCode: error.kind.toUpperCase() });
        else await setPending(task.id, input);
      }
    } else {
      await beginWithFallback(task.id, task.type as "image" | "video", input);
    }
  }
  task = await getTask(taskId);
  return task;
}

export function publicTask(task: TaskRecord) {
  const stored = parseStored(task.result_json);
  return {
    id: task.id, type: task.type, status: task.status, provider: task.provider, model: task.model,
    result: stored.output ?? null, error_code: task.error_code,
    created_at: task.created_at, updated_at: task.updated_at
  };
}
