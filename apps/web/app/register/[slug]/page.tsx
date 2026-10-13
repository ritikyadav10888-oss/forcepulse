"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import type { FieldDef } from "@force-pulse/shared";
import { btn, Field, h2, input, Message, useAction } from "@/components/form";
import { FormFields } from "@/components/form-fields";
import { PayButton } from "@/components/pay";
import { apiFetch, PUBLIC_API_URL, type Tournament } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateRange, rupees, sportName } from "@/lib/format";

interface Result {
  enrollments: { id: string; registrationNo: string; status: string }[];
  amountDuePaise: number;
  holdExpiresAt: string | null;
  team?: { name: string; code: string };
}

export default function Page() {
  return (
    <Suspense>
      <Register />
    </Suspense>
  );
}

/** Registration through a tournament link (FR-REG-01 to 11): pick sports, fill the organiser's form, pay. */
function Register() {
  const { slug } = useParams<{ slug: string }>();
  const invite = useSearchParams().get("code");
  const { user, loading, call } = useAuth();
  const router = useRouter();
  const [page, setPage] = useState<{ tournament: Tournament; form: { fields: FieldDef[] } } | null>(null);
  const [picked, setPicked] = useState<Record<string, string | null>>({}); // eventId → categoryId
  const [teamName, setTeamName] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [guardian, setGuardian] = useState({ name: "", phone: "" });
  const [result, setResult] = useState<Result | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    void apiFetch<{ tournament: Tournament; form: { fields: FieldDef[] } }>(`/t/${slug}`, { base: PUBLIC_API_URL }).then(setPage).catch(() => setPage(null));
  }, [slug]);
  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(`/register/${slug}${invite ? `?code=${invite}` : ""}`)}`);
  }, [loading, user, router, slug, invite]);

  if (!page) return <p className="pt-14 text-muted">Loading…</p>;
  const t = page.tournament;
  if (t.status !== "enrollment_open") return <p className="pt-14">Registration for {t.name} is closed.</p>;

  const events = t.events.filter((e) => e.id in picked);
  const teamEvent = events.find((e) => e.entryType === "team");
  const fee = (eId: string) => {
    const e = t.events.find((x) => x.id === eId)!;
    return e.categories.find((c) => c.id === picked[eId])?.feePaise ?? e.feePaise;
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const common = { answers, inviteCode: invite, guardian: guardian.name ? guardian : null };
    const r = await run(async () => {
      if (teamEvent) {
        // A captain registers a team; the team fee is paid once by the captain (FR-PAY-02).
        return call<Result>(`/tournaments/${t.id}/events/${teamEvent.id}/teams`, { method: "POST", body: { ...common, teamName, categoryId: picked[teamEvent.id] } });
      }
      return call<Result>(`/tournaments/${t.id}/registrations`, { method: "POST", body: { ...common, entries: events.map((ev) => ({ eventId: ev.id, categoryId: picked[ev.id] })) } });
    });
    if (r) setResult(r);
  }

  if (result) {
    const due = result.enrollments.filter((x) => x.status === "payment_pending");
    return (
      <section className="max-w-xl pt-10">
        <h1 className="font-score text-4xl font-bold uppercase tracking-wide">{due.length ? "Almost done" : "You're registered"}</h1>
        <ul className="mt-6 divide-y divide-line border-y border-line text-sm">
          {result.enrollments.map((x) => (
            <li key={x.id} className="flex justify-between py-3">
              <span className="font-semibold tabular">{x.registrationNo}</span>
              <span className="text-muted">{x.status.replace(/_/g, " ")}</span>
            </li>
          ))}
        </ul>
        {result.team ? (
          <p className="mt-6 rounded-lg bg-white p-4 text-sm">
            Team <b>{result.team.name}</b>. Share code <b className="font-score text-2xl tabular">{result.team.code}</b> with team-mates: they join at <b>/join</b>.
          </p>
        ) : null}
        {due.length ? (
          <div className="mt-6">
            <p className="mb-3 text-sm">Pay within 30 minutes to keep your place.</p>
            <PayButton amountPaise={result.amountDuePaise} create={() => call("/payments/orders", { method: "POST", body: { enrollmentIds: due.map((x) => x.id) } })} onPaid={() => router.push("/me")} />
          </div>
        ) : (
          <Link href="/me" className={`${btn} mt-6`}>
            Go to my account
          </Link>
        )}
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-8 pt-10">
      <header>
        <p className="text-sm font-semibold text-muted">{dateRange(t.startsAt, t.endsAt)}</p>
        <h1 className="font-score text-4xl font-bold uppercase tracking-wide">{t.name}</h1>
      </header>

      <section>
        <h2 className={h2}>Sports</h2>
        <div className="mt-2 space-y-2">
          {t.events.map((ev) => {
            const on = ev.id in picked;
            return (
              <div key={ev.id} className={`rounded-lg border bg-white p-3 ${on ? "border-navy" : "border-line"}`}>
                <label className="flex items-center gap-3 text-sm font-semibold">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={on}
                    onChange={(e) => setPicked(({ [ev.id]: _, ...rest }) => (e.target.checked ? { ...rest, [ev.id]: ev.categories[0]?.id ?? null } : rest))}
                  />
                  {sportName(ev.sportId)} <span className="font-normal text-muted">· {ev.entryType === "team" ? "team entry" : "individual"}</span>
                </label>
                {on && ev.categories.length ? (
                  <select value={picked[ev.id] ?? ""} onChange={(e) => setPicked({ ...picked, [ev.id]: e.target.value })} className={input}>
                    {ev.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {(c.feePaise ?? ev.feePaise) ? rupees(c.feePaise ?? ev.feePaise) : "Free"}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            );
          })}
        </div>
        {teamEvent && events.length > 1 ? <p className="mt-2 text-sm text-bad">Register a team on its own, separately from other sports.</p> : null}
      </section>

      {teamEvent ? (
        <Field label="Team name" hint="You'll be the captain and get a code for team-mates.">
          <input value={teamName} onChange={(e) => setTeamName(e.target.value)} required minLength={2} className={input} />
        </Field>
      ) : null}

      {page.form.fields.length ? (
        <section>
          <h2 className={h2}>Your details</h2>
          <div className="mt-2">
            <FormFields fields={page.form.fields} answers={answers} set={(k, v) => setAnswers({ ...answers, [k]: v })} />
          </div>
        </section>
      ) : null}

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">Player under 18? Parent or guardian consent</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Guardian's name">
            <input value={guardian.name} onChange={(e) => setGuardian({ ...guardian, name: e.target.value })} className={input} />
          </Field>
          <Field label="Guardian's mobile">
            <input type="tel" value={guardian.phone} onChange={(e) => setGuardian({ ...guardian, phone: e.target.value })} className={input} />
          </Field>
        </div>
      </details>

      <div className="border-t border-line pt-4">
        <p className="text-sm">
          Entry fees: <b className="tabular">{rupees(events.reduce((s, e) => s + fee(e.id), 0))}</b>
          {t.refundPolicy ? <span className="mt-1 block text-xs text-muted">Refunds: {t.refundPolicy}</span> : null}
        </p>
        <Message error={error} />
        <button disabled={busy || !events.length || (!!teamEvent && events.length > 1)} className={`${btn} mt-3 w-full`}>
          {busy ? "Registering…" : "Register"}
        </button>
      </div>
    </form>
  );
}
