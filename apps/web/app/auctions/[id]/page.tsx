"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { AuctionLive, type AuctionState } from "@/components/auction-live";
import { AuctionSetup } from "@/components/auction-setup";
import { apiFetch, PUBLIC_API_URL, type Tournament } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function Page() {
  return (
    <Suspense>
      <Auction />
    </Suspense>
  );
}

/** One auction: setup for the auctioneer, then the live room for owners, the auctioneer, viewers and the projector. */
function Auction() {
  const { id } = useParams<{ id: string }>();
  const projector = useSearchParams().get("view") === "projector";
  const { user, call } = useAuth();
  const [state, setState] = useState<AuctionState | null>(null);
  const [organiserId, setOrganiserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const s = await (user ? call<AuctionState>(`/auctions/${id}`) : apiFetch<AuctionState>(`/auctions/${id}`, { base: PUBLIC_API_URL }));
    setState(s);
    const t = await apiFetch<Tournament>(`/tournaments/${s.tournamentId}`, { base: PUBLIC_API_URL }).catch(() => null);
    setOrganiserId(t?.organiserUserId ?? null);
  }, [call, id, user]);
  useEffect(() => void load().catch(() => setState(null)), [load]);

  if (!state) return <p className="pt-14 text-muted">Loading auction…</p>;
  const auctioneer = !!user && (user.id === organiserId || user.platformRole === "super_admin");
  if ((state.status === "locked" || state.status === "setup") && auctioneer && !projector) return <AuctionSetup state={state} reload={load} />;
  return <AuctionLive key={state.id} initial={state} auctioneer={auctioneer && !projector} projector={projector} />;
}
