import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { publicGet } from "@/lib/api";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };
interface Page {
  title: string;
  body: string;
  updatedAt: string;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await publicGet<Page>(`/pages/${(await params).slug}`);
  return { title: p?.title ?? "Page not found" };
}

/** About, sports, partners, FAQ, terms, privacy and refund pages (FR-ABT-01), edited by staff in Admin. */
export default async function SitePage({ params }: Props) {
  const p = await publicGet<Page>(`/pages/${(await params).slug}`);
  if (!p) notFound();
  return (
    <article className="pt-10">
      <h1 className="mb-6 font-score text-4xl font-bold uppercase tracking-wide">{p.title}</h1>
      <Markdown text={p.body} />
      <p className="mt-10 text-xs text-muted">Last updated {new Date(p.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</p>
    </article>
  );
}
