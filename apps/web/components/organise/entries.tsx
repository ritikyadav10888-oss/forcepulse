"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { download } from "@/lib/download";
import { sportName } from "@/lib/format";
import { btnGhost, h2, Message, useAction } from "../form";
import type { TabProps } from "./overview";

export interface EntryRow {
  id: string;
  eventId: string;
  registrationNo: string;
  status: string;
  paymentStatus: string;
  flagged: boolean;
  registeredByUserId: string;
  player: { playerName: string; playerCode: string; phone: string | null; teamName: string | null };
}

const SHOW = ["", "pending_review", "payment_pending", "enrolled", "waitlisted", "rejected", "removed", "expired"];

/** Entries (FR-REG-12, FR-REG-17): review add-on actions, removal, CSV export. */
export function EntriesTab({ t }: TabProps) {
  const { call, token } = useAuth();
  const [rows, setRows] = useState<EntryRow[]>([]);
  const [status, setStatus] = useState("");
  const { busy, error, ok, run } = useAction();
  const load = useCallback(() => void call<EntryRow[]>(`/tournaments/${t.id}/enrollments${status ? `?status=${status}` : ""}`).then(setRows), [call, t.id, status]);
  useEffect(load, [load]);

  const review = (id: string, action: "approve" | "reject" | "waitlist") => {
    const reason = action === "reject" ? prompt("Reason for rejecting (shown to the player)") : undefined;
    if (action === "reject" && !reason) return;
    void run(() => call(`/enrollments/${id}/review`, { method: "POST", body: { action, ...(reason ? { reason } : {}) } })).then(load);
  };
  const remove = (id: string) => void run(() => call(`/enrollments/${id}/remove`, { method: "POST", body: {} })).then(load);
  const sport = (eventId: string) => sportName(t.events.find((e) => e.id === eventId)?.sportId ?? "");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className={h2}>{rows.length} entries</h2>
        <div className="flex gap-2">
          <select aria-label="Filter" value={status} onChange={(e) => setStatus(e.target.value)} className="h-11 rounded-lg border border-line bg-white px-3 text-sm">
            {SHOW.map((s) => (
              <option key={s} value={s}>
                {s ? s.replace(/_/g, " ") : "All"}
              </option>
            ))}
          </select>
          <button className={btnGhost} onClick={() => void run(() => download(`/tournaments/${t.id}/enrollments.csv`, token(), `${t.slug}-entries.csv`))}>
            Export CSV
          </button>
        </div>
      </div>
      <Message error={error} ok={ok} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b-2 border-ink text-left text-xs uppercase tracking-wider text-muted">
              <th className="py-2">Entry</th>
              <th>Player</th>
              <th>Sport</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line">
                <td className="py-2 tabular">{r.registrationNo}{r.flagged ? " ⚑" : ""}</td>
                <td>
                  <b>{r.player.playerName || "—"}</b>
                  <span className="block text-xs text-muted">
                    {r.player.playerCode} · {r.player.phone}
                    {r.player.teamName ? ` · ${r.player.teamName}` : ""}
                  </span>
                </td>
                <td>{sport(r.eventId)}</td>
                <td>{r.status.replace(/_/g, " ")}</td>
                <td className="whitespace-nowrap text-right">
                  {r.status === "pending_review" || r.status === "waitlisted" ? (
                    <>
                      <button disabled={busy} onClick={() => review(r.id, "approve")} className="mr-2 font-semibold text-navy underline">Approve</button>
                      {r.status === "pending_review" ? <button disabled={busy} onClick={() => review(r.id, "waitlist")} className="mr-2 font-semibold text-navy underline">Waitlist</button> : null}
                      <button disabled={busy} onClick={() => review(r.id, "reject")} className="mr-2 font-semibold text-bad underline">Reject</button>
                    </>
                  ) : null}
                  {["enrolled", "pending_review", "waitlisted", "payment_pending"].includes(r.status) ? (
                    <button disabled={busy} onClick={() => remove(r.id)} className="font-semibold text-muted underline">Remove</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
