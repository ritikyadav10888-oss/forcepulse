"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { sportName } from "@/lib/format";
import { btn, h2, Message, useAction } from "../form";
import type { TabProps } from "./overview";

/** One auction per sport whose teams are formed by auction (FR-AUC-01). */
export function AuctionsTab({ t }: TabProps) {
  const { call } = useAuth();
  const [list, setList] = useState<{ id: string; eventId: string; status: string }[]>([]);
  const { busy, error, run } = useAction();
  const load = useCallback(() => void call<typeof list>(`/tournaments/${t.id}/auctions`).then(setList), [call, t.id]);
  useEffect(load, [load]);
  const pooled = t.events.filter((e) => e.entryType === "pooled");

  if (!pooled.length) return <p className="text-muted">Auctions are for sports where players register alone and teams are formed by auction. None of this tournament&apos;s sports is set up that way.</p>;
  return (
    <ul className="space-y-3">
      {pooled.map((ev) => {
        const a = list.find((x) => x.eventId === ev.id);
        return (
          <li key={ev.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-4">
            <span>
              <b>{sportName(ev.sportId)}</b>
              <span className={`${h2} ml-2`}>{a ? a.status : "no auction yet"}</span>
            </span>
            {a ? (
              <Link href={`/auctions/${a.id}`} className={btn}>
                Open auction
              </Link>
            ) : (
              <button disabled={busy} className={btn} onClick={() => void run(() => call(`/tournaments/${t.id}/auctions`, { method: "POST", body: { eventId: ev.id } })).then(load)}>
                Create auction
              </button>
            )}
          </li>
        );
      })}
      <Message error={error} />
    </ul>
  );
}
