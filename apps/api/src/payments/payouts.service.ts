import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { payoutAccounts, payouts, tournaments, type Db } from "@force-pulse/db";
import { ApiError } from "../common/api-error";
import { AuditService } from "../common/audit.service";
import { EventBus } from "../common/event-bus";
import { CLOCK, DB, type Clock } from "../common/tokens";
import { organiserBalance, postTransaction } from "./ledger";

type PayoutRow = typeof payouts.$inferSelect;

/** The date in India (IST, UTC+5:30) as YYYY-MM-DD. Payouts are due by India date. */
export function indiaDate(at: Date, plusDays = 0): string {
  return new Date(at.getTime() + 330 * 60_000 + plusDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Organiser payouts (FR-PAY-10, System Design 5.3). Scheduled at registration close + 2 days; the amount is
 * the tournament's organiser-payable ledger balance on the day it runs. Sending is by hand for now
 * (admin records the bank reference) until Razorpay Route or RazorpayX is chosen.
 */
@Injectable()
export class PayoutsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  onModuleInit() {
    this.events.on("RegistrationClosed", (e) => this.schedule(this.db, e.tournamentId, indiaDate(new Date(e.closedAt), 2)).then(() => undefined));
  }

  /** Adds a scheduled payout unless one is already waiting. */
  async schedule(tx: Db, tournamentId: string, scheduledOn: string): Promise<void> {
    const existing = await tx.select().from(payouts).where(eq(payouts.tournamentId, tournamentId)).orderBy(desc(payouts.sequence));
    if (existing.some((p) => p.status === "scheduled")) return;
    const [t] = await tx.select({ organiserUserId: tournaments.organiserUserId }).from(tournaments).where(eq(tournaments.id, tournamentId));
    await tx.insert(payouts).values({ tournamentId, organiserUserId: t.organiserUserId, sequence: (existing[0]?.sequence ?? 0) + 1, scheduledOn });
  }

  /** A payment landing after a payout already went out is paid in a top-up the next day (System Design 5.3). */
  async topUpIfAlreadyPaidOut(tx: Db, tournamentId: string): Promise<void> {
    const rows = await tx.select({ status: payouts.status }).from(payouts).where(eq(payouts.tournamentId, tournamentId));
    if (rows.some((p) => p.status === "processing" || p.status === "paid")) await this.schedule(tx, tournamentId, indiaDate(this.clock.now(), 1));
  }

  /** Daily run (10:00 IST in production): every payout due today or earlier. */
  async runDue(actorId: string | null): Promise<PayoutRow[]> {
    const today = indiaDate(this.clock.now());
    const due = await this.db.select().from(payouts).where(and(eq(payouts.status, "scheduled"), lte(payouts.scheduledOn, today))).orderBy(asc(payouts.scheduledOn));
    const done: PayoutRow[] = [];
    for (const p of due) done.push(await this.process(p.id, actorId));
    return done;
  }

  private process(payoutId: string, actorId: string | null): Promise<PayoutRow> {
    return this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(payouts).where(eq(payouts.id, payoutId)).for("update");
      if (p.status !== "scheduled") return p;
      const now = this.clock.now();
      const amount = await organiserBalance(tx, p.tournamentId);
      if (amount <= 0) {
        const [row] = await tx.update(payouts).set({ status: "skipped", amountPaise: 0, processedAt: now }).where(eq(payouts.id, p.id)).returning();
        return row;
      }
      const [account] = await tx.select().from(payoutAccounts).where(eq(payoutAccounts.userId, p.organiserUserId));
      if (!account?.verified) {
        const [row] = await tx
          .update(payouts)
          .set({ status: "failed", amountPaise: amount, failureReason: "Organiser has no verified bank account", processedAt: now })
          .where(eq(payouts.id, p.id))
          .returning();
        return row;
      }
      // The money leaves the organiser's balance now; if the transfer fails it is put back (markFailed).
      await postTransaction(tx, [
        { account: "organiser_payable", debit: amount, tournamentId: p.tournamentId, payoutId: p.id, memo: `Payout #${p.sequence}` },
        { account: "razorpay_clearing", credit: amount, payoutId: p.id, memo: `Payout #${p.sequence} to ••${account.accountLast4}` },
      ]);
      const [row] = await tx.update(payouts).set({ status: "processing", amountPaise: amount, processedAt: now }).where(eq(payouts.id, p.id)).returning();
      await this.audit.record({ entity: "payout", entityId: p.id, action: "process", after: { amount }, userId: actorId }, tx);
      return row;
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

  /** The bank transfer failed: the amount goes back to the organiser's balance, and a new payout is scheduled for tomorrow. */
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
      await this.schedule(tx, p.tournamentId, indiaDate(this.clock.now(), 1));
      return row;
    });
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
