import type { Match, StandingGroup } from "@/lib/api";
import { timeLabel } from "@/lib/format";

/** Gold is reserved for "happening now", "sold" and "won" (UI direction, principle 2). */
export function LiveMarker({ label = "Live" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-gold px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-ink">
      <span className="live-dot size-1.5 rounded-full bg-ink" aria-hidden />
      {label}
    </span>
  );
}

const RESULT: Partial<Record<Match["status"], string>> = {
  walkover: "Walkover",
  forfeit: "Forfeit",
  abandoned: "Abandoned",
  cancelled: "Cancelled",
};

/** One fixture as a plain list row: time and court, the two sides, the score or state. */
export function MatchRow({ m }: { m: Match }) {
  const home = m.homeName ?? sourceLabel(m.homeSource);
  const away = m.awayName ?? sourceLabel(m.awaySource);
  const done = m.status === "completed" || m.status === "walkover" || m.status === "forfeit";
  const homeWon = done && m.winnerEntrantId && m.winnerEntrantId === m.homeEntrantId;
  const awayWon = done && m.winnerEntrantId && m.winnerEntrantId === m.awayEntrantId;
  return (
    <a href={`/m/${m.id}`} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 border-b border-line py-3 last:border-b-0 hover:bg-line/40 sm:grid-cols-[6rem_1fr_auto]">
      <div className="text-xs leading-tight text-muted">
        <div className="tabular font-semibold text-ink">{m.scheduledAt ? timeLabel(m.scheduledAt) : "TBC"}</div>
        <div className="truncate">{m.court ?? ""}</div>
      </div>
      <div className="min-w-0 text-sm">
        <div className={`truncate ${homeWon ? "font-bold" : ""}`}>{home}</div>
        <div className={`truncate ${awayWon ? "font-bold" : ""}`}>{away}</div>
      </div>
      <div className="text-right">
        {m.status === "live" ? (
          <LiveMarker />
        ) : m.status === "completed" ? (
          <div className="font-score text-xl font-bold leading-tight tabular">
            <div>{m.homeScore}</div>
            <div>{m.awayScore}</div>
          </div>
        ) : RESULT[m.status] ? (
          <span className="text-xs font-semibold text-muted">{RESULT[m.status]}</span>
        ) : null}
      </div>
    </a>
  );
}

/** "A1" → "Winner group A", "W:5" → "Winner of match 5". */
function sourceLabel(s: string | null) {
  if (!s) return "To be decided";
  if (s.startsWith("W:")) return `Winner of match ${s.slice(2)}`;
  if (s.startsWith("L:")) return `Loser of match ${s.slice(2)}`;
  return `${s.slice(1) === "1" ? "Winner" : `No. ${s.slice(1)}`} group ${s[0]}`;
}

export function StandingsTable({ group }: { group: StandingGroup }) {
  return (
    <figure className="overflow-x-auto">
      <figcaption className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Group {group.group}</figcaption>
      <table className="w-full min-w-[22rem] text-sm">
        <thead>
          <tr className="border-b-2 border-ink text-left text-xs uppercase tracking-wider text-muted">
            <th className="w-8 py-2 font-semibold">#</th>
            <th className="py-2 font-semibold">Name</th>
            {["P", "W", "D", "L", "+/−", "Pts"].map((h) => (
              <th key={h} className="w-10 py-2 text-right font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular">
          {group.rows.map((r) => (
            <tr key={r.entrantId} className="border-b border-line">
              <td className="py-2 text-muted">{r.position}</td>
              <td className="py-2 font-semibold">{r.name}</td>
              <td className="py-2 text-right">{r.played}</td>
              <td className="py-2 text-right">{r.won}</td>
              <td className="py-2 text-right">{r.drawn}</td>
              <td className="py-2 text-right">{r.lost}</td>
              <td className="py-2 text-right">{r.scoreDiff > 0 ? `+${r.scoreDiff}` : r.scoreDiff}</td>
              <td className="py-2 text-right font-bold">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-1 text-sm text-muted">{children}</div> : null}
    </div>
  );
}
