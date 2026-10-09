import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { ledgerEntries, type Db, type LedgerAccount } from "@force-pulse/db";

export interface LedgerLine {
  account: LedgerAccount;
  debit?: number;
  credit?: number;
  tournamentId?: string | null;
  paymentId?: string | null;
  payoutId?: string | null;
  memo?: string;
}

/**
 * Writes one balanced transaction. Checked here for a clear error, and again by the database
 * at commit (migration 0004), so an unbalanced transaction can never be stored.
 */
export async function postTransaction(tx: Db, lines: LedgerLine[]): Promise<string> {
  const entries = lines.filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0);
  const debits = entries.reduce((s, l) => s + (l.debit ?? 0), 0);
  const credits = entries.reduce((s, l) => s + (l.credit ?? 0), 0);
  if (debits !== credits) throw new Error(`Unbalanced ledger transaction: debits ${debits} ≠ credits ${credits}`);
  const transactionId = randomUUID();
  await tx.insert(ledgerEntries).values(
    entries.map((l) => ({
      transactionId,
      account: l.account,
      debitPaise: l.debit ?? 0,
      creditPaise: l.credit ?? 0,
      tournamentId: l.tournamentId ?? null,
      paymentId: l.paymentId ?? null,
      payoutId: l.payoutId ?? null,
      memo: l.memo ?? "",
    })),
  );
  return transactionId;
}

/** What Force Pulse owes the organiser of a tournament right now (credits − debits), in paise. */
export async function organiserBalance(tx: Db, tournamentId: string): Promise<number> {
  const [{ balance }] = await tx
    .select({ balance: sql<number>`coalesce(sum(${ledgerEntries.creditPaise} - ${ledgerEntries.debitPaise}), 0)::int` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.account, "organiser_payable"), eq(ledgerEntries.tournamentId, tournamentId)));
  return balance;
}
