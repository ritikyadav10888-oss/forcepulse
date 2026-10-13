"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { download } from "@/lib/download";
import { useLive } from "@/lib/live";
import { btn, btnDanger, btnGhost, Message, useAction } from "./form";

export interface AuctionState {
  id: string;
  tournamentId: string;
  status: "locked" | "setup" | "live" | "paused" | "completed";
  purse: number;
  minSquad: number;
  maxSquad: number;
  timerSeconds: number;
  lotOrder: string;
  maxTeams: number;
  planId: string | null;
  currentBid: number | null;
  leadingTeamId: string | null;
  endsAt: string | null;
  serverTime: string;
  round: number;
  categories: { id: string; name: string; basePoints: number; quotaPerTeam: number | null }[];
  teams: { id: string; name: string; ownerUserId: string | null; pointsLeft: number; players: number; slotsLeft: number }[];
  current: { lotId: string; name: string; photoUrl: string; category: string; basePoints: number; round: number } | null;
  bids: { teamId: string; points: number; floor: boolean; at: string }[];
  lots: { lotId: string; name: string; category: string; status: string; soldTeamId: string | null; soldPoints: number | null; retained: boolean }[];
}

const pts = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-IN");

/** Seconds left on the lot, from the server's clock (System Design 8.1: ends_at minus clock offset). */
function useCountdown(s: AuctionState) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const offset = Date.parse(s.serverTime) - Date.now();
    const tick = () => setLeft(s.endsAt ? Math.max(0, Math.ceil((Date.parse(s.endsAt) - (Date.now() + offset)) / 1000)) : 0);
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [s.endsAt, s.serverTime]);
  return left;
}

