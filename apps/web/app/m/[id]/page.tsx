import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Scoreboard } from "@/components/scoreboard";
import { publicGet, type LiveScore } from "@/lib/api";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const s = await publicGet<LiveScore>(`/matches/${(await params).id}/live`);
  if (!s) return { title: "Match not found" };
  const title = `${s.homeName ?? "TBD"} vs ${s.awayName ?? "TBD"}`;
  const description = s.summary ? `${s.summary.headline}${s.summary.subline ? ` · ${s.summary.subline}` : ""}` : "Live score on Force Pulse";
  return { title, description, openGraph: { title, description }, twitter: { card: "summary", title, description } };
}

export default async function MatchPage({ params }: Props) {
  const s = await publicGet<LiveScore>(`/matches/${(await params).id}/live`);
  if (!s) notFound();
  return <Scoreboard initial={s} />;
}
