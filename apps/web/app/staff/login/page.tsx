"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Message } from "@/components/form";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** Force Pulse staff sign in with email and password, kept apart from the player login. */
export default function StaffLogin() {
  const { staffSignIn } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await staffSignIn(String(f.get("email")), String(f.get("password")));
      router.push("/admin");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const input = "mt-1 h-12 w-full rounded-lg border border-line bg-white px-3 text-base focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/20";
  return (
    <section className="py-10 sm:py-16">
      <div className="mx-auto max-w-md rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-10">
        <p className="text-xs font-bold uppercase tracking-wider text-muted">Force Pulse team</p>
        <h1 className="mt-1 font-score text-4xl font-bold uppercase tracking-wide">Staff log in</h1>
        <p className="mt-1 text-sm text-muted">For Force Pulse staff only. Players and organisers log in with their mobile number.</p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block text-sm font-semibold">
            Email
            <input name="email" type="email" autoComplete="username" required autoFocus className={input} />
          </label>
          <label className="block text-sm font-semibold">
            Password
            <input name="password" type="password" autoComplete="current-password" required className={input} />
          </label>
          <Message error={error} />
          <button disabled={busy} className="h-12 w-full rounded-lg bg-navy font-semibold text-white hover:bg-navy/90 disabled:opacity-50">
            {busy ? "Checking…" : "Log in"}
          </button>
        </form>
        <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-navy underline">
          Player or organiser? Log in with your mobile
        </Link>
      </div>
    </section>
  );
}
