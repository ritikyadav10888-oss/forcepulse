"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { RuleKnob } from "@force-pulse/scoring";
import { MatchRow } from "@/components/bits";
import { apiFetch, PUBLIC_API_URL, type Match, type TournamentEvent } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { sportName } from "@/lib/format";
import { btn, btnGhost, Field, h2, input, Message, useAction } from "../form";
import type { EntryRow } from "./entries";
import type { TabProps } from "./overview";

interface Format {
  id: string;
  eventId: string;
  categoryId: string | null;
  type: "league" | "knockout" | "league_knockout";
  rules: Record<string, number | string> | null;
  config: { groups: number; legs: 1 | 2; qualifiersPerGroup: number; thirdPlace: boolean };
}

/** Formats, rules, fixtures and scorers (FR-TRN-04 to 10, FR-SCR-01). */
export function FixturesTab({ t }: TabProps) {
  const { call, user } = useAuth();
  const [formats, setFormats] = useState<Format[]>([]);
  const [matches, setMatches] = useState<(Match & { formatId: string; scorerUserId: string | null })[]>([]);
  const [people, setPeople] = useState<{ userId: string; name: string }[]>([]);
  const load = useCallback(() => {
    void call<Format[]>(`/tournaments/${t.id}/formats`).then(setFormats);
    void call<typeof matches>(`/tournaments/${t.id}/matches`).then(setMatches);
  }, [call, t.id]);
  useEffect(() => {
    load();
    void call<EntryRow[]>(`/tournaments/${t.id}/enrollments?status=enrolled`).then((rows) =>
      setPeople([...new Map(rows.map((r) => [r.registeredByUserId, { userId: r.registeredByUserId, name: r.player.playerName }])).values()]),
    );
  }, [load, call, t.id]);

  return (
    <div className="space-y-10">
      {t.events.map((ev) => {
        const f = formats.find((x) => x.eventId === ev.id && !x.categoryId);
        return (
          <section key={ev.id} className="space-y-4">
            <h2 className="text-xl font-bold">{sportName(ev.sportId)}</h2>
            <FormatEditor ev={ev} format={f} onSaved={load} />
            {f ? <Generate formatId={f.id} onDone={load} /> : null}
            {f ? (
              <ScorerList
                matches={matches.filter((m) => m.formatId === f.id)}
                people={[...(user ? [{ userId: user.id, name: "Me" }] : []), ...people]}
                onChange={load}
              />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function FormatEditor({ ev, format, onSaved }: { ev: TournamentEvent; format?: Format; onSaved: () => void }) {
  const { call } = useAuth();
  const [knobs, setKnobs] = useState<RuleKnob[]>([]);
  const [suggest, setSuggest] = useState<Record<string, number | string>>({});
  const { busy, error, ok, run } = useAction();
  useEffect(() => {
    void apiFetch<{ knobs: RuleKnob[]; suggestions: Record<string, number | string> }>(`/sports/${ev.sportId}/rules`, { base: PUBLIC_API_URL })
      .then((r) => (setKnobs(r.knobs), setSuggest(r.suggestions)))
      .catch(() => setKnobs([]));
  }, [ev.sportId]);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const rules = Object.fromEntries(knobs.filter((k) => String(f.get(k.key) ?? "") !== "").map((k) => [k.key, k.type === "number" ? Number(f.get(k.key)) : String(f.get(k.key))]));
    await run(
      () =>
        call(`/events/${ev.id}/format`, {
          method: "PUT",
          body: {
            type: f.get("type"),
            rules: knobs.length ? rules : null,
            config: { groups: Number(f.get("groups") || 1), legs: Number(f.get("legs") || 1), qualifiersPerGroup: Number(f.get("qualifiers") || 2), thirdPlace: f.get("thirdPlace") === "on" },
          },
        }),
      "Saved.",
    );
    onSaved();
  }

  return (
    <form onSubmit={save} className="space-y-4 rounded-lg border border-line bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Format">
          <select name="type" defaultValue={format?.type ?? "league"} className={input}>
            <option value="league">League</option>
            <option value="knockout">Knockout</option>
            <option value="league_knockout">League + knockout</option>
          </select>
        </Field>
        <Field label="Groups">
          <input name="groups" type="number" min={1} defaultValue={format?.config.groups ?? 1} className={input} />
        </Field>
        <Field label="Play each other">
          <select name="legs" defaultValue={format?.config.legs ?? 1} className={input}>
            <option value={1}>Once</option>
            <option value={2}>Twice</option>
          </select>
        </Field>
        <Field label="Qualify per group">
          <input name="qualifiers" type="number" min={1} defaultValue={format?.config.qualifiersPerGroup ?? 2} className={input} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" name="thirdPlace" defaultChecked={format?.config.thirdPlace} /> Third-place match
      </label>

      {knobs.length ? (
        <div>
          <h3 className={h2}>Scoring rules</h3>
          <p className="mt-1 text-xs text-muted">You set every rule; nothing is applied by default. Typical values are shown as hints.</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {knobs.map((k) => (
              <Field key={k.key} label={k.label} hint={suggest[k.key] !== undefined ? `Typical: ${suggest[k.key]}` : undefined}>
                {k.type === "select" ? (
                  <select name={k.key} defaultValue={String(format?.rules?.[k.key] ?? "")} required={k.required} className={input}>
                    <option value="">Choose…</option>
                    {k.options?.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input name={k.key} type="number" min={k.min} max={k.max} defaultValue={format?.rules?.[k.key] ?? ""} required={k.required} className={input} />
                )}
              </Field>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">Live scoring isn't available for this sport yet; enter results by hand.</p>
      )}
      <Message error={error} ok={ok} />
      <button disabled={busy} className={btn}>
        Save format
      </button>
    </form>
  );
}

function Generate({ formatId, onDone }: { formatId: string; onDone: () => void }) {
  const { call } = useAuth();
  const { busy, error, ok, run } = useAction();
  async function go(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(
      () =>
        call(`/formats/${formatId}/fixtures`, {
          method: "POST",
          body: {
            startDate: f.get("startDate"),
            dayStart: f.get("dayStart"),
            dayEnd: f.get("dayEnd"),
            matchMinutes: Number(f.get("matchMinutes")),
            courts: String(f.get("courts")).split(",").map((c) => c.trim()).filter(Boolean),
          },
        }),
      "Fixtures generated.",
    );
    onDone();
  }
  return (
    <form onSubmit={go} className="grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-5">
      <Field label="First day">
        <input name="startDate" type="date" required className={input} />
      </Field>
      <Field label="From">
        <input name="dayStart" type="time" defaultValue="09:00" required className={input} />
      </Field>
      <Field label="Until">
        <input name="dayEnd" type="time" defaultValue="18:00" required className={input} />
      </Field>
      <Field label="Minutes / match">
        <input name="matchMinutes" type="number" min={5} defaultValue={30} required className={input} />
      </Field>
      <Field label="Courts">
        <input name="courts" defaultValue="Court 1, Court 2" required className={input} />
      </Field>
      <div className="sm:col-span-5">
        <p className="mb-2 text-xs text-muted">Close registration first. Generating again replaces matches that haven&apos;t started.</p>
        <Message error={error} ok={ok} />
        <button disabled={busy} className={btnGhost}>
          Generate fixtures
        </button>
      </div>
    </form>
  );
}

function ScorerList({ matches, people, onChange }: { matches: (Match & { scorerUserId: string | null })[]; people: { userId: string; name: string }[]; onChange: () => void }) {
  const { call } = useAuth();
  const { error, run } = useAction();
  if (!matches.length) return null;
  const assign = (id: string, scorerUserId: string) => void run(() => call(`/matches/${id}`, { method: "PATCH", body: { scorerUserId: scorerUserId || null } })).then(onChange);
  return (
    <div>
      <h3 className={h2}>Matches and scorers</h3>
      <Message error={error} />
      <ul className="mt-2 divide-y divide-line border-y border-line">
        {matches.map((m) => (
          <li key={m.id} className="grid items-center gap-2 py-1 sm:grid-cols-[1fr_12rem_auto]">
            <MatchRow m={m} />
            <select aria-label="Scorer" value={m.scorerUserId ?? ""} onChange={(e) => assign(m.id, e.target.value)} className="h-10 rounded-lg border border-line bg-white px-2 text-sm">
              <option value="">No scorer</option>
              {people.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </select>
            <Link href={`/score/${m.id}`} className="text-sm font-semibold text-navy underline">
              Score
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
