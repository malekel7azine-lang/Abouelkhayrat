import { NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/auth";
import { listTasks } from "@/lib/tasks";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
    return NextResponse.json({ tasks: await listTasks(Number.isFinite(limit) ? limit : 50) });
  } catch {
    return NextResponse.json({ error: "Unable to list tasks" }, { status: 503 });
  }
}