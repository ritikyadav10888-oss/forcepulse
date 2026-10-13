"use client";

import { useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";

// Plain, deliberately quiet form parts (UI direction: lists, forms and settings stay plain).
export const input = "mt-1 h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";
export const btn = "inline-flex h-11 items-center justify-center rounded-lg bg-navy px-5 text-sm font-semibold text-white hover:bg-navy/90 disabled:opacity-50";
export const btnGhost = "inline-flex h-11 items-center justify-center rounded-lg border border-navy px-4 text-sm font-semibold text-navy hover:bg-line/40 disabled:opacity-50";
export const btnDanger = "inline-flex h-11 items-center justify-center rounded-lg bg-bad px-4 text-sm font-semibold text-white hover:bg-bad/90 disabled:opacity-50";
export const h2 = "text-xs font-bold uppercase tracking-wider text-muted";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      {children}
      {hint ? <span className="mt-1 block text-xs font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

export function Message({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error) return <p role="alert" className="rounded-lg bg-bad/15 px-3 py-2 text-sm font-semibold">{error}</p>;
  if (ok) return <p role="status" className="rounded-lg bg-good/15 px-3 py-2 text-sm font-semibold">{ok}</p>;
  return null;
}

/** Runs an action with a busy flag and turns API errors into a message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>, done?: string): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const r = await fn();
      if (done) setOk(done);
      return r;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, ok, run, setError };
}
