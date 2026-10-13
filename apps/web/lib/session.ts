import { cookies } from "next/headers";

// The refresh token lives only in an httpOnly cookie on the web app's own origin: page scripts can't read it.
export const REFRESH_COOKIE = "fp_refresh";
const THIRTY_DAYS = 30 * 24 * 60 * 60;

export async function setRefreshCookie(token: string) {
  (await cookies()).set(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/session",
    maxAge: THIRTY_DAYS,
  });
}

export async function clearRefreshCookie() {
  (await cookies()).delete({ name: REFRESH_COOKIE, path: "/api/session" });
}

export async function readRefreshCookie() {
  return (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
}
