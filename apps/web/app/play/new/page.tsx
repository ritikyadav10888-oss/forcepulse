"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { SCORING_MODULES } from "@force-pulse/scoring";
import { btn, btnGhost, Field, h2, input, Message, useAction } from "@/components/form";
import { useAuth } from "@/lib/auth";

interface Side {
  name: string;
  players: { phone: string; name: string }[];
}
const blank = (name: string, phone = ""): Side => ({ name, players: [{ phone, name: "" }] });

/** A casual match (FR-SCR-05): pick a sport, set your rules, add both sides by mobile number, then score it. */
export default function NewCasualMatch() {
  const { user, loading, call } = useAuth();
  const router = useRouter();
  const sports = Object.values(SCORING_MODULES);
  const [sportId, setSportId] = useState("badminton");
  const [sides, setSides] = useState<[Side, Side]>([blank("Home"), blank("Away")]);
  const { busy, error, run } = useAction();
  const module = SCORING_MODULES[sportId];

  useEffect(() => {
    if (!loading && !user) router.replace("/login?next=/play/new");
    if (user?.phone) setSides(([home, away]) => [home.players[0].phone ? home : blank(home.name, user.phone!.replace(/^\+91/, "")), away]);
  }, [loading, user, router]);

  const setSide = (i: 0 | 1, patch: Partial<Side>) => setSides((s) => (i === 0 ? [{ ...s[0], ...patch }, s[1]] : [s[0], { ...s[1], ...patch }]));
  const setPlayer = (i: 0 | 1, k: number, patch: Partial<Side["players"][number]>) => setSide(i, { players: sides[i].players.map((p, j) => (j === k ? { ...p, ...patch } : p)) });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const rules = Object.fromEntries((module.ruleKnobs ?? []).filter((k) => String(f.get(k.key) ?? "") !== "").map((k) => [k.key, k.type === "number" ? Number(f.get(k.key)) : String(f.get(k.key))]));
    const clean = (s: Side) => ({ name: s.name, players: s.players.filter((p) => p.phone.trim()).map((p) => ({ phone: p.phone, ...(p.name.trim() ? { name: p.name } : {}) })) });
    const r = await run(() => call<{ matchId: string }>("/matches/casual", { method: "POST", body: { sportId, rules, home: clean(sides[0]), away: clean(sides[1]) } }));
    if (r) router.push(`/score/${r.matchId}`);
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-8 pt-10">
      <h1 className="font-score text-4xl font-bold uppercase tracking-wide">Casual match</h1>

      <Field label="Sport">
        <select value={sportId} onChange={(e) => setSportId(e.target.value)} className={input}>
          {sports.map((m) => (
            <option key={m.sportId} value={m.sportId}>
              {m.sport.name}
            </option>
          ))}
        </select>
      </Field>

      <section>
        <h2 className={h2}>Your rules</h2>
        <div key={sportId} className="mt-2 grid gap-3 sm:grid-cols-3">
          {(module.ruleKnobs ?? []).map((k) => (
            <Field key={k.key} label={k.label} hint={module.sport.defaultRules[k.key] !== undefined ? `Typical: ${module.sport.defaultRules[k.key]}` : undefined}>
              {k.type === "select" ? (
                <select name={k.key} required={k.required} defaultValue="" className={input}>
                  <option value="">Choose…</option>
                  {k.options?.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input name={k.key} type="number" min={k.min} max={k.max} required={k.required} className={input} />
              )}
            </Field>
          ))}
        </div>
      </section>

      <div className="grid gap-6 sm:grid-cols-2">
        {([0, 1] as const).map((i) => (
          <section key={i} className="space-y-3 rounded-lg border border-line bg-white p-4">
            <Field label={i === 0 ? "Home side" : "Away side"}>
              <input value={sides[i].name} onChange={(e) => setSide(i, { name: e.target.value })} required className={input} />
            </Field>
            {sides[i].players.map((p, k) => (
              <div key={k} className="grid grid-cols-2 gap-2">
                <input aria-label="Mobile" type="tel" placeholder="Mobile" value={p.phone} onChange={(e) => setPlayer(i, k, { phone: e.target.value })} className={input} />
                <input aria-label="Name" placeholder="Name (if new)" value={p.name} onChange={(e) => setPlayer(i, k, { name: e.target.value })} className={input} />
              </div>
            ))}
            <button type="button" className={btnGhost} onClick={() => setSide(i, { players: [...sides[i].players, { phone: "", name: "" }] })}>
              Add player
            </button>
          </section>
        ))}
      </div>
      <p className="text-xs text-muted">Players are found by mobile number. Someone new gets a Force Pulse player id, and the match appears on their profile when they sign in.</p>

      <Message error={error} />
      <button disabled={busy} className={`${btn} w-full`}>
        {busy ? "Setting up…" : "Start scoring"}
      </button>
    </form>
  );
}
