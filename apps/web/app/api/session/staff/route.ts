import { NextResponse } from "next/server";
import { apiFetch, ApiError, type User } from "@/lib/api";
import { setRefreshCookie } from "@/lib/session";

/** Staff sign-in (email + password), stored the same way as OTP sign-in. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const s = await apiFetch<{ accessToken: string; refreshToken: string; user: User }>("/auth/staff/login", { method: "POST", body });
    await setRefreshCookie(s.refreshToken);
    return NextResponse.json({ accessToken: s.accessToken, user: s.user });
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ code: err.code, message: err.message }, { status: err.status });
    throw err;
  }
}
