import { randomUUID } from "node:crypto";
import { ensureSchema, getDb } from "@/lib/db";

export async function acquireTaskLock(taskId: string, ttlSeconds = 60): Promise<string | null> {
  await ensureSchema();
  const token = randomUUID();
  const result = await getDb().execute({
    sql: `INSERT INTO task_locks (task_id, lock_token, locked_until)
          VALUES (?, ?, datetime('now', '+' || ? || ' seconds'))
          ON CONFLICT(task_id) DO UPDATE SET
            lock_token = excluded.lock_token,
            locked_until = excluded.locked_until
          WHERE task_locks.locked_until < datetime('now')
          RETURNING lock_token`,
    args: [taskId, token, ttlSeconds]
  });
  return result.rows.length ? token : null;
}

export async function releaseTaskLock(taskId: string, token: string): Promise<void> {
  await getDb().execute({
    sql: "DELETE FROM task_locks WHERE task_id = ? AND lock_token = ?",
    args: [taskId, token]
  });
}
