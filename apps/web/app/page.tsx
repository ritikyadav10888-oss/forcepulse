import Link from "next/link";
import { LiveCard, type LiveNow } from "@/components/live-card";
import { publicGet, type Sport, type Tournament } from "@/lib/api";
import { dateRange, sportName } from "@/lib/format";

export const dynamic = "force-dynamic";

const STEPS = [
  { who: "Organisers", steps: ["Create a tournament and your own registration form", "Collect entry fees online; fixtures are made for you", "Score live, run a player auction, share the results"] },
  { who: "Players", steps: ["Find a tournament and register in minutes", "Follow every match live, ball by ball and point by point", "Build a profile of your games, wins and badges"] },
];

/** The front door: what Force Pulse is, what's live, what's open, and how it works. */
export default async function Home() {
  const [live, open, sports] = await Promise.all([
    publicGet<LiveNow[]>("/matches/live-now"),
    publicGet<Tournament[]>("/tournaments?status=enrollment_open&limit=6"),
    publicGet<Sport[]>("/sports"),
  ]);

  return (
    <>
      {/* Full-width banner inside the page container. */}
      <section className="relative left-1/2 w-screen -translate-x-1/2 bg-navy text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-[1.3fr_1fr] md:py-20">
          <div>
            <h1 className="font-score text-5xl font-bold uppercase leading-[0.95] tracking-wide sm:text-7xl">
              Every match.
              <br />
              Live.
            </h1>
            <p className="mt-5 max-w-lg text-lg text-white/85">Run tournaments, take entries, score live from the ground and auction players, all in one place.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/tournaments" className="inline-flex h-12 items-center rounded-lg bg-white px-6 font-semibold text-navy hover:bg-cream">
                Find a tournament
              </Link>
              <Link href="/organise/new" className="inline-flex h-12 items-center rounded-lg border-2 border-white px-6 font-semibold hover:bg-white/10">
                Organise one
              </Link>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 self-center">
            {[
              [String(sports?.length ?? 0), "sports to enter"],
              [String(live?.length ?? 0), "matches live now"],
              [String(open?.length ?? 0), "open for entries"],
              ["≤ 2 s", "live score delay"],
            ].map(([n, label]) => (
              <div key={label} className="rounded-xl bg-white/10 p-4">
                <dt className="sr-only">{label}</dt>
                <dd className="font-score text-4xl font-bold tabular">{n}</dd>
                <dd className="text-sm text-white/80">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="pt-12" aria-labelledby="live-now">
        <div className="flex items-end justify-between gap-3">
          <h2 id="live-now" className="font-score text-3xl font-bold uppercase tracking-wide">
            Live now
          </h2>
          <Link href="/live" className="text-sm font-semibold text-navy underline">
            All live matches
          </Link>
        </div>
        {live?.length ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {live.slice(0, 8).map((m) => (
              <LiveCard key={m.id} m={m} />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-muted">Nothing is being played right now. Check the tournaments below.</p>
        )}
      </section>

      <section className="pt-12" aria-labelledby="open">
        <div className="flex items-end justify-between gap-3">
          <h2 id="open" className="font-score text-3xl font-bold uppercase tracking-wide">
            Open for entries
          </h2>
          <Link href="/tournaments" className="text-sm font-semibold text-navy underline">
            All tournaments
          </Link>
        </div>
        {open?.length ? (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {open.map((t) => (
              <li key={t.id}>
                <Link href={`/t/${t.slug}`} className="block h-full rounded-xl border border-line bg-white p-5 hover:border-navy">
                  <p className="text-sm font-semibold text-muted">{dateRange(t.startsAt, t.endsAt)}</p>
                  <p className="mt-1 text-lg font-bold">{t.name}</p>
                  <p className="mt-1 text-sm text-muted">{[t.venue, t.city].filter(Boolean).join(", ") || "Venue to be announced"}</p>
                  <p className="mt-3 text-sm">{t.events.map((e) => sportName(e.sportId)).join(" · ")}</p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-muted">No tournaments are taking entries right now.</p>
        )}
      </section>

      <section className="pt-12" aria-labelledby="sports">
        <h2 id="sports" className="font-score text-3xl font-bold uppercase tracking-wide">
          Sports
        </h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {(sports ?? []).map((s) => (
            <li key={s.id}>
              <Link href={`/tournaments?sportId=${s.id}`} className="inline-block rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold hover:border-navy">
                {s.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="pt-12" aria-labelledby="how">
        <h2 id="how" className="font-score text-3xl font-bold uppercase tracking-wide">
          How it works
        </h2>
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          {STEPS.map((s) => (
            <div key={s.who} className="rounded-xl border border-line bg-white p-6">
              <h3 className="text-lg font-bold">For {s.who.toLowerCase()}</h3>
              <ol className="mt-4 space-y-3">
                {s.steps.map((step, i) => (
                  <li key={step} className="flex gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-navy font-score text-lg font-bold text-white">{i + 1}</span>
                    <span className="pt-1">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
