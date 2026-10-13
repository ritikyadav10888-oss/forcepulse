import Link from "next/link";
import { Empty } from "@/components/bits";
import { publicGet, type Sport, type Tournament } from "@/lib/api";
import { dateRange, rupees, sportName, statusLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Tournaments({ searchParams }: { searchParams: Promise<{ q?: string; sportId?: string }> }) {
  const { q = "", sportId = "" } = await searchParams;
  const query = new URLSearchParams({ ...(q ? { q } : {}), ...(sportId ? { sportId } : {}) }).toString();
  const [tournaments, sports] = await Promise.all([publicGet<Tournament[]>(`/tournaments${query ? `?${query}` : ""}`), publicGet<Sport[]>("/sports")]);

  return (
    <>
      <section className="pt-10 pb-6">
        <h1 className="font-score text-5xl font-bold uppercase leading-none tracking-wide sm:text-6xl">Tournaments</h1>
        <p className="mt-2 max-w-prose text-muted">Find a tournament, register, and follow every match live.</p>
        <form className="mt-6 flex flex-col gap-2 sm:flex-row" action="/tournaments">
          <label className="sr-only" htmlFor="q">
            Search by name or city
          </label>
          <input id="q" name="q" defaultValue={q} placeholder="Search by name or city" className="h-11 flex-1 rounded-lg border border-line bg-white px-3 text-sm placeholder:text-muted" />
          <label className="sr-only" htmlFor="sportId">
            Sport
          </label>
          <select id="sportId" name="sportId" defaultValue={sportId} className="h-11 rounded-lg border border-line bg-white px-3 text-sm">
            <option value="">All sports</option>
            {(sports ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button className="h-11 rounded-lg bg-navy px-5 text-sm font-semibold text-white hover:bg-navy/90">Search</button>
        </form>
      </section>

      {tournaments?.length ? (
        <ul className="divide-y divide-line border-y border-line">
          {tournaments.map((t) => (
            <li key={t.id}>
              <Link href={`/t/${t.slug}`} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 py-4 hover:bg-line/40 sm:grid-cols-[9rem_1fr_auto]">
                <span className="text-sm font-semibold text-muted sm:row-span-2">{dateRange(t.startsAt, t.endsAt)}</span>
                <span className="col-start-1 row-start-2 text-lg font-bold sm:col-start-2 sm:row-start-1">{t.name}</span>
                <span className="col-start-1 row-start-3 text-sm text-muted sm:col-start-2 sm:row-start-2">
                  {[t.venue, t.city].filter(Boolean).join(", ") || "Venue to be announced"} · {t.events.map((e) => sportName(e.sportId)).join(", ")}
                </span>
                <span className="col-start-2 row-span-3 row-start-1 self-center text-right text-sm sm:col-start-3">
                  <span className="block font-semibold">{statusLabel(t.status)}</span>
                  <span className="text-muted">{t.isPaid ? `From ${rupees(Math.min(...t.events.flatMap((e) => [e.feePaise, ...e.categories.map((c) => c.feePaise ?? e.feePaise)]).filter((f) => f > 0)))}` : "Free"}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title={q || sportId ? "No tournaments match that search." : "No tournaments are open right now."}>
          {q || sportId ? (
            <Link href="/tournaments" className="font-semibold text-navy underline">
              Clear the search
            </Link>
          ) : (
            "Check back soon, or create one from your account."
          )}
        </Empty>
      )}
    </>
  );
}
