"use client";

import { useEffect, useState } from "react";
import type { Tournament } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { statusLabel } from "@/lib/format";
import { btn, btnGhost, h2, Message, useAction } from "../form";

export interface TabProps {
  t: Tournament;
  reload: () => void;
}

/** What may follow each status (same order the API enforces). */
const NEXT: Record<Tournament["status"], Tournament["status"][]> = {
  draft: ["enrollment_open"],
  enrollment_open: ["enrollment_closed", "draft"],
  enrollment_closed: ["enrollment_open", "team_formation", "fixtures_published"],
  team_formation: ["fixtures_published"],
  fixtures_published: ["live"],
  live: ["completed"],
  completed: [],
};

export function OverviewTab({ t, reload }: TabProps) {
  const { call } = useAuth();
  const { busy, error, ok, run } = useAction();
  const [link, setLink] = useState<{ code: string; uses: number; active: boolean } | null>(null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const regUrl = `${origin}/register/${t.slug}${link ? `?code=${link.code}` : ""}`;

  useEffect(() => {
    if (t.inviteMode === "link") void call<{ code: string; uses: number; active: boolean }>(`/tournaments/${t.id}/invite-link`).then(setLink).catch(() => null);
  }, [call, t.id, t.inviteMode]);

  const move = (status: string) => run(() => call(`/tournaments/${t.id}/status`, { method: "PUT", body: { status } }), `Now: ${statusLabel(status)}`).then(reload);

  return (
    <div className="grid gap-10 md:grid-cols-2">
      <section>
        <h2 className={h2}>Status</h2>
        <p className="mt-2 text-2xl font-bold">{statusLabel(t.status)}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {NEXT[t.status].map((s, i) => (
            <button key={s} disabled={busy} onClick={() => void move(s)} className={i === 0 ? btn : btnGhost}>
              {s === "draft" ? "Back to draft" : statusLabel(s)}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Publish the registration form first (Form tab). Paid entries need your bank account verified (Money tab).</p>
        <div className="mt-3">
          <Message error={error} ok={ok} />
        </div>
      </section>

      <section>
        <h2 className={h2}>Registration link</h2>
        <p className="mt-2 break-all rounded-lg bg-white p-3 text-sm tabular">{regUrl}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={btnGhost} onClick={() => void navigator.clipboard.writeText(regUrl)}>
            Copy link
          </button>
          <a className={btnGhost} href={`https://wa.me/?text=${encodeURIComponent(`Register for ${t.name}: ${regUrl}`)}`} target="_blank" rel="noreferrer">
            Share on WhatsApp
          </a>
        </div>
        {link ? <p className="mt-2 text-xs text-muted">Private tournament: this link has been used {link.uses} time(s).</p> : null}
      </section>
    </div>
  );
}
