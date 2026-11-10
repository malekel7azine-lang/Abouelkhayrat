import { randomUUID } from "node:crypto";
import { ensureSchema, getDb } from "@/lib/db";

export type TaskStatus = "queued" | "processing" | "completed" | "failed";
export type TaskRecord = {
  id: string; type: string; status: TaskStatus; provider: string | null;
  model: string | null; input_json: string; result_json: string | null;
  error_code: string | null; created_at: string; updated_at: string;
};

export async function createTask(type: string, input: unknown): Promise<string> {
  await ensureSchema();
  const id = randomUUID();
  await getDb().execute({
    sql: "INSERT INTO tasks (id,type,status,input_json) VALUES (?,?,?,?)",
    args: [id, type, "queued", JSON.stringify(input)]
  });
  return id;
}

export async function getTask(id: string): Promise<TaskRecord | null> {
  await ensureSchema();
  const result = await getDb().execute({ sql: "SELECT * FROM tasks WHERE id = ?", args: [id] });
  return (result.rows[0] as unknown as TaskRecord) ?? null;
}

export async function listTasks(limit = 50): Promise<TaskRecord[]> {
  await ensureSchema();
  const result = await getDb().execute({
    sql: "SELECT * FROM tasks ORDER BY created_at DESC, id DESC LIMIT ?",
    args: [Math.max(1, Math.min(200, limit))]
  });
  return result.rows as unknown as TaskRecord[];
}

export async function updateTask(id: string, patch: {
  status?: TaskStatus; provider?: string; model?: string; result?: unknown; errorCode?: string;
}): Promise<void> {
  await ensureSchema();
  const sets: string[] = ["updated_at = datetime('now')"];
  const args: (string | null)[] = [];
  if (patch.status) { sets.push("status = ?"); args.push(patch.status); }
  if (patch.provider !== undefined) { sets.push("provider = ?"); args.push(patch.provider); }
  if (patch.model !== undefined) { sets.push("model = ?"); args.push(patch.model); }
  if (patch.result !== undefined) { sets.push("result_json = ?"); args.push(JSON.stringify(patch.result)); }
  if (patch.errorCode !== undefined) { sets.push("error_code = ?"); args.push(patch.errorCode); }
  args.push(id);
  await getDb().execute({ sql: `UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, args });
}