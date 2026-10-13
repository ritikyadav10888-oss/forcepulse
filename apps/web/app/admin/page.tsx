"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { btn, btnGhost, Field, h2, input, Message, useAction } from "@/components/form";
import { useAuth } from "@/lib/auth";
import { rupees } from "@/lib/format";

interface Due {
  tournamentId: string;
  tournamentName: string;
  organiserUserId: string;
  organiserPhone: string | null;
  contactName: string;
  owedPaise: number;
  bankVerified: boolean;
  accountLast4: string | null;
}
interface Payout {
  id: string;
  tournamentId: string;
  sequence: number;
  amountPaise: number | null;
  status: string;
}
interface Finance {
  paidPayments: number;
  collectedPaise: number;
  entryFeesPaise: number;
  platformFeePaise: number;
  auctionPlanRevenuePaise: number;
  convenienceFeePaise: number;
  gatewayFeePaise: number;
  netRevenuePaise: number;
}
interface Plan {
  id: string;
  name: string;
  maxTeams: number;
  pricePaise: number | null;
}

/** Staff console (FR-ADM-01 to 05): payouts, finance, bank checks, plan prices and fees. */
export default function Admin() {
  const { user, loading, call } = useAuth();
  const router = useRouter();
  const [due, setDue] = useState<Due[]>([]);
  const [sending, setSending] = useState<Payout[]>([]);
  const [fin, setFin] = useState<Finance | null>(null);
  const [accounts, setAccounts] = useState<{ userId: string; phone: string; holderName: string; accountNumberMasked: string; ifsc: string }[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [fees, setFees] = useState<{ platformFeeBps: number; convenienceFeePaidByPlayer: boolean; gstBps: number } | null>(null);
  const { busy, error, ok, run } = useAction();
  const superAdmin = user?.platformRole === "super_admin";

  const load = useCallback(() => {
    void call<Due[]>("/admin/payouts/due").then(setDue);
    void call<Payout[]>("/admin/payouts?status=processing").then(setSending);
    void call<Finance>("/admin/finance").then(setFin);
    void call<Plan[]>("/auction-plans").then(setPlans);
    void call<typeof fees>("/admin/settings/fees").then(setFees);
    if (superAdmin) void call<typeof accounts>("/admin/payout-accounts").then(setAccounts);
  }, [call, superAdmin]);

  useEffect(() => {
    if (loading) return;
    if (!user || user.platformRole === "player") return router.replace("/login?next=/admin");
    load();
  }, [user, loading, router, load]);

  const act = (path: string, body: object = {}, done?: string) => void run(() => call(path, { method: "POST", body }), done).then(load);

  async function saveFees(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(() => call("/admin/settings/fees", { method: "PUT", body: { platformFeeBps: Math.round(Number(f.get("platform")) * 100), convenienceFeePaidByPlayer: f.get("conv") === "on", gstBps: Math.round(Number(f.get("gst")) * 100) } }), "Fees saved.");
  }

  if (!user || user.platformRole === "player") return <p className="pt-14 text-muted">Loading…</p>;
  return (
    <div className="space-y-12 pt-10">
      <h1 className="font-score text-4xl font-bold uppercase tracking-wide">Admin</h1>
      <Message error={error} ok={ok} />

      <section>
        <h2 className={h2}>Organisers waiting to be paid</h2>
        {due.length ? (
          <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
            {due.map((d) => (
              <li key={d.tournamentId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  <b>{d.tournamentName}</b> · {d.contactName || "organiser"} {d.organiserPhone}
                  <span className="block text-xs text-muted">{d.bankVerified ? `Bank verified ····${d.accountLast4}` : "Bank account not verified"}</span>
                </span>
                <span className="flex items-center gap-3">
                  <b className="font-score text-2xl tabular">{rupees(d.owedPaise)}</b>
                  {superAdmin ? (
                    <button className={btn} disabled={busy || !d.bankVerified} onClick={() => act(`/admin/tournaments/${d.tournamentId}/payouts`, {}, "Payout raised: send the transfer, then record its reference below.")}>
                      Raise payout
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">Nobody is waiting.</p>
        )}
      </section>

      {sending.length ? (
        <section>
          <h2 className={h2}>Transfers to record</h2>
          <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
            {sending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="tabular">{rupees(p.amountPaise ?? 0)} · payout {p.sequence}</span>
                <span className="flex gap-2">
                  <button className={btn} disabled={busy} onClick={() => { const reference = prompt("Bank reference (UTR)"); if (reference) act(`/admin/payouts/${p.id}/mark-paid`, { reference }, "Recorded as paid."); }}>
                    Mark paid
                  </button>
                  <button className={btnGhost} disabled={busy} onClick={() => { const reason = prompt("Why did the transfer fail?"); if (reason) act(`/admin/payouts/${p.id}/mark-failed`, { reason }); }}>
                    Failed
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {fin ? (
        <section>
          <h2 className={h2}>Money</h2>
          <dl className="mt-2 grid gap-3 sm:grid-cols-3">
            {[
              ["Entry fees", fin.entryFeesPaise],
              ["Platform fees (3%)", fin.platformFeePaise],
              ["Auction plans", fin.auctionPlanRevenuePaise],
              ["Convenience fees", fin.convenienceFeePaise],
              ["Razorpay charges", fin.gatewayFeePaise],
              ["Force Pulse net", fin.netRevenuePaise],
            ].map(([label, v]) => (
              <div key={label} className="rounded-lg bg-white p-4">
                <dt className="text-xs font-semibold text-muted">{label}</dt>
                <dd className="font-score text-3xl font-bold tabular">{rupees(Number(v))}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {superAdmin && accounts.length ? (
        <section>
          <h2 className={h2}>Bank accounts to verify</h2>
          <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
            {accounts.map((a) => (
              <li key={a.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  {a.holderName} · <span className="tabular">{a.accountNumberMasked}</span> · {a.ifsc} · {a.phone}
                </span>
                <button className={btn} disabled={busy} onClick={() => act(`/admin/payout-accounts/${a.userId}/verify`, {}, "Verified.")}>
                  Mark verified
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {superAdmin ? (
        <div className="grid gap-10 md:grid-cols-2">
          <section>
            <h2 className={h2}>Auction plan prices</h2>
            <ul className="mt-2 space-y-2">
              {plans.map((p) => (
                <li key={p.id}>
                  <form
                    className="flex items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const v = Number(new FormData(e.currentTarget).get("price"));
                      void run(() => call(`/admin/auction-plans/${p.id}`, { method: "PUT", body: { pricePaise: Math.round(v * 100) } }), `${p.name} price saved.`).then(load);
                    }}
                  >
                    <Field label={`${p.name} · ${p.maxTeams} teams (₹)`}>
                      <input name="price" type="number" min={0} defaultValue={p.pricePaise === null ? "" : p.pricePaise / 100} required className={input} />
                    </Field>
                    <button disabled={busy} className={btnGhost}>Save</button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
          {fees ? (
            <section>
              <h2 className={h2}>Fees</h2>
              <form onSubmit={saveFees} className="mt-2 space-y-3">
                <Field label="Platform fee (%)">
                  <input name="platform" type="number" step="0.01" min={0} max={20} defaultValue={fees.platformFeeBps / 100} className={input} />
                </Field>
                <Field label="GST (%)" hint="0 for now; switch on later if needed.">
                  <input name="gst" type="number" step="0.01" min={0} max={28} defaultValue={fees.gstBps / 100} className={input} />
                </Field>
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input name="conv" type="checkbox" defaultChecked={fees.convenienceFeePaidByPlayer} /> Player pays the convenience fee
                </label>
                <button disabled={busy} className={btn}>Save fees</button>
              </form>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
