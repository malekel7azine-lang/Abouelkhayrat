import { randomUUID } from "node:crypto";
import { ensureSchema, getDb } from "@/lib/db";
import { ProviderError } from "@/lib/provider-errors";
import { decryptProviderSecret, encryptProviderSecret } from "@/lib/secret-crypto";

export type ProviderName = "kie" | "cometapi";
export type ProviderKey = { id: string; provider: ProviderName; label: string; secret: string; status: string };

export async function listProviderKeys(provider: ProviderName): Promise<ProviderKey[]> {
  await ensureSchema();
  const result = await getDb().execute({
    sql: "SELECT id, provider, label, secret, status FROM api_keys WHERE provider = ? AND status != 'disabled' ORDER BY created_at ASC, id ASC",
    args: [provider]
  });
  const keys = (result.rows as unknown as ProviderKey[]).map(key => ({ ...key, secret: decryptProviderSecret(key.secret) }));
  if (keys.length) return keys;
  const envSecret = provider === "kie" ? process.env.KIE_API_KEY : process.env.COMETAPI_API_KEY;
  return envSecret ? [{ id: "env-" + provider, provider, label: "Environment key", secret: envSecret, status: "active" }] : [];
}

export async function markKeyStatus(key: ProviderKey, status: "active" | "exhausted" | "disabled"): Promise<void> {
  if (key.id.startsWith("env-")) return;
  await ensureSchema();
  await getDb().execute({
    sql: "UPDATE api_keys SET status = ?, updated_at = datetime('now') WHERE id = ?",
    args: [status, key.id]
  });
}

export async function addProviderKey(provider: ProviderName, label: string, secret: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: "INSERT INTO api_keys (id, provider, label, secret, status) VALUES (?, ?, ?, ?, 'active')",
    args: [randomUUID(), provider, label.trim().slice(0, 80) || provider, encryptProviderSecret(secret.trim())]
  });
}

export async function removeProviderKey(id: string): Promise<void> {
  await ensureSchema();
  if (id.startsWith("env-")) throw new ProviderError("Environment keys cannot be removed from the dashboard", "parameter");
  await getDb().execute({ sql: "DELETE FROM api_keys WHERE id = ?", args: [id] });
}

export async function providerKeySummary(): Promise<Array<{ id: string; provider: ProviderName; label: string; status: string; masked: string }>> {
  await ensureSchema();
  const result = await getDb().execute({
    sql: "SELECT id, provider, label, secret, status FROM api_keys ORDER BY created_at ASC, id ASC"
  });
  const rows = result.rows as unknown as ProviderKey[];
  const output = rows.map(key => {
    let plain = "";
    try { plain = decryptProviderSecret(key.secret); } catch { plain = ""; }
    return {
      id: key.id, provider: key.provider, label: key.label, status: key.status,
      masked: plain.length > 8 ? plain.slice(0, 3) + "••••••" + plain.slice(-3) : "••••••••"
    };
  });
  for (const provider of ["kie", "cometapi"] as const) {
    if (!rows.some(row => row.provider === provider)) {
      const secret = provider === "kie" ? process.env.KIE_API_KEY : process.env.COMETAPI_API_KEY;
      if (secret) output.push({ id: "env-" + provider, provider, label: "Environment key", status: "active", masked: "••••••••" });
    }
  }
  return output;
}
