import { NextResponse } from "next/server";
import { apiFetch, ApiError, type User } from "@/lib/api";
import { setRefreshCookie } from "@/lib/session";

/** OTP sign-in: the API checks the code; the refresh token goes into the cookie, the access token back to the page. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const s = await apiFetch<{ accessToken: string; refreshToken: string; user: User; isNewUser: boolean }>("/auth/verify", { method: "POST", body });
    await setRefreshCookie(s.refreshToken);
    return NextResponse.json({ accessToken: s.accessToken, user: s.user, isNewUser: s.isNewUser });
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ code: err.code, message: err.message, details: err.details }, { status: err.status });
    throw err;
  }
}
