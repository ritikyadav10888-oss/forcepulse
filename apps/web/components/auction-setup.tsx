"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, PUBLIC_API_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AuctionState } from "./auction-live";
import { btn, btnGhost, Field, h2, input, Message, useAction } from "./form";
import { PayButton } from "./pay";

interface Plan {
  id: string;
  name: string;
  maxTeams: number;
  pricePaise: number | null;
}

/** Lines like "Gold: 20000" → [{ name, value }]. */
const pairs = (text: string) =>
  text
    .split("\n")
    .map((l) => l.split(":").map((x) => x.trim()))
    .filter(([a, b]) => a && b)
    .map(([a, b]) => ({ a, b: Number(b) }));

/** Auction setup (FR-AUC-01 to 08, 21 to 24): plan, purse and rules, teams, players in categories, then start. */
export function AuctionSetup({ state: s, reload }: { state: AuctionState; reload: () => Promise<void> }) {
  const { user, call } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [pool, setPool] = useState<{ playerId: string; name: string; lotCategoryId: string | null }[]>([]);
  const [placed, setPlaced] = useState<Record<string, string>>({});
  const { busy, error, ok, run } = useAction();

  useEffect(() => {
    void apiFetch<Plan[]>("/auction-plans", { base: PUBLIC_API_URL }).then(setPlans);
    if (s.status === "setup")
      void call<typeof pool>(`/auctions/${s.id}/pool`).then((p) => (setPool(p), setPlaced(Object.fromEntries(p.filter((x) => x.lotCategoryId).map((x) => [x.playerId, x.lotCategoryId!])))));
  }, [call, s.id, s.status]);

  const after = (r: unknown) => r !== undefined && void reload();

  async function configure(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run(
      () =>
        call(`/auctions/${s.id}/config`, {
          method: "PUT",
          body: {
            purse: Number(f.get("purse")),
            minSquad: Number(f.get("minSquad")),
            maxSquad: Number(f.get("maxSquad")),
            timerSeconds: Number(f.get("timer")),
            lotOrder: f.get("lotOrder"),
            slabs: pairs(String(f.get("slabs"))).map(({ a, b }) => ({ from: Number(a), raise: b })),
            categories: pairs(String(f.get("categories"))).map(({ a, b }) => ({ name: a, basePoints: b, quotaPerTeam: null })),
          },
        }),
      "Settings saved.",
    );
    after(r);
  }

  async function addTeam(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const r = await run(() => call(`/auctions/${s.id}/teams`, { method: "POST", body: { name: f.get("name"), ownerPhone: String(f.get("ownerPhone") || "") || null } }), "Team added.");
    if (r !== undefined) form.reset();
    after(r);
  }

  if (s.status === "locked") {
    return (
      <section className="max-w-2xl space-y-4 pt-10">
        <h1 className="font-score text-4xl font-bold uppercase tracking-wide">Choose an auction plan</h1>
        <p className="text-muted">Plans differ only by how many teams they allow. Every plan includes all auction features.</p>
        <ul className="space-y-3">
          {plans.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-4">
              <span>
                <b>{p.name}</b> · up to {p.maxTeams} teams
              </span>
              {p.pricePaise === null ? (
                <span className="text-sm text-muted">Price not set yet</span>
              ) : (
                <PayButton label="Buy" amountPaise={p.pricePaise} create={() => call(`/auctions/${s.id}/plan`, { method: "POST", body: { planId: p.id } })} onPaid={() => void reload()} />
              )}
              {user?.platformRole === "super_admin" ? (
                <button className={btnGhost} onClick={() => void run(() => call(`/admin/auctions/${s.id}/plan`, { method: "POST", body: { planId: p.id } })).then(after)}>
                  Grant free (staff)
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <Message error={error} />
      </section>
    );
  }

  return (
    <div className="space-y-10 pt-10">
      <h1 className="font-score text-4xl font-bold uppercase tracking-wide">Set up the auction</h1>

      <form onSubmit={configure} className="grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-3">
        <h2 className={`${h2} sm:col-span-3`}>Rules (points only, no real money)</h2>
        <Field label="Purse per team (points)">
          <input name="purse" type="number" min={1} defaultValue={s.purse || ""} required className={input} />
        </Field>
        <Field label="Min players per team">
          <input name="minSquad" type="number" min={1} defaultValue={s.minSquad || ""} required className={input} />
        </Field>
        <Field label="Max players per team">
          <input name="maxSquad" type="number" min={1} defaultValue={s.maxSquad || ""} required className={input} />
        </Field>
        <Field label="Bid timer (seconds)">
          <input name="timer" type="number" min={5} defaultValue={s.timerSeconds || 30} required className={input} />
        </Field>
        <Field label="Order of players">
          <select name="lotOrder" defaultValue={s.lotOrder} className={input}>
            <option value="category">By category</option>
            <option value="random">Random draw</option>
            <option value="manual">I pick each one</option>
          </select>
        </Field>
        <span />
        <Field label="Bid raises" hint="One per line, from: raise. 0: 500 means +500 from the start.">
          <textarea name="slabs" rows={3} defaultValue={"0: 500\n10000: 1000"} className={`${input} h-auto py-2`} />
        </Field>
        <Field label="Player categories" hint="One per line, name: base points.">
          <textarea name="categories" rows={3} defaultValue={s.categories.map((c) => `${c.name}: ${c.basePoints}`).join("\n") || "Gold: 5000\nSilver: 2000"} className={`${input} h-auto py-2`} />
        </Field>
        <div className="self-end">
          <button disabled={busy} className={btn}>Save rules</button>
        </div>
      </form>

      <section className="space-y-3">
        <h2 className={h2}>
          Teams · {s.teams.length} of {s.maxTeams}
        </h2>
        <ul className="divide-y divide-line border-y border-line text-sm">
          {s.teams.map((t) => (
            <li key={t.id} className="py-2 font-semibold">{t.name}</li>
          ))}
        </ul>
        <form onSubmit={addTeam} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Field label="Team name">
            <input name="name" required className={input} />
          </Field>
          <Field label="Owner's mobile" hint="They bid for this team. They must have logged in once.">
            <input name="ownerPhone" type="tel" className={input} />
          </Field>
          <button disabled={busy} className={`${btnGhost} self-start sm:mt-6`}>Add team</button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className={h2}>Players in the pool · {pool.length}</h2>
        {!s.categories.length ? <p className="text-sm text-muted">Save rules with categories first.</p> : null}
        <ul className="divide-y divide-line border-y border-line text-sm">
          {pool.map((p) => (
            <li key={p.playerId} className="flex items-center justify-between gap-3 py-2">
              <span className="font-semibold">{p.name || "Unnamed player"}</span>
              <select aria-label={`Category for ${p.name}`} value={placed[p.playerId] ?? ""} onChange={(e) => setPlaced({ ...placed, [p.playerId]: e.target.value })} className="h-10 rounded-lg border border-line bg-white px-2">
                <option value="">Not in the auction</option>
                {s.categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        <button
          disabled={busy || !s.categories.length}
          className={btnGhost}
          onClick={() => void run(() => call(`/auctions/${s.id}/lots`, { method: "PUT", body: { lots: Object.entries(placed).filter(([, c]) => c).map(([playerId, categoryId]) => ({ playerId, categoryId })) } }), "Players placed.").then(after)}
        >
          Save player categories
        </button>
      </section>

      <Message error={error} ok={ok} />
      <button disabled={busy} className={`${btn} w-full`} onClick={() => void run(() => call(`/auctions/${s.id}/start`, { method: "POST", body: {} })).then(after)}>
        Start the auction
      </button>
    </div>
  );
}
