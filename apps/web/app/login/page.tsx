"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { apiFetch, ApiError, PUBLIC_API_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

/** Mobile number, then the 6-digit code (FR-AUTH-01). New numbers become a player account. */
function Login() {
  const { signIn, staffSignIn } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/me";
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ debugOtp?: string }>("/auth/otp", { method: "POST", body: { phone }, base: PUBLIC_API_URL });
      setDevCode(res.debugOtp ?? null);
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send the code. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(phone, code);
      router.push(next.startsWith("/") ? next : "/me");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function staff(e: FormEvent<HTMLFormElement>) {
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

  const input = "mt-1 h-12 w-full rounded-lg border border-line bg-white px-3 text-lg tabular";
  return (
    <section className="mx-auto max-w-sm pt-14">
      <h1 className="font-score text-4xl font-bold uppercase tracking-wide">Log in</h1>
      {step === "phone" ? (
        <form onSubmit={sendCode} className="mt-6">
          <label htmlFor="phone" className="text-sm font-semibold">
            Mobile number
          </label>
          <input id="phone" type="tel" inputMode="numeric" autoComplete="tel-national" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" className={input} />
          <p className="mt-2 text-sm text-muted">We'll text you a 6-digit code. New here? This creates your player account.</p>
          <p className="mt-2 text-xs text-muted">
            By continuing you agree to our{" "}
            <a href="/pages/terms" className="underline">terms</a> and <a href="/pages/privacy" className="underline">privacy policy</a>.
          </p>
          {error ? <p role="alert" className="mt-3 text-sm font-semibold text-bad">{error}</p> : null}
          <button disabled={busy} className="mt-6 h-12 w-full rounded-lg bg-navy font-semibold text-white hover:bg-navy/90 disabled:opacity-60">
            {busy ? "Sending…" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-6">
          <label htmlFor="code" className="text-sm font-semibold">
            Code sent to {phone}
          </label>
          <input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className={`${input} tracking-[0.4em]`} />
          {devCode ? <p className="mt-2 text-sm text-muted">Development server: your code is <span className="font-bold tabular text-ink">{devCode}</span></p> : null}
          {error ? <p role="alert" className="mt-3 text-sm font-semibold text-bad">{error}</p> : null}
          <button disabled={busy || code.length !== 6} className="mt-6 h-12 w-full rounded-lg bg-navy font-semibold text-white hover:bg-navy/90 disabled:opacity-60">
            {busy ? "Checking…" : "Log in"}
          </button>
          <button type="button" onClick={() => (setStep("phone"), setCode(""), setError(null))} className="mt-3 w-full text-sm font-semibold text-navy underline">
            Use a different number
          </button>
        </form>
      )}
      <details className="mt-10 border-t border-line pt-4 text-sm">
        <summary className="cursor-pointer font-semibold text-navy">Force Pulse staff</summary>
        <form onSubmit={staff} className="mt-4 space-y-3">
          <label className="block font-semibold">
            Email
            <input name="email" type="email" autoComplete="username" required className={input} />
          </label>
          <label className="block font-semibold">
            Password
            <input name="password" type="password" autoComplete="current-password" required className={input} />
          </label>
          <button disabled={busy} className="h-12 w-full rounded-lg border border-navy font-semibold text-navy hover:bg-line/40 disabled:opacity-60">
            Staff log in
          </button>
        </form>
      </details>
    </section>
  );
}
