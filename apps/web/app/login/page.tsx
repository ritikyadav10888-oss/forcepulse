"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { apiFetch, ApiError, PUBLIC_API_URL } from "@/lib/api";
import { Message } from "@/components/form";
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
  const { signIn } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/me";
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
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

  const input = "h-12 w-full rounded-lg border border-line bg-white px-3 text-lg tabular focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/20";
  const primary = "h-12 w-full rounded-lg bg-navy font-semibold text-white hover:bg-navy/90 disabled:opacity-50";
  return (
    <section className="py-10 sm:py-16">
      <div className="mx-auto grid max-w-4xl overflow-hidden rounded-2xl border border-line bg-white shadow-sm md:grid-cols-2">
        <div className="hidden flex-col justify-between bg-navy p-10 text-white md:flex">
          <div>
            <p className="font-score text-5xl font-bold uppercase leading-[0.95] tracking-wide">
              Every match.
              <br />
              Live.
            </p>
            <ul className="mt-8 space-y-3 text-white/85">
              {["Register for tournaments in minutes", "Follow scores point by point", "Your matches, wins and badges in one profile"].map((t) => (
                <li key={t} className="flex gap-3">
                  <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-white/60" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-sm text-white/60">No password needed. We send a code to your phone.</p>
        </div>

        <div className="p-6 sm:p-10">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Step {step === "phone" ? 1 : 2} of 2</p>
          <h1 className="mt-1 font-score text-4xl font-bold uppercase tracking-wide">{step === "phone" ? "Log in" : "Enter code"}</h1>
          <p className="mt-1 text-sm text-muted">{step === "phone" ? "Players and organisers log in with their mobile number." : `We sent a 6-digit code to +91 ${phone}.`}</p>

          {step === "phone" ? (
            <form onSubmit={sendCode} className="mt-8">
              <label htmlFor="phone" className="text-sm font-semibold">
                Mobile number
              </label>
              <div className="mt-1 flex">
                <span className="grid place-items-center rounded-l-lg border border-r-0 border-line bg-cream px-3 text-lg text-muted">+91</span>
                <input id="phone" type="tel" inputMode="numeric" autoComplete="tel-national" required autoFocus value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" className={`${input} rounded-l-none`} />
              </div>
              <p className="mt-2 text-sm text-muted">New here? This creates your player account.</p>
              <div className="mt-4">
                <Message error={error} />
              </div>
              <button disabled={busy} className={`mt-4 ${primary}`}>
                {busy ? "Sending…" : "Send code"}
              </button>
              <p className="mt-4 text-xs text-muted">
                By continuing you agree to our{" "}
                <a href="/pages/terms" className="underline">
                  terms
                </a>{" "}
                and{" "}
                <a href="/pages/privacy" className="underline">
                  privacy policy
                </a>
                .
              </p>
            </form>
          ) : (
            <form onSubmit={verify} className="mt-8">
              <label htmlFor="code" className="text-sm font-semibold">
                6-digit code
              </label>
              <input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="••••••" className={`mt-1 ${input} text-center text-2xl tracking-[0.5em]`} />
              {devCode ? (
                <p className="mt-2 rounded-lg bg-cream px-3 py-2 text-sm text-muted">
                  Development server: your code is <span className="font-bold tabular text-ink">{devCode}</span>
                </p>
              ) : null}
              <div className="mt-4">
                <Message error={error} />
              </div>
              <button disabled={busy || code.length !== 6} className={`mt-4 ${primary}`}>
                {busy ? "Checking…" : "Log in"}
              </button>
              <div className="mt-4 flex justify-between text-sm font-semibold text-navy">
                <button type="button" onClick={() => (setStep("phone"), setCode(""), setError(null))} className="underline">
                  Change number
                </button>
                <button type="button" disabled={busy} onClick={() => sendCode()} className="underline disabled:opacity-50">
                  Send a new code
                </button>
              </div>
            </form>
          )}

        </div>
      </div>
    </section>
  );
}
