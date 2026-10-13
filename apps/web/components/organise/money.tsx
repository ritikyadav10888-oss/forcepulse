"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { download } from "@/lib/download";
import { rupees } from "@/lib/format";
import { btn, btnGhost, Field, h2, input, Message, useAction } from "../form";
import type { TabProps } from "./overview";

interface Finance {
  payments: number;
  collectedPaise: number;
  platformFeePaise: number;
  organiserSharePaise: number;
  paidOutPaise: number;
  netPayablePaise: number;
  payouts: { id: string; sequence: number; amountPaise: number | null; status: string; reference: string | null }[];
}
interface Account {
  holderName: string;
  accountNumberMasked: string;
  ifsc: string;
  verified: boolean;
}

/** Collections and payouts (FR-PAY-11, FR-PAY-12). Payouts are sent by Force Pulse staff after the tournament. */
export function MoneyTab({ t }: TabProps) {
  const { call, token } = useAuth();
  const [fin, setFin] = useState<Finance | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const { busy, error, ok, run } = useAction();
  useEffect(() => {
    void call<Finance>(`/tournaments/${t.id}/finance`).then(setFin);
    void call<Account | null>("/payout-accounts/me").then(setAccount).catch(() => null);
  }, [call, t.id]);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const a = await run(
      () => call<Account>("/payout-accounts/me", { method: "PUT", body: { holderName: f.get("holderName"), accountNumber: f.get("accountNumber"), ifsc: String(f.get("ifsc")).toUpperCase() } }),
      "Saved. Force Pulse will verify it before paid registration can open.",
    );
    if (a) setAccount(a);
  }

  const stat = (label: string, paise: number) => (
    <div className="rounded-lg bg-white p-4">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="font-score text-3xl font-bold tabular">{rupees(paise)}</p>
    </div>
  );

  return (
    <div className="grid gap-10 md:grid-cols-[1fr_20rem]">
      <section className="space-y-4">
        <h2 className={h2}>Collections</h2>
        {fin ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {stat("Entry fees collected", fin.collectedPaise)}
              {stat("Your 97% share", fin.organiserSharePaise)}
              {stat("Still to be paid to you", fin.netPayablePaise)}
            </div>
            <p className="text-sm text-muted">
              {fin.payments} payment(s). Platform fee {rupees(fin.platformFeePaise)}. Paid out so far {rupees(fin.paidOutPaise)}. When the tournament is completed, contact Force Pulse to receive your payout.
            </p>
            {fin.payouts.length ? (
              <ul className="divide-y divide-line border-y border-line text-sm">
                {fin.payouts.map((p) => (
                  <li key={p.id} className="flex justify-between py-2">
                    <span>Payout {p.sequence} · {p.status}{p.reference ? ` · ref ${p.reference}` : ""}</span>
                    <span className="tabular font-semibold">{rupees(p.amountPaise ?? 0)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <button className={btnGhost} onClick={() => void run(() => download(`/tournaments/${t.id}/statement.csv`, token(), `${t.slug}-statement.csv`))}>
              Download statement
            </button>
          </>
        ) : null}
      </section>

      <section>
        <h2 className={h2}>Bank account for payouts</h2>
        {account ? (
          <p className="mt-2 rounded-lg bg-white p-3 text-sm">
            {account.holderName} · <span className="tabular">{account.accountNumberMasked}</span> · {account.ifsc}
            <span className="mt-1 block font-semibold">{account.verified ? "Verified" : "Waiting for verification"}</span>
          </p>
        ) : null}
        <form onSubmit={save} className="mt-4 space-y-3">
          <Field label="Account holder">
            <input name="holderName" required className={input} />
          </Field>
          <Field label="Account number">
            <input name="accountNumber" inputMode="numeric" required className={input} />
          </Field>
          <Field label="IFSC">
            <input name="ifsc" required className={`${input} uppercase`} />
          </Field>
          <Message error={error} ok={ok} />
          <button disabled={busy} className={btn}>
            {account ? "Replace account" : "Save account"}
          </button>
        </form>
      </section>
    </div>
  );
}
