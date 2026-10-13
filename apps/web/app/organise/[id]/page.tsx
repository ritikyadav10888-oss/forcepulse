"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AuctionsTab } from "@/components/organise/auctions";
import { EntriesTab } from "@/components/organise/entries";
import { FixturesTab } from "@/components/organise/fixtures";
import { FormTab } from "@/components/organise/form-builder";
import { GalleryTab } from "@/components/organise/gallery";
import { MoneyTab } from "@/components/organise/money";
import { OverviewTab } from "@/components/organise/overview";
import type { Tournament } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateRange, statusLabel } from "@/lib/format";

const TABS = ["Overview", "Form", "Entries", "Fixtures", "Gallery", "Money", "Auction"] as const;
type Tab = (typeof TABS)[number];

/** The organiser's console for one tournament (SRS 10.1, Organiser screens). */
export default function TournamentConsole() {
  const { id } = useParams<{ id: string }>();
  const { user, loading, call } = useAuth();
  const router = useRouter();
  const [t, setT] = useState<Tournament | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");

  const reload = useCallback(() => void call<Tournament>(`/tournaments/${id}`).then(setT), [call, id]);
  useEffect(() => {
    if (loading) return;
    if (!user) return router.replace(`/login?next=/organise/${id}`);
    reload();
  }, [user, loading, router, id, reload]);

  if (!t) return <p className="pt-14 text-muted">Loading…</p>;
  const props = { t, reload };
  return (
    <div className="pt-8">
      <p className="text-sm font-semibold text-muted">
        {dateRange(t.startsAt, t.endsAt)} · {statusLabel(t.status)}
      </p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-score text-4xl font-bold uppercase tracking-wide">{t.name}</h1>
        {t.status === "draft" ? (
          <span className="text-sm text-muted">Draft: the public page appears when registration opens</span>
        ) : (
          <Link href={`/t/${t.slug}`} className="text-sm font-semibold text-navy underline">
            Public page
          </Link>
        )}
      </div>

      <div role="tablist" className="mt-6 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((x) => (
          <button
            key={x}
            role="tab"
            aria-selected={tab === x}
            onClick={() => setTab(x)}
            className={`h-11 shrink-0 border-b-4 px-3 text-sm font-semibold ${tab === x ? "border-navy" : "border-transparent text-muted hover:text-ink"}`}
          >
            {x}
          </button>
        ))}
      </div>

      <div className="pt-6">
        {tab === "Overview" && <OverviewTab {...props} />}
        {tab === "Form" && <FormTab {...props} />}
        {tab === "Entries" && <EntriesTab {...props} />}
        {tab === "Fixtures" && <FixturesTab {...props} />}
        {tab === "Gallery" && <GalleryTab {...props} />}
        {tab === "Money" && <MoneyTab {...props} />}
        {tab === "Auction" && <AuctionsTab {...props} />}
      </div>
    </div>
  );
}
