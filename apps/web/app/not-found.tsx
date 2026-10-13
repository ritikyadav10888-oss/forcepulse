import Link from "next/link";

/** Shown for unknown addresses, and for tournaments that are still drafts (they stay private until registration opens). */
export default function NotFound() {
  return (
    <section className="max-w-xl pt-16">
      <h1 className="font-score text-4xl font-bold uppercase tracking-wide">Page not found</h1>
      <p className="mt-3 text-muted">
        This page doesn&apos;t exist, or it&apos;s a tournament that hasn&apos;t opened registration yet. Organisers can see their drafts under{" "}
        <Link href="/organise" className="font-semibold text-navy underline">
          My tournaments
        </Link>
        .
      </p>
      <Link href="/" className="mt-6 inline-flex h-11 items-center rounded-lg bg-navy px-5 text-sm font-semibold text-white">
        All tournaments
      </Link>
    </section>
  );
}
