import type { Metadata } from "next";
import { Empty } from "@/components/bits";
import { LiveCard, type LiveNow } from "@/components/live-card";
import { publicGet } from "@/lib/api";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Live scores" };

/** Every match being played right now in public tournaments. */
export default async function Live() {
  const live = await publicGet<LiveNow[]>("/matches/live-now");
  return (
    <section className="pt-10">
      <h1 className="font-score text-5xl font-bold uppercase leading-none tracking-wide">Live scores</h1>
      <p className="mt-2 text-muted">Tap a match to follow it point by point.</p>
      {live?.length ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {live.map((m) => (
            <LiveCard key={m.id} m={m} />
          ))}
        </div>
      ) : (
        <div className="mt-6">
          <Empty title="No matches are live right now." />
        </div>
      )}
    </section>
  );
}
