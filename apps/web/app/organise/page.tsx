"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Empty } from "@/components/bits";
import { btn } from "@/components/form";
import type { Tournament } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateRange, statusLabel } from "@/lib/format";

export default function Organise() {
  const { user, loading, call } = useAuth();
  const router = useRouter();
  const [list, setList] = useState<Tournament[] | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) return router.replace("/login?next=/organise");
    void call<Tournament[]>("/me/tournaments").then(setList);
  }, [user, loading, call, router]);

  return (
    <section className="pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-score text-4xl font-bold uppercase tracking-wide">My tournaments</h1>
        <Link href="/organise/new" className={btn}>
          New tournament
        </Link>
      </div>
      {list === null ? (
        <p className="mt-6 text-muted">Loading…</p>
      ) : list.length ? (
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {list.map((t) => (
            <li key={t.id}>
              <Link href={`/organise/${t.id}`} className="flex flex-wrap items-center justify-between gap-3 py-4 hover:bg-line/40">
                <span className="font-bold">{t.name}</span>
                <span className="text-sm text-muted">
                  {dateRange(t.startsAt, t.endsAt)} · {statusLabel(t.status)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6">
          <Empty title="You haven't created a tournament yet." />
        </div>
      )}
    </section>
  );
}
