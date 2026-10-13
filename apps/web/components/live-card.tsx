import Link from "next/link";
import { sportName } from "@/lib/format";
import { LiveMarker } from "./bits";

export interface LiveNow {
  id: string;
  tournamentName: string;
  sportId: string;
  homeName: string | null;
  awayName: string | null;
  court: string | null;
}

/** One live match as a card: sport, the two sides, where. Tapping opens the live scoreboard. */
export function LiveCard({ m }: { m: LiveNow }) {
  return (
    <Link href={`/m/${m.id}`} className="block rounded-xl border border-line bg-white p-4 hover:border-navy">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-muted">{sportName(m.sportId)}</span>
        <LiveMarker />
      </div>
      <p className="mt-3 truncate font-semibold">{m.homeName ?? "To be decided"}</p>
      <p className="truncate font-semibold">{m.awayName ?? "To be decided"}</p>
      <p className="mt-2 truncate text-xs text-muted">
        {m.tournamentName}
        {m.court ? ` · ${m.court}` : ""}
      </p>
    </Link>
  );
}
