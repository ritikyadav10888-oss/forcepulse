"use client";

import type { LiveScore } from "@/lib/api";
import { sportName } from "@/lib/format";
import { useLive } from "@/lib/live";
import { LiveMarker } from "./bits";

/**
 * The live scoreboard: the screen people watch at the ground. Near-white court surface, big condensed digits with
 * equal widths, and gold only for "live" and the winner (UI direction 1, 2, 4).
 */
export function Scoreboard({ initial }: { initial: LiveScore }) {
  const s = useLive<LiveScore>(`match:${initial.matchId}`, "score.updated", initial);
  const live = s.status === "live";
  const sides = [
    { key: "home" as const, name: s.homeName ?? "To be decided", score: s.summary?.home ?? s.scores.home },
    { key: "away" as const, name: s.awayName ?? "To be decided", score: s.summary?.away ?? s.scores.away },
  ];

  return (
    <article className="mt-8 overflow-hidden rounded-2xl border border-line bg-court" aria-live="polite">
      <header className={`flex items-center justify-between gap-3 border-b px-5 py-3 ${live ? "border-good bg-good text-white" : "border-line"}`}>
        <span className="text-sm font-bold uppercase tracking-wider">{sportName(s.sportId)}</span>
        {live ? <LiveMarker /> : <span className="text-sm font-semibold text-muted">{status(s)}</span>}
      </header>

      <div className="divide-y divide-line">
        {sides.map((side) => {
          const won = s.winner === side.key;
          return (
            <div key={side.key} className="flex items-center justify-between gap-4 px-5 py-4 sm:py-6">
              <div className="min-w-0">
                <p className="truncate text-xl font-bold sm:text-2xl">{side.name}</p>
                {won ? <span className="mt-1 inline-block rounded bg-gold px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-ink">Won</span> : null}
              </div>
              <span className="font-score text-7xl font-bold leading-none tabular sm:text-8xl">{side.score}</span>
            </div>
          );
        })}
      </div>

      {s.summary ? (
        <footer className="border-t border-line px-5 py-4">
          <p className="font-score text-3xl font-semibold tabular">{s.summary.headline}</p>
          {s.summary.subline ? <p className="mt-1 text-sm font-semibold text-muted">{s.summary.subline}</p> : null}
          {s.summary.lines.length ? (
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              {s.summary.lines.map((l) => (
                <div key={l.id} className="flex justify-between gap-3 border-b border-line py-1">
                  <dt className="text-muted">{l.label}</dt>
                  <dd className="font-semibold tabular">{l.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </footer>
      ) : (
        <footer className="border-t border-line px-5 py-4 text-sm text-muted">The score appears here when the match starts.</footer>
      )}
    </article>
  );
}

function status(s: LiveScore) {
  if (s.status === "completed") return s.winner === "draw" ? "Drawn" : "Full time";
  if (s.status === "scheduled") return "Not started";
  return s.status.charAt(0).toUpperCase() + s.status.slice(1);
}
