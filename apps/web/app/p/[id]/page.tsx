import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Empty } from "@/components/bits";
import { publicGet } from "@/lib/api";
import { dayLabel, sportName } from "@/lib/format";

export const dynamic = "force-dynamic";

interface Profile {
  player: { id: string; playerCode: string; name: string; photoUrl: string; gender: string | null; age: number | null; city: string; state: string };
  roleLabel: string;
  tournamentsOrganised: number;
  matchesScored: number;
  totals: { played: number; won: number; winPct: number };
  sports: { sportId: string; played: number; won: number; lost: number; drawn: number; winPct: number; stats: Record<string, number> }[];
  history: { tournamentId: string; tournamentName: string; slug: string; startsAt: string; sportId: string; category: string | null; team: string | null; status: string; finish: string | null }[];
  auctions: { tournamentName: string; category: string; basePoints: number; status: string; soldPoints: number | null; team: string | null }[];
  lastMatches: { matchId: string; sportId: string; tournamentName: string; playedAt: string | null; opponent: string; score: string | null; result: "won" | "lost" | "drawn"; how: string | null; playerOfMatch: boolean }[];
  badges: { id: string; label: string }[];
}

type Props = { params: Promise<{ id: string }> };
const statLabel = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/^\w/, (c) => c.toUpperCase());
const h2 = "text-xs font-bold uppercase tracking-wider text-muted";

