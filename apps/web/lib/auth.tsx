"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { apiFetch, ApiError, PUBLIC_API_URL, type User } from "./api";

interface Auth {
  user: User | null;
  /** True until the first session check finishes. */
  loading: boolean;
  signIn(phone: string, code: string): Promise<{ isNewUser: boolean }>;
  staffSignIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** A call to the API as the signed-in user; refreshes an expired access token once. */
  call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T>;
  token(): string | null;
}

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const access = useRef<string | null>(null); // memory only, never storage

  const refresh = useCallback(async () => {
    const res = await fetch("/api/session/refresh", { method: "POST" });
    if (!res.ok) {
      access.current = null;
      setUser(null);
      return false;
    }
    const s = (await res.json()) as { accessToken: string; user: User };
    access.current = s.accessToken;
    setUser(s.user);
    return true;
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const call = useCallback(
    async <T,>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
      try {
        return await apiFetch<T>(path, { ...init, token: access.current, base: PUBLIC_API_URL });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401 && (await refresh())) {
          return apiFetch<T>(path, { ...init, token: access.current, base: PUBLIC_API_URL });
        }
        throw err;
      }
    },
    [refresh],
  );

  const signIn = useCallback(async (phone: string, code: string) => {
    const res = await fetch("/api/session/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, code }) });
    const data = await res.json();
    if (!res.ok) throw new ApiError(res.status, data.code, data.message, data.details);
    access.current = data.accessToken;
    setUser(data.user);
    return { isNewUser: data.isNewUser as boolean };
  }, []);

  const staffSignIn = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/session/staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const data = await res.json();
    if (!res.ok) throw new ApiError(res.status, data.code, data.message, data.details);
    access.current = data.accessToken;
    setUser(data.user);
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/session/logout", { method: "POST", headers: access.current ? { Authorization: `Bearer ${access.current}` } : {} });
    access.current = null;
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, signIn, staffSignIn, signOut, call, token: () => access.current }}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth needs <AuthProvider>");
  return ctx;
}
