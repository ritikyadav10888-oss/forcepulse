import { NextResponse } from "next/server";
import { apiFetch } from "@/lib/api";
import { clearRefreshCookie } from "@/lib/session";

/** Ends the session on the API (if the page still has an access token) and drops the cookie. */
export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (token) await apiFetch("/auth/logout", { method: "POST", token }).catch(() => undefined);
  await clearRefreshCookie();
  return new NextResponse(null, { status: 204 });
}
