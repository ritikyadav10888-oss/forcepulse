"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getScoringModule, UNDO_ACTION, type ActionField, type ScoreEvent } from "@force-pulse/scoring";
import { ApiError, apiFetch, PUBLIC_API_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { sportName } from "@/lib/format";

interface Live {
  matchId: string;
  tournamentId: string;
  sportId: string;
  status: string;
  homeName: string | null;
  awayName: string | null;
  rules: Record<string, number | string> | null;
}
type Pending = { action: string; label: string; payload: Record<string, string | number | boolean | null>; fields: ActionField[] };
type Payload = Record<string, string | number | boolean | null>;

const deviceId = () => {
  let id = localStorage.getItem("fp.device");
  if (!id) localStorage.setItem("fp.device", (id = `web-${crypto.randomUUID()}`));
  return id;
};
const queueKey = (m: string) => `fp.queue.${m}`;

/**
 * The scorer's pad (FR-SCR-07 to 14, NFR-12): near-white court surface, big one-handed buttons, and the same scoring
 * engine as the server. Every tap is saved on the phone first, then synced, so a weak signal at the ground loses nothing.
 */
export default function ScorePad() {
  const { id } = useParams<{ id: string }>();
  const { user, loading, call } = useAuth();
  const router = useRouter();
  const [live, setLive] = useState<Live | null>(null);
  const [saved, setSaved] = useState<ScoreEvent[]>([]);
  const [queue, setQueue] = useState<ScoreEvent[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState<Pending | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  const loadServer = useCallback(async () => {
    const l = await call<Live>(`/matches/${id}/live`);
    setLive(l);
    if (l.rules) setSaved(await call<ScoreEvent[]>(`/matches/${id}/events`));
    return l;
  }, [call, id]);

  useEffect(() => {
    if (loading) return;
    if (!user) return router.replace(`/login?next=/score/${id}`);
    setQueue(JSON.parse(localStorage.getItem(queueKey(id)) ?? "[]"));
    void loadServer().catch((e) => setNote(e instanceof ApiError ? e.message : "Couldn't load the match."));
  }, [user, loading, router, id, loadServer]);

  // Player names for squad pickers (squads are player ids frozen on the match).
  useEffect(() => {
    const ids = [live?.rules?.homeSquad, live?.rules?.awaySquad].flatMap((s) => String(s ?? "").split(",")).filter(Boolean);
    void Promise.all(ids.map((p) => apiFetch<{ id: string; name: string }>(`/players/${p}`, { base: PUBLIC_API_URL }).catch(() => null))).then((rows) =>
      setNames(Object.fromEntries(rows.filter(Boolean).map((r) => [r!.id, r!.name]))),
    );
  }, [live?.rules?.homeSquad, live?.rules?.awaySquad]);

  const module = live ? getScoringModule(live.sportId) : undefined;
  const events = useMemo(() => [...saved, ...queue], [saved, queue]);
  const state = module && live?.rules ? module.computeState(events, live.rules) : null;

  const sync = useCallback(
    async (pending: ScoreEvent[]) => {
      if (!pending.length) return;
      try {
        await call(`/matches/${id}/events`, { method: "POST", body: { deviceId: deviceId(), events: pending.map(({ id: eid, seq, action, payload }) => ({ id: eid, seq, action, payload })) } });
        setSaved((s) => [...s, ...pending]);
        setQueue([]);
        localStorage.removeItem(queueKey(id));
        setOnline(true);
        setNote(null);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const reason = (e.details as { reason?: string } | undefined)?.reason;
          if (reason === "out_of_order") {
            // Another sync landed first: renumber what's still on the phone after the server's last event.
            const server = await call<ScoreEvent[]>(`/matches/${id}/events`);
            const last = server.at(-1)?.seq ?? 0;
            const known = new Set(server.map((x) => x.id));
            const rest = pending.filter((x) => !known.has(x.id)).map((x, i) => ({ ...x, seq: last + i + 1 }));
            setSaved(server);
            setQueue(rest);
            localStorage.setItem(queueKey(id), JSON.stringify(rest));
            return;
          }
          setNote(e.message);
        } else {
          setOnline(false); // keep the queue; retry below
        }
      }
    },
    [call, id],
  );

  // Retry the queue every few seconds while offline.
  useEffect(() => {
    if (!queue.length) return;
    const t = setInterval(() => void sync(queue), 4000);
    return () => clearInterval(t);
  }, [queue, sync]);

  function record(action: string, payload: Payload) {
    const ev: ScoreEvent = { id: crypto.randomUUID(), matchId: id, seq: (events.at(-1)?.seq ?? 0) + 1, action, payload, createdAt: new Date().toISOString() };
    const next = [...queue, ev];
    setQueue(next);
    localStorage.setItem(queueKey(id), JSON.stringify(next));
    void sync(next);
  }

  function tap(a: { action: string; label: string; payload?: Payload; fields?: ActionField[]; confirm?: string }) {
    if (a.confirm && !window.confirm(a.confirm)) return;
    if (a.fields?.length) return setAsk({ action: a.action, label: a.label, payload: a.payload ?? {}, fields: a.fields });
    record(a.action, a.payload ?? {});
  }

  async function start() {
    try {
      await call(`/matches/${id}/start`, { method: "POST", body: { deviceId: deviceId() } });
      await loadServer();
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : "Couldn't start the match.");
    }
  }

  async function close() {
    if (queue.length) return setNote("Wait until every point is synced, then close.");
    try {
      await call(`/matches/${id}/close`, { method: "POST", body: {} });
      router.push(`/m/${id}`);
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : "Couldn't close the match.");
    }
  }

  if (!live) return <div className="pt-14 text-muted">{note ?? "Loading…"}</div>;
  const summary = module && state ? module.summarise(state) : null;
  const setup = module && state ? module.setupSteps.find((s) => !s.done(state)) : undefined;
  const actions = module && state && !setup && !state.pending ? module.actions.filter((a) => !a.visible || a.visible(state)) : [];
  const playerName = (p: string) => names[p] ?? p.slice(0, 8);

  return (
    <div className="-mx-4 min-h-[100dvh] bg-court px-4 pb-10 sm:-mx-6 sm:px-6">
      <div className="flex items-center justify-between border-b-4 border-good py-3">
        <span className="text-sm font-bold uppercase tracking-wider">{sportName(live.sportId)} · scoring</span>
        <span className="text-sm font-semibold">{queue.length ? `${queue.length} waiting to sync${online ? "" : " (offline)"}` : "All synced"}</span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-6 text-center">
        <p className="truncate text-lg font-bold">{live.homeName ?? "Home"}</p>
        <p className="font-score text-6xl font-bold tabular sm:text-7xl">
          {summary ? `${summary.home} – ${summary.away}` : "0 – 0"}
        </p>
        <p className="truncate text-lg font-bold">{live.awayName ?? "Away"}</p>
      </div>
      {summary ? <p className="text-center font-score text-2xl tabular">{summary.headline}{summary.subline ? ` · ${summary.subline}` : ""}</p> : null}

      {note ? <p role="alert" className="mt-4 rounded-lg bg-bad/15 px-3 py-2 text-sm font-semibold">{note}</p> : null}

      {!live.rules ? (
        <button onClick={() => void start()} className="mt-8 h-20 w-full rounded-xl bg-navy text-xl font-bold text-white">
          Start match
        </button>
      ) : ask || setup || state?.pending ? (
        <Prompt
          title={ask?.label ?? setup?.title ?? state!.pending!.title}
          fields={ask?.fields ?? setup?.fields ?? state!.pending!.fields}
          sets={state!.playerSets}
          name={playerName}
          onCancel={ask ? () => setAsk(null) : undefined}
          onDone={(values) => {
            record(ask?.action ?? setup?.action ?? state!.pending!.action, { ...(ask?.payload ?? {}), ...values });
            setAsk(null);
          }}
        />
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-3">
          {actions.map((a) => (
            <button
              key={a.id}
              onClick={() => tap(a)}
              className={`rounded-xl px-2 text-lg font-bold ${a.shape === "wide" || a.group === "period" ? "col-span-2 h-14 border-2 border-ink bg-white" : "h-24 bg-navy text-white"} ${a.tone === "danger" ? "border-bad" : ""}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {live.rules ? (
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button onClick={() => record(UNDO_ACTION, {})} disabled={!events.length} className="h-14 rounded-xl border-2 border-ink bg-white text-lg font-bold disabled:opacity-40">
            Undo
          </button>
          <button onClick={() => void close()} disabled={state?.phase !== "complete"} className="h-14 rounded-xl bg-good text-lg font-bold text-white disabled:opacity-40">
            Close match
          </button>
        </div>
      ) : null}

      <p className="mt-8 text-center text-sm">
        <Link href={`/m/${id}`} className="font-semibold text-navy underline">
          Public scoreboard
        </Link>
      </p>
    </div>
  );
}

/** Fields an action needs before it is recorded: a player, several players, a side or an option. */
function Prompt({ title, fields, sets, name, onDone, onCancel }: { title: string; fields: ActionField[]; sets: Record<string, string[]>; name: (id: string) => string; onDone: (v: Payload) => void; onCancel?: () => void }) {
  const [v, setV] = useState<Record<string, string>>({});
  const ready = fields.every((f) => !f.required || v[f.key]);
  return (
    <div className="mt-8 space-y-4 rounded-xl border-2 border-ink bg-white p-4">
      <p className="text-lg font-bold">{title}</p>
      {fields.map((f) => {
        const options = f.type === "team" ? [{ value: "home", label: "Home" }, { value: "away", label: "Away" }] : f.options ?? (sets[f.from ?? ""] ?? []).map((p) => ({ value: p, label: name(p) }));
        if (f.type === "players") {
          const chosen = (v[f.key] ?? "").split(",").filter(Boolean);
          return (
            <fieldset key={f.key}>
              <legend className="text-sm font-semibold">{f.label}</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {options.map((o) => (
                  <label key={o.value} className="flex h-12 items-center gap-2 rounded-lg border border-line px-3">
                    <input type="checkbox" checked={chosen.includes(o.value)} onChange={(e) => setV({ ...v, [f.key]: (e.target.checked ? [...chosen, o.value] : chosen.filter((x) => x !== o.value)).join(",") })} />
                    {o.label}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        }
        return (
          <label key={f.key} className="block text-sm font-semibold">
            {f.label}
            <select value={v[f.key] ?? ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} className="mt-1 h-12 w-full rounded-lg border border-line bg-white px-3 text-base">
              <option value="">Choose…</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      <div className="grid grid-cols-2 gap-3">
        {onCancel ? (
          <button onClick={onCancel} className="h-14 rounded-xl border-2 border-ink text-lg font-bold">
            Cancel
          </button>
        ) : (
          <span />
        )}
        <button disabled={!ready} onClick={() => onDone(v)} className="h-14 rounded-xl bg-navy text-lg font-bold text-white disabled:opacity-40">
          Save
        </button>
      </div>
    </div>
  );
}