/** Share preview (FR-SOC-03): never includes phone, date of birth or pincode (FR-PRO-07). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await publicGet<Profile>(`/players/${(await params).id}/profile`);
  if (!p) return { title: "Player not found" };
  const description = `${p.totals.played} matches · ${p.totals.won} wins · ${p.sports.map((s) => sportName(s.sportId)).join(", ") || "Force Pulse player"}`;
  return { title: p.player.name || p.player.playerCode, description, openGraph: { title: p.player.name, description, type: "profile" }, twitter: { card: "summary", title: p.player.name, description } };
}

/** The player profile card (FR-PRO-01 to 05): one of the screens people screenshot, so it may look premium. */
export default async function PlayerPage({ params }: Props) {
  const p = await publicGet<Profile>(`/players/${(await params).id}/profile`);
  if (!p) notFound();
  const h = await headers();
  const url = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}/p/${p.player.id}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 0, color: { dark: "#0b1220", light: "#ffffff" } });
  const place = [p.player.city, p.player.state].filter(Boolean).join(", ");

  return (
    <div className="space-y-12 pt-8">
      <section className="grid gap-6 rounded-2xl bg-navy p-6 text-white sm:grid-cols-[1fr_auto]">
        <div className="flex items-center gap-5">
          {p.player.photoUrl ? (
            <img src={p.player.photoUrl} alt="" className="size-24 shrink-0 rounded-full object-cover ring-4 ring-gold" />
          ) : (
            <div aria-hidden className="grid size-24 shrink-0 place-items-center rounded-full bg-white/10 font-score text-4xl font-bold">
              {(p.player.name || "?").slice(0, 1)}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white/80">{p.roleLabel}</p>
            <h1 className="font-score text-4xl font-bold uppercase tracking-wide sm:text-5xl">{p.player.name || "Player"}</h1>
            <p className="text-sm text-white/80">
              <span className="tabular font-bold text-white">{p.player.playerCode}</span>
              {p.player.age !== null ? ` · ${p.player.age} yrs` : ""}
              {p.player.gender ? ` · ${p.player.gender === "male" ? "Male" : "Female"}` : ""}
              {place ? ` · ${place}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 sm:flex-col sm:items-end">
          <div className="size-24 rounded-lg bg-white p-2" aria-label="QR code for this profile" role="img" dangerouslySetInnerHTML={{ __html: qr }} />
          <a href={`https://wa.me/?text=${encodeURIComponent(`${p.player.name} on Force Pulse: ${url}`)}`} target="_blank" rel="noreferrer" className="text-sm font-semibold underline">
            Share on WhatsApp
          </a>
        </div>
        <dl className="grid grid-cols-3 gap-3 sm:col-span-2">
          {[
            ["Matches", p.totals.played],
            ["Wins", p.totals.won],
            ["Win %", `${p.totals.winPct}%`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-white/10 p-3">
              <dt className="text-xs font-semibold uppercase tracking-wider text-white/80">{k}</dt>
              <dd className="font-score text-4xl font-bold tabular">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {p.badges.length ? (
        <section>
          <h2 className={h2}>Badges</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {p.badges.map((b) => (
              <li key={b.id} className={`rounded-full px-3 py-1 text-sm font-bold ${b.id === "champion" || b.id === "potm" ? "bg-gold text-ink" : "bg-white"}`}>
                {b.label}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className={h2}>By sport</h2>
        {p.sports.length ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm tabular">
              <thead>
                <tr className="border-b-2 border-ink text-left text-xs uppercase tracking-wider text-muted">
                  <th className="py-2">Sport</th>
                  {["P", "W", "L", "D", "Win %"].map((x) => (
                    <th key={x} className="text-right">{x}</th>
                  ))}
                  <th className="pl-4">Stats</th>
                </tr>
              </thead>
              <tbody>
                {p.sports.map((s) => (
                  <tr key={s.sportId} className="border-b border-line">
                    <td className="py-2 font-semibold">{sportName(s.sportId)}</td>
                    <td className="text-right">{s.played}</td>
                    <td className="text-right">{s.won}</td>
                    <td className="text-right">{s.lost}</td>
                    <td className="text-right">{s.drawn}</td>
                    <td className="text-right font-bold">{s.winPct}%</td>
                    <td className="pl-4 text-muted">{Object.entries(s.stats).map(([k, v]) => `${statLabel(k)} ${v}`).join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-2">
            <Empty title="No matches played yet." />
          </div>
        )}
      </section>

      <section>
        <h2 className={h2}>Last 10 matches</h2>
        {p.lastMatches.length ? (
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {p.lastMatches.map((m) => (
              <li key={m.matchId}>
                <Link href={`/m/${m.matchId}`} className="grid grid-cols-[4rem_1fr_auto] items-center gap-3 py-3 text-sm hover:bg-line/40">
                  <span className={`rounded px-2 py-0.5 text-center text-xs font-bold uppercase ${m.result === "won" ? "bg-gold text-ink" : m.result === "lost" ? "bg-line" : "bg-white"}`}>{m.result}</span>
                  <span className="min-w-0">
                    <b className="block truncate">vs {m.opponent || "—"}</b>
                    <span className="block truncate text-xs text-muted">
                      {sportName(m.sportId)} · {m.tournamentName}
                      {m.playedAt ? ` · ${dayLabel(m.playedAt)}` : ""}
                      {m.playerOfMatch ? " · Player of the Match" : ""}
                    </span>
                  </span>
                  <span className="font-score text-xl font-bold tabular">{m.score ?? m.how ?? ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-2">
            <Empty title="No matches yet." />
          </div>
        )}
      </section>

      <div className="grid gap-12 md:grid-cols-2">
        <section>
          <h2 className={h2}>Tournaments</h2>
          {p.history.length ? (
            <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
              {p.history.map((x, i) => (
                <li key={i}>
                  <Link href={`/t/${x.slug}`} className="flex items-center justify-between gap-3 py-3 hover:bg-line/40">
                    <span className="min-w-0">
                      <b className="block truncate">{x.tournamentName}</b>
                      <span className="text-xs text-muted">
                        {sportName(x.sportId)}
                        {x.category ? ` · ${x.category}` : ""}
                        {x.team ? ` · ${x.team}` : ""} · {dayLabel(x.startsAt)}
                      </span>
                    </span>
                    {x.finish ? <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold ${x.finish === "Winner" ? "bg-gold text-ink" : "bg-white"}`}>{x.finish}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">None yet.</p>
          )}
        </section>

        <section>
          <h2 className={h2}>Auctions</h2>
          {p.auctions.length ? (
            <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
              {p.auctions.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-3">
                  <span>
                    <b>{a.tournamentName}</b>
                    <span className="block text-xs text-muted">
                      {a.category} · base {a.basePoints.toLocaleString("en-IN")} pts
                    </span>
                  </span>
                  {a.status === "sold" ? (
                    <span className="rounded bg-gold px-2 py-0.5 text-xs font-bold text-ink">
                      Sold to {a.team} · {a.soldPoints?.toLocaleString("en-IN")} pts
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-muted">{a.status}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">None yet.</p>
          )}
        </section>
      </div>

      {p.tournamentsOrganised || p.matchesScored ? (
        <p className="text-sm text-muted">
          Organised {p.tournamentsOrganised} tournament{p.tournamentsOrganised === 1 ? "" : "s"} · scored {p.matchesScored} match{p.matchesScored === 1 ? "" : "es"}
        </p>
      ) : null}
    </div>
  );
}
