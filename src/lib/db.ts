import { createClient, type Client } from "@libsql/client";

let client: Client | undefined;
let schemaReady: Promise<void> | undefined;

export function getDb(): Client {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error("Database is not configured");
  client = createClient({ url, authToken });
  return client;
}

export async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = getDb();
      await db.batch([
        `CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          status TEXT NOT NULL,
          provider TEXT,
          model TEXT,
          input_json TEXT NOT NULL,
          result_json TEXT,
          error_code TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
        "CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC, id DESC)",
        `CREATE TABLE IF NOT EXISTS api_keys (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          label TEXT NOT NULL,
          secret TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
        "CREATE INDEX IF NOT EXISTS idx_api_keys_order ON api_keys(created_at ASC, id ASC)"
      ], "write");
    })().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
}
