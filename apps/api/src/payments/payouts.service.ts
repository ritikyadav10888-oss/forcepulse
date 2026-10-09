import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ledgerEntries, payoutAccounts, payouts, tournaments, users, type Db } from "@force-pulse/db";
import { ApiError } from "../common/api-error";
import { AuditService } from "../common/audit.service";
import { CLOCK, DB, type Clock } from "../common/tokens";
import { organiserBalance, postTransaction } from "./ledger";

type PayoutRow = typeof payouts.$inferSelect;

/** The date in India (IST, UTC+5:30) as YYYY-MM-DD. */
export function indiaDate(at: Date): string {
  return new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * Organiser payouts, by hand (decision 10 Oct 2026): once a tournament is completed the organiser contacts
 * Force Pulse, staff raise a payout for whatever the ledger owes them, send the bank transfer, then record
 * its reference. A payment that lands later is simply paid in the next payout.
 */
@Injectable()
export class PayoutsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** Takes the tournament's organiser-payable balance out of the ledger and marks it as being transferred. */
  create(actorId: string, tournamentId: string): Promise<PayoutRow> {
    return this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, tournamentId)).for("update");
      if (!t) throw new ApiError("NOT_FOUND", "No such tournament.");
      if (t.status !== "completed") throw new ApiError("CONFLICT", "Pay out only after the tournament is completed.");
      const amount = await organiserBalance(tx, t.id);
      if (amount <= 0) throw new ApiError("CONFLICT", "Nothing is owed to this organiser.");
      const [account] = await tx.select().from(payoutAccounts).where(eq(payoutAccounts.userId, t.organiserUserId));
      if (!account?.verified) throw new ApiError("PAYOUT_ACCOUNT_REQUIRED", "The organiser has no verified bank account.");

      const [last] = await tx.select({ sequence: payouts.sequence }).from(payouts).where(eq(payouts.tournamentId, t.id)).orderBy(desc(payouts.sequence)).limit(1);
      const now = this.clock.now();
      const [p] = await tx
        .insert(payouts)
        // scheduledOn holds the India date the payout was raised.
        .values({ tournamentId: t.id, organiserUserId: t.organiserUserId, sequence: (last?.sequence ?? 0) + 1, scheduledOn: indiaDate(now), amountPaise: amount, status: "processing", processedAt: now })
        .returning();
      await postTransaction(tx, [
        { account: "organiser_payable", debit: amount, tournamentId: t.id, payoutId: p.id, memo: `Payout #${p.sequence}` },
        { account: "razorpay_clearing", credit: amount, payoutId: p.id, memo: `Payout #${p.sequence} to ••${account.accountLast4}` },
      ]);
      await this.audit.record({ entity: "payout", entityId: p.id, action: "create", after: { tournamentId: t.id, amount }, userId: actorId }, tx);
      return p;
    });
  }

  async markPaid(actorId: string, payoutId: string, reference: string): Promise<PayoutRow> {
    return this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(payouts).where(eq(payouts.id, payoutId)).for("update");
      if (!p) throw new ApiError("NOT_FOUND", "No such payout.");
      if (p.status !== "processing") throw new ApiError("CONFLICT", "Only a payout being processed can be marked paid.");
      const [row] = await tx.update(payouts).set({ status: "paid", reference }).where(eq(payouts.id, p.id)).returning();
      await this.audit.record({ entity: "payout", entityId: p.id, action: "mark_paid", after: { reference }, userId: actorId }, tx);
      return row;
    });
  }

  /** The bank transfer failed: the amount goes back to the organiser's balance, ready for a new payout. */
  async markFailed(actorId: string, payoutId: string, reason: string): Promise<PayoutRow> {
    return this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(payouts).where(eq(payouts.id, payoutId)).for("update");
      if (!p) throw new ApiError("NOT_FOUND", "No such payout.");
      if (p.status !== "processing") throw new ApiError("CONFLICT", "Only a payout being processed can fail.");
      await postTransaction(tx, [
        { account: "razorpay_clearing", debit: p.amountPaise!, payoutId: p.id, memo: `Payout #${p.sequence} returned` },
        { account: "organiser_payable", credit: p.amountPaise!, tournamentId: p.tournamentId, payoutId: p.id, memo: `Payout #${p.sequence} returned` },
      ]);
      const [row] = await tx.update(payouts).set({ status: "failed", failureReason: reason }).where(eq(payouts.id, p.id)).returning();
      await this.audit.record({ entity: "payout", entityId: p.id, action: "mark_failed", reason, userId: actorId }, tx);
      return row;
    });
  }

  /** Dashboard alert: completed tournaments whose organiser is still owed money, largest first. */
  due() {
    const owed = sql<number>`sum(${ledgerEntries.creditPaise} - ${ledgerEntries.debitPaise})::int`;
    return this.db
      .select({
        tournamentId: tournaments.id,
        tournamentName: tournaments.name,
        tournamentUpdatedAt: tournaments.updatedAt,
        organiserUserId: tournaments.organiserUserId,
        organiserPhone: users.phone,
        contactName: tournaments.contactName,
        owedPaise: owed,
        bankVerified: sql<boolean>`coalesce(${payoutAccounts.verified}, false)`,
        accountLast4: payoutAccounts.accountLast4,
      })
      .from(ledgerEntries)
      .innerJoin(tournaments, eq(tournaments.id, ledgerEntries.tournamentId))
      .innerJoin(users, eq(users.id, tournaments.organiserUserId))
      .leftJoin(payoutAccounts, eq(payoutAccounts.userId, tournaments.organiserUserId))
      .where(and(eq(ledgerEntries.account, "organiser_payable"), eq(tournaments.status, "completed")))
      .groupBy(tournaments.id, users.phone, payoutAccounts.verified, payoutAccounts.accountLast4)
      .having(sql`${owed} > 0`)
      .orderBy(desc(owed));
  }

  list(statuses?: PayoutRow["status"][]) {
    return this.db
      .select()
      .from(payouts)
      .where(statuses?.length ? inArray(payouts.status, statuses) : undefined)
      .orderBy(desc(payouts.createdAt))
      .limit(200);
  }
}
