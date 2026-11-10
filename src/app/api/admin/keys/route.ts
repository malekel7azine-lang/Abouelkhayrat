import { NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/auth";
import { addProviderKey, providerKeySummary, type ProviderName } from "@/lib/provider-keys";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ keys: await providerKeySummary() }); }
  catch { return NextResponse.json({ error: "Unable to load provider keys" }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as { provider?: ProviderName; label?: string; secret?: string };
    if (!["kie", "cometapi"].includes(String(body.provider)) || !body.secret?.trim()) {
      return NextResponse.json({ error: "Provider and API key are required" }, { status: 400 });
    }
    await addProviderKey(body.provider as ProviderName, body.label || body.provider, body.secret);
    return NextResponse.json({ success: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to save provider key" }, { status: 400 });
  }
}
