import { NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/auth";
import { removeProviderKey } from "@/lib/provider-keys";
import { ensureSchema, getDb } from "@/lib/db";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await context.params;
    const body = await request.json() as { status?: "active" | "exhausted" | "disabled" };
    if (!["active", "exhausted", "disabled"].includes(String(body.status))) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    await ensureSchema();
    await getDb().execute({ sql: "UPDATE api_keys SET status = ?, updated_at = datetime('now') WHERE id = ?", args: [body.status!, id] });
    return NextResponse.json({ success: true });
  } catch { return NextResponse.json({ error: "Unable to update provider key" }, { status: 400 }); }
}

export async function DELETE(request: Request, context: Context) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await context.params;
    await removeProviderKey(id);
    return NextResponse.json({ success: true });
  } catch { return NextResponse.json({ error: "Unable to remove provider key" }, { status: 400 }); }
}
