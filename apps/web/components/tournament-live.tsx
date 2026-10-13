"use client";

import { useEffect, useState } from "react";
import type { Match, StandingGroup } from "@/lib/api";
import { dayKey, dayLabel } from "@/lib/format";
import { connection } from "@/lib/live";
import { Empty, MatchRow, StandingsTable } from "./bits";

type Tab = "schedule" | "table";

/** Schedule and points table, kept current from the tournament room (match.updated, standings.updated). */
export function TournamentLive({ tournamentId, matches: first, standings: firstTables }: { tournamentId: string; matches: Match[]; standings: StandingGroup[] }) {
  const [tab, setTab] = useState<Tab>("schedule");
  const [matches, setMatches] = useState(first);
  const [tables, setTables] = useState(firstTables);

  useEffect(() => {
    const s = connection();
    const room = `tournament:${tournamentId}`;
    const join = () => void s.emit("subscribe", room);
    const onMatch = (m: Match) => setMatches((list) => list.map((x) => (x.id === m.id ? { ...x, ...m } : x)));
    const onTables = (t: StandingGroup[]) => setTables(t);
    join();
    s.on("connect", join);
    s.on("match.updated", onMatch);
    s.on("standings.updated", onTables);
    return () => {
      s.off("connect", join);
      s.off("match.updated", onMatch);
      s.off("standings.updated", onTables);
      s.emit("unsubscribe", room);
    };
  }, [tournamentId]);

  const days = Object.entries(
    matches.reduce<Record<string, Match[]>>((acc, m) => {
      (acc[m.scheduledAt ? dayKey(m.scheduledAt) : "tbc"] ??= []).push(m);
      return acc;
    }, {}),
  ).sort(([a], [b]) => a.localeCompare(b));

  return (
    <section className="mt-8">
      <div role="tablist" aria-label="Tournament views" className="flex gap-6 border-b border-line">
        {(["schedule", "table"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 pb-2 text-sm font-bold ${tab === k ? "border-navy text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {k === "schedule" ? "Schedule and results" : "Points table"}
          </button>
        ))}
      </div>

      {tab === "schedule" ? (
        days.length ? (
          days.map(([day, list]) => (
            <div key={day} className="mt-6">
              <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">{day === "tbc" ? "Time to be confirmed" : dayLabel(list[0].scheduledAt!)}</h2>
              <div>{list.map((m) => <MatchRow key={m.id} m={m} />)}</div>
            </div>
          ))
        ) : (
          <div className="mt-6">
            <Empty title="Fixtures aren't out yet.">They appear here once registration closes and the organiser publishes them.</Empty>
          </div>
        )
      ) : tables.length ? (
        <div className="mt-6 grid gap-8 md:grid-cols-2">{tables.map((g) => <StandingsTable key={`${g.formatId}-${g.group}`} group={g} />)}</div>
      ) : (
        <div className="mt-6">
          <Empty title="No points table for this tournament.">Knockout-only tournaments show their results in the schedule.</Empty>
        </div>
      )}
    </section>
  );
}
