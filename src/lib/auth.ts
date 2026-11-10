import { timingSafeEqual } from "node:crypto";

export function isAuthorized(request: Request, expected = process.env.MCP_AUTH_TOKEN): boolean {
  if (!expected) return true;
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isAdminAuthorized(request: Request): boolean {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) return process.env.NODE_ENV !== "production";
  const supplied = request.headers.get("x-admin-token") ?? "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}