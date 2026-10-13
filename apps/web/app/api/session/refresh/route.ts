import { NextResponse } from "next/server";
import { apiFetch, ApiError, type User } from "@/lib/api";
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from "@/lib/session";

/** Swaps the cookie's refresh token for a new pair (rotation) and returns a fresh access token and the user. */
export async function POST() {
  const refreshToken = await readRefreshCookie();
  if (!refreshToken) return NextResponse.json({ code: "UNAUTHENTICATED", message: "Not signed in." }, { status: 401 });
  try {
    const pair = await apiFetch<{ accessToken: string; refreshToken: string }>("/auth/refresh", { method: "POST", body: { refreshToken } });
    await setRefreshCookie(pair.refreshToken);
    const user = await apiFetch<User>("/me", { token: pair.accessToken });
    return NextResponse.json({ accessToken: pair.accessToken, user });
  } catch (err) {
    await clearRefreshCookie();
    if (err instanceof ApiError) return NextResponse.json({ code: err.code, message: err.message }, { status: 401 });
    throw err;
  }
}
