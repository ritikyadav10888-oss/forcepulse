import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TournamentLive } from "@/components/tournament-live";
import { PUBLIC_API_URL, publicGet, type Match, type StandingGroup, type Tournament } from "@/lib/api";
import { dateRange, rupees, sportName, statusLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** Share previews on WhatsApp, X, LinkedIn (FR-SOC-03). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await publicGet<Tournament>(`/tournaments/${(await params).id}`);
  if (!t) return { title: "Tournament not found" };
  const description = `${dateRange(t.startsAt, t.endsAt)} · ${[t.venue, t.city].filter(Boolean).join(", ")} · ${t.events.map((e) => sportName(e.sportId)).join(", ")}`;
  return { title: t.name, description, openGraph: { title: t.name, description, type: "website" }, twitter: { card: "summary", title: t.name, description } };
}

export default async function TournamentPage({ params }: Props) {
  const t = await publicGet<Tournament>(`/tournaments/${(await params).id}`);
  if (!t) notFound();
  const [matches, standings, gallery] = await Promise.all([
    publicGet<Match[]>(`/tournaments/${t.id}/matches`),
    publicGet<StandingGroup[]>(`/tournaments/${t.id}/standings`),
    publicGet<{ items: { id: string; type: "photo" | "video"; caption: string; url: string; thumbUrl: string | null }[] }>(`/tournaments/${t.id}/media`),
  ]);
  const file = (p: string) => PUBLIC_API_URL.replace(/\/api\/v1\/?$/, "") + p;

  return (
    <>
      <section className="border-b-4 border-navy pt-10 pb-6">
        <p className="text-sm font-semibold text-muted">
          {dateRange(t.startsAt, t.endsAt)} · {statusLabel(t.status)}
        </p>
        <h1 className="mt-1 font-score text-4xl font-bold uppercase leading-none tracking-wide sm:text-5xl">{t.name}</h1>
        <p className="mt-2 text-muted">{[t.venue, t.city].filter(Boolean).join(", ") || "Venue to be announced"}</p>
        <ul className="mt-4 flex flex-wrap gap-2 text-sm">
          {t.events.map((e) => (
            <li key={e.id} className="rounded-full border border-line bg-white px-3 py-1">
              <span className="font-semibold">{sportName(e.sportId)}</span>
              <span className="text-muted"> · {e.feePaise ? rupees(e.feePaise) : "Free"}</span>
            </li>
          ))}
        </ul>
        {t.status === "enrollment_open" ? (
          <a href={`/register/${t.slug}`} className="mt-6 inline-flex h-11 items-center rounded-lg bg-navy px-5 text-sm font-semibold text-white hover:bg-navy/90">
            Register
          </a>
        ) : null}
      </section>
      {t.description ? <p className="mt-6 max-w-prose whitespace-pre-line">{t.description}</p> : null}
      <TournamentLive tournamentId={t.id} matches={matches ?? []} standings={standings ?? []} />
      {gallery?.items.length ? (
        <section className="mt-12">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Gallery</h2>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {gallery.items.map((m) => (
              <li key={m.id} className="overflow-hidden rounded-lg border border-line bg-white">
                {m.type === "video" ? (
                  <video src={file(m.url)} poster={m.thumbUrl ? file(m.thumbUrl) : undefined} controls preload="none" className="aspect-square w-full object-cover" />
                ) : (
                  <a href={file(m.url)} target="_blank" rel="noreferrer">
                    <img src={file(m.thumbUrl ?? m.url)} alt={m.caption || "Tournament photo"} loading="lazy" className="aspect-square w-full object-cover" />
                  </a>
                )}
                {m.caption ? <p className="px-2 py-1.5 text-xs font-semibold">{m.caption}</p> : null}
                <a href={`https://wa.me/?text=${encodeURIComponent(`${m.caption || t.name}: ${file(m.url)}`)}`} target="_blank" rel="noreferrer" className="block px-2 pb-2 text-xs font-semibold text-navy underline">
                  Share
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
