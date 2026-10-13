"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import type { FieldDef } from "@force-pulse/shared";
import { btn, Field, input, Message, useAction } from "@/components/form";
import { FormFields } from "@/components/form-fields";
import { apiFetch, PUBLIC_API_URL, type Tournament } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface TeamView {
  name: string;
  tournamentId: string;
  players: number;
}

export default function Page() {
  return (
    <Suspense>
      <Join />
    </Suspense>
  );
}

/** A team-mate joins with the captain's code, free (FR-REG-07). */
function Join() {
  const params = useSearchParams();
  const { user, loading, call } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [team, setTeam] = useState<TeamView | null>(null);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const { busy, error, ok, run } = useAction();

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(`/join?code=${code}`)}`);
  }, [loading, user, router, code]);

  async function find(e: FormEvent) {
    e.preventDefault();
    const t = await run(() => apiFetch<TeamView>(`/teams/code/${code.trim().toUpperCase()}`, { base: PUBLIC_API_URL }));
    if (!t) return;
    setTeam(t);
    const tour = await apiFetch<Tournament>(`/tournaments/${t.tournamentId}`, { base: PUBLIC_API_URL });
    const page = await apiFetch<{ form: { fields: FieldDef[] } }>(`/t/${tour.slug}`, { base: PUBLIC_API_URL });
    setFields(page.form.fields);
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    if (await run(() => call("/teams/join", { method: "POST", body: { code: code.trim().toUpperCase(), answers } }), "You've joined the team.")) router.push("/me");
  }

  return (
    <section className="max-w-xl pt-10">
      <h1 className="font-score text-4xl font-bold uppercase tracking-wide">Join a team</h1>
      {!team ? (
        <form onSubmit={find} className="mt-6 space-y-4">
          <Field label="Team code">
            <input value={code} onChange={(e) => setCode(e.target.value)} required className={`${input} uppercase tracking-widest`} />
          </Field>
          <Message error={error} />
          <button disabled={busy} className={btn}>Find team</button>
        </form>
      ) : (
        <form onSubmit={join} className="mt-6 space-y-6">
          <p className="rounded-lg bg-white p-4">
            Team <b>{team.name}</b> · {team.players} player{team.players === 1 ? "" : "s"} so far
          </p>
          <FormFields fields={fields} answers={answers} set={(k, v) => setAnswers({ ...answers, [k]: v })} />
          <Message error={error} ok={ok} />
          <button disabled={busy} className={btn}>Join team</button>
        </form>
      )}
    </section>
  );
}