/** The live room (FR-AUC-09 to 18). Every update carries the full state, so screens never drift. */
export function AuctionLive({ initial, auctioneer, projector }: { initial: AuctionState; auctioneer: boolean; projector: boolean }) {
  const s = useLive<AuctionState>(`auction:${initial.id}`, "auction.updated", initial);
  const { user, call, token } = useAuth();
  const { busy, error, run } = useAction();
  const left = useCountdown(s);
  const team = (id: string | null) => s.teams.find((t) => t.id === id)?.name ?? "";
  const mine = s.teams.find((t) => user && t.ownerUserId === user.id);
  const act = (path: string, body: object = {}) => void run(() => call(`/auctions/${s.id}/${path}`, { method: "POST", body }));
  const lastSold = [...s.lots].reverse().find((l) => l.status === "sold");

  return (
    <div className={projector ? "fixed inset-0 z-50 overflow-auto bg-navy p-8 text-white" : "pt-8"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={`text-sm font-bold uppercase tracking-wider ${projector ? "" : "text-muted"}`}>
          Auction · round {s.round} · {s.status}
        </p>
        {!projector ? (
          <a href="?view=projector" className="text-sm font-semibold text-navy underline">
            Projector view
          </a>
        ) : null}
      </div>

      <section className={`mt-4 rounded-2xl border-4 p-6 text-center ${s.leadingTeamId ? "border-gold" : "border-line"} ${projector ? "bg-navy" : "bg-white"}`}>
        {s.current ? (
          <>
            <p className="text-sm font-bold uppercase tracking-wider">{s.current.category} · base {pts(s.current.basePoints)}</p>
            <h1 className={`font-score font-bold uppercase ${projector ? "text-8xl" : "text-5xl"}`}>{s.current.name}</h1>
            <p className={`mt-4 font-score font-bold tabular ${projector ? "text-9xl" : "text-7xl"}`}>{pts(s.currentBid ?? s.current.basePoints)}</p>
            <p className="mt-2 text-lg font-semibold">{s.leadingTeamId ? <span className="rounded bg-gold px-2 text-ink">{team(s.leadingTeamId)} leads</span> : "No bids yet"}</p>
            <p className={`mt-3 font-score text-4xl font-bold tabular ${left <= 10 && s.status === "live" ? "rounded bg-warn px-3 text-ink" : ""}`} aria-live="off">
              {s.status === "paused" ? "Paused" : `${left}s`}
            </p>
          </>
        ) : lastSold ? (
          <div>
            <span className="rounded bg-gold px-3 py-1 text-sm font-bold uppercase text-ink">Sold</span>
            <h1 className={`mt-3 font-score font-bold uppercase ${projector ? "text-8xl" : "text-5xl"}`}>{lastSold.name}</h1>
            <p className="mt-2 text-xl">
              to <b>{team(lastSold.soldTeamId)}</b> for <b className="tabular">{pts(lastSold.soldPoints)}</b> points
            </p>
          </div>
        ) : (
          <p className="text-lg">{s.status === "completed" ? "The auction is over." : "Waiting for the next player…"}</p>
        )}
      </section>

      {mine && s.current && s.status === "live" ? (
        <button disabled={busy || s.leadingTeamId === mine.id} onClick={() => act("bid", { teamId: mine.id })} className="mt-4 h-20 w-full rounded-xl bg-navy text-2xl font-bold text-white disabled:opacity-40">
          {s.leadingTeamId === mine.id ? "You lead" : `Bid for ${mine.name}`}
        </button>
      ) : null}

      {auctioneer ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {s.status === "live" && !s.current ? <button className={btn} disabled={busy} onClick={() => act("next", {})}>Next player</button> : null}
            {s.status === "live" ? <button className={btnGhost} disabled={busy} onClick={() => act("pause")}>Pause</button> : null}
            {s.status === "paused" ? <button className={btn} disabled={busy} onClick={() => act("resume")}>Resume</button> : null}
            {!s.current && (s.status === "live" || s.status === "paused") ? (
              <>
                <button className={btnGhost} disabled={busy} onClick={() => { const reason = prompt("Why undo the last sale?"); if (reason) act("undo", { reason }); }}>Undo last sale</button>
                <button className={btnGhost} disabled={busy} onClick={() => act("reauction")}>Re-auction unsold</button>
                <button className={btnDanger} disabled={busy} onClick={() => confirm("Close the auction? Sold players join their teams.") && act("close")}>Close auction</button>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="font-semibold">Download results:</span>
            {(["pdf", "xlsx", "csv"] as const).map((x) => (
              <button key={x} className="font-semibold text-navy underline" onClick={() => void run(() => download(`/auctions/${s.id}/export.${x}`, token(), `auction-results.${x}`))}>
                {x === "xlsx" ? "Excel" : x.toUpperCase()}
              </button>
            ))}
          </div>
          {s.current && s.status === "live" ? (
            <div className="flex flex-wrap gap-2">
              <span className="self-center text-sm font-semibold">Floor bid for:</span>
              {s.teams.map((t) => (
                <button key={t.id} className={btnGhost} disabled={busy || s.leadingTeamId === t.id} onClick={() => act("bid", { teamId: t.id, floor: true })}>
                  {t.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3">
        <Message error={error} />
      </div>

      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_16rem]">
        <section>
          <h2 className="text-xs font-bold uppercase tracking-wider">Teams</h2>
          <table className="mt-2 w-full text-sm tabular">
            <thead>
              <tr className="border-b-2 text-left text-xs uppercase">
                <th className="py-2">Team</th>
                <th className="text-right">Points left</th>
                <th className="text-right">Players</th>
                <th className="text-right">Slots left</th>
              </tr>
            </thead>
            <tbody>
              {s.teams.map((t) => (
                <tr key={t.id} className={`border-b ${projector ? "border-white/20" : "border-line"}`}>
                  <td className="py-2 font-semibold">{t.name}</td>
                  <td className="text-right">{pts(t.pointsLeft)}</td>
                  <td className="text-right">{t.players}</td>
                  <td className="text-right">{t.slotsLeft}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h2 className="text-xs font-bold uppercase tracking-wider">Bids on this player</h2>
          <ul className="mt-2 space-y-1 text-sm tabular">
            {s.bids.map((b, i) => (
              <li key={i} className="flex justify-between">
                <span>{team(b.teamId)}{b.floor ? " (floor)" : ""}</span>
                <b>{pts(b.points)}</b>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
