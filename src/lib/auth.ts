import { timingSafeEqual } from "node:crypto";

function matches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isAuthorized(request: Request, expected = process.env.MCP_AUTH_TOKEN): boolean {
  if (!expected) return true;
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  return matches(supplied, expected);
}

export function isAdminAuthorized(request: Request): boolean {
  const expected = process.env.ADMIN_API_TOKEN || process.env.MCP_AUTH_TOKEN;
  if (!expected) return process.env.NODE_ENV !== "production";
  return matches(request.headers.get("x-admin-token") ?? "", expected);
}
