import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  enrollments,
  FEE_SETTINGS_KEY,
  paymentItems,
  payments,
  payouts,
  settings,
  tournamentEvents,
  tournaments,
  type Db,
  type FeeSettings,
} from "@force-pulse/db";
import { formatInr, splitEntryFee } from "@force-pulse/shared";
import { ApiError } from "../common/api-error";
import { AuditService } from "../common/audit.service";
import type { AuthContext } from "../common/policy";
import { CLOCK, DB, PAYMENT_GATEWAY, type Clock } from "../common/tokens";
import { RegistrationsService } from "../registrations/registrations.service";
import type { GatewayPayment, PaymentGateway } from "./gateway";
import { postTransaction } from "./ledger";

type PaymentRow = typeof payments.$inferSelect;

export type CaptureResult = "captured" | "duplicate" | "ignored";

@Injectable()
export class PaymentsService {
  private readonly log = new Logger("Payments");

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly audit: AuditService,
    private readonly registrations: RegistrationsService,
  ) {}

  /**
   * One Razorpay order for the caller's unpaid entries in one tournament (FR-PAY-04/05).
   * The order is for the entry fees; under Customer Fee Bearer, Razorpay adds the convenience fee at checkout.
   */
  async createOrder(auth: AuthContext, enrollmentIds: string[]) {
    const ids = [...new Set(enrollmentIds)];
    const rows = await this.db.select().from(enrollments).where(inArray(enrollments.id, ids));
    if (rows.length !== ids.length || rows.some((e) => e.registeredByUserId !== auth.userId)) {
      throw new ApiError("NOT_FOUND", "Some of these entries aren't yours.");
    }
    const tournamentId = rows[0].tournamentId;
    if (rows.some((e) => e.tournamentId !== tournamentId)) throw new ApiError("BAD_REQUEST", "Pay for one tournament at a time.");
    const now = this.clock.now();
    for (const e of rows) {
      if (e.status !== "payment_pending") throw new ApiError("CONFLICT", `Entry ${e.registrationNo} doesn't need payment.`);
      if (!e.holdExpiresAt || e.holdExpiresAt <= now) throw new ApiError("CONFLICT", `The 30 minutes to pay for ${e.registrationNo} are over. Register again.`);
    }

    const entryFee = rows.reduce((s, e) => s + e.feePaise, 0);
    if (entryFee <= 0) throw new ApiError("BAD_REQUEST", "Nothing to pay.");
    const fees = await this.feeSettings();
    const split = splitEntryFee(entryFee, fees.platformFeeBps);

    const paymentId = randomUUID();
    const order = await this.gateway.createOrder(entryFee, paymentId, { tournamentId, paymentId });
    await this.db.transaction(async (tx) => {
      await tx.insert(payments).values({
        id: paymentId,
        tournamentId,
        payerUserId: auth.userId,
        entryFeePaise: entryFee,
        platformFeeBps: fees.platformFeeBps,
        platformFeePaise: split.platformFee,
        organiserSharePaise: split.organiserShare,
        razorpayOrderId: order.id,
        createdAt: now,
      });
      await tx.insert(paymentItems).values(rows.map((e) => ({ paymentId, enrollmentId: e.id, feePaise: e.feePaise })));
    });
    return {
      paymentId,
      razorpayOrderId: order.id,
      keyId: this.gateway.keyId,
      currency: "INR" as const,
      entryFeePaise: entryFee,
      /** Shown on the checkout summary (FR-PAY-03); Razorpay adds the exact amount for the chosen method. */
      convenienceFeeNote: "A convenience fee for the payment method (UPI is often free) is added by Razorpay at checkout.",
      holdExpiresAt: new Date(Math.min(...rows.map((e) => e.holdExpiresAt!.getTime()))).toISOString(),
    };
  }

  /** Razorpay webhook (FR-PAY-06, NFR-05). Throws only on a bad signature or a real failure, so Razorpay retries. */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<{ result: string }> {
    if (!rawBody || !signature || !this.gateway.verifyWebhook(rawBody, signature)) {
      throw new ApiError("PAYMENT_NOT_VERIFIED", "Invalid webhook signature.");
    }
    const event = JSON.parse(rawBody.toString("utf8")) as { event: string; payload?: { payment?: { entity?: GatewayPayment } } };
    const payment = event.payload?.payment?.entity;
    if (!payment?.order_id) return { result: "ignored" };
    if (event.event === "payment.captured" || event.event === "order.paid") return { result: await this.capture(payment) };
    if (event.event === "payment.failed") return { result: await this.markFailed(payment) };
    return { result: "ignored" };
  }

  /**
   * Browser callback after Checkout. The signature alone isn't trusted (System Design 5.1): the payment
   * is fetched from Razorpay server-side, and only a captured payment counts.
   */
  async confirmFromCheckout(auth: AuthContext, input: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) {
    const [p] = await this.db.select().from(payments).where(eq(payments.razorpayOrderId, input.razorpayOrderId));
    if (!p || p.payerUserId !== auth.userId) throw new ApiError("NOT_FOUND", "No such payment.");
    if (!this.gateway.verifyCheckout(input.razorpayOrderId, input.razorpayPaymentId, input.razorpaySignature)) {
      throw new ApiError("PAYMENT_NOT_VERIFIED", "We couldn't verify this payment.");
    }
    const gp = await this.gateway.fetchPayment(input.razorpayPaymentId);
    if (gp.order_id !== p.razorpayOrderId) throw new ApiError("PAYMENT_NOT_VERIFIED", "We couldn't verify this payment.");
    if (gp.status === "captured") await this.capture(gp);
    return this.get(auth, p.id);
  }

  /** Records a captured payment once: ledger, payment row, entries (FR-PAY-08). Safe to call again with the same payment. */
  async capture(gp: GatewayPayment): Promise<CaptureResult> {
    const outcome = await this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(payments).where(eq(payments.razorpayOrderId, gp.order_id)).for("update");
      if (!p) return "ignored" as const;
      if (p.status === "paid") return "duplicate" as const;
      if (gp.status !== "captured") return "ignored" as const;
      if (gp.amount < p.entryFeePaise) {
        // Never mark Paid on an amount below the fees (NFR-05). Left for reconciliation.
        this.log.error(`Payment ${gp.id} for ${p.id}: amount ${gp.amount} below entry fee ${p.entryFeePaise}`);
        await this.audit.record({ entity: "payment", entityId: p.id, action: "amount_mismatch", after: { amount: gp.amount, expected: p.entryFeePaise }, userId: null }, tx);
        return "ignored" as const;
      }

      const now = this.clock.now();
      const gatewayFee = Math.max(0, gp.fee ?? 0);
      const convenience = gp.amount - p.entryFeePaise;
      await postTransaction(tx, [
        { account: "razorpay_clearing", debit: gp.amount, paymentId: p.id, memo: `Payment ${gp.id}` },
        { account: "organiser_payable", credit: p.organiserSharePaise, tournamentId: p.tournamentId, paymentId: p.id, memo: "Organiser share" },
        { account: "platform_fee_revenue", credit: p.platformFeePaise, paymentId: p.id, memo: "Platform fee" },
        { account: "convenience_fee_revenue", credit: convenience, paymentId: p.id, memo: "Convenience fee paid by player" },
      ]);
      if (gatewayFee > 0) {
        await postTransaction(tx, [
          { account: "gateway_fee_expense", debit: gatewayFee, paymentId: p.id, memo: "Razorpay charge" },
          { account: "razorpay_clearing", credit: gatewayFee, paymentId: p.id, memo: "Razorpay charge deducted" },
        ]);
      }
      const [paid] = await tx
        .update(payments)
        .set({ status: "paid", razorpayPaymentId: gp.id, amountPaidPaise: gp.amount, gatewayFeePaise: gatewayFee, convenienceFeePaise: convenience, method: gp.method ?? null, paidAt: now, failureReason: null })
        .where(eq(payments.id, p.id))
        .returning();

      const note = await this.confirmEntries(tx, paid);
      if (note) await tx.update(payments).set({ failureReason: note }).where(eq(payments.id, p.id));
      await this.audit.record({ entity: "payment", entityId: p.id, action: "captured", after: { razorpayPaymentId: gp.id, amount: gp.amount, fee: gatewayFee }, userId: null }, tx);
      return "captured" as const;
    });
    return outcome;
  }

  /** The player's payment didn't go through: the entries stay unpaid until their 30 minutes run out. */
  async markFailed(gp: GatewayPayment): Promise<CaptureResult> {
    const [p] = await this.db.select().from(payments).where(eq(payments.razorpayOrderId, gp.order_id));
    if (!p) return "ignored";
    if (p.status !== "created") return "duplicate";
    await this.db.update(payments).set({ status: "failed", failureReason: gp.error_description ?? "Payment failed" }).where(eq(payments.id, p.id));
    const items = await this.db.select().from(paymentItems).where(eq(paymentItems.paymentId, p.id));
    await this.db
      .update(enrollments)
      .set({ paymentStatus: "failed" })
      .where(and(inArray(enrollments.id, items.map((i) => i.enrollmentId)), eq(enrollments.status, "payment_pending")));
    return "captured";
  }

  /**
   * Paid entries move on: enrolled, or pending review with the Review add-on (System Design 4.3).
   * A payment that lands after the 30-minute hold still counts; the entry is flagged for the organiser.
   * Returns a note when an entry couldn't be confirmed (the player had already registered again): a refund case.
   */
  private async confirmEntries(tx: Db, p: PaymentRow): Promise<string | null> {
    const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, p.tournamentId));
    const items = await tx.select().from(paymentItems).where(eq(paymentItems.paymentId, p.id));
    const rows = await tx.select().from(enrollments).where(inArray(enrollments.id, items.map((i) => i.enrollmentId)));
    const problems: string[] = [];
    const now = this.clock.now();
    for (const e of rows) {
      if (e.status !== "payment_pending" && e.status !== "expired") continue;
      if (e.status === "expired") {
        const [other] = await tx
          .select({ id: enrollments.id })
          .from(enrollments)
          .where(and(eq(enrollments.eventId, e.eventId), eq(enrollments.playerId, e.playerId), inArray(enrollments.status, ["payment_pending", "pending_review", "enrolled", "waitlisted"])));
        if (other) {
          problems.push(`${e.registrationNo} was paid after its hold expired and the player had registered again: refund needed`);
          continue;
        }
      }
      const late = e.status === "expired" || !e.holdExpiresAt || e.holdExpiresAt <= now;
      await tx
        .update(enrollments)
        .set({ status: t.reviewRequired ? "pending_review" : "enrolled", paymentStatus: "paid", holdExpiresAt: null, flagged: late || e.flagged })
        .where(eq(enrollments.id, e.id));
      if (e.teamId) await this.registrations.syncTeam(tx, e.teamId);
    }
    return problems.length ? problems.join("; ") : null;
  }

  // ---------- Reading ----------

  async get(auth: AuthContext, id: string) {
    const [p] = await this.db.select().from(payments).where(eq(payments.id, id));
    if (!p || (p.payerUserId !== auth.userId && !auth.roles.includes("super_admin"))) throw new ApiError("NOT_FOUND", "No such payment.");
    const items = await this.db.select().from(paymentItems).where(eq(paymentItems.paymentId, id));
    return { ...this.view(p), enrollmentIds: items.map((i) => i.enrollmentId) };
  }

  async mine(auth: AuthContext) {
    const rows = await this.db.select().from(payments).where(eq(payments.payerUserId, auth.userId)).orderBy(desc(payments.createdAt));
    return rows.map((p) => this.view(p));
  }

  /** Printable receipt (FR-PAY-09). HTML for now; the browser's "Save as PDF" makes the PDF. */
  async receiptHtml(auth: AuthContext, id: string): Promise<string> {
    const p = await this.get(auth, id);
    if (p.status !== "paid") throw new ApiError("CONFLICT", "A receipt is available once the payment is complete.");
    const [t] = await this.db.select().from(tournaments).where(eq(tournaments.id, p.tournamentId));
    const lines = await this.db
      .select({ registrationNo: enrollments.registrationNo, sportId: tournamentEvents.sportId, fee: paymentItems.feePaise })
      .from(paymentItems)
      .innerJoin(enrollments, eq(enrollments.id, paymentItems.enrollmentId))
      .innerJoin(tournamentEvents, eq(tournamentEvents.id, enrollments.eventId))
      .where(eq(paymentItems.paymentId, id));
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const row = (a: string, b: string) => `<tr><td>${esc(a)}</td><td style="text-align:right">${esc(b)}</td></tr>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Receipt ${esc(p.razorpayPaymentId ?? p.id)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;color:#0B1220;max-width:560px;margin:32px auto;padding:0 16px}table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid #ddd}h1{font-size:20px}small{color:#5B6270}</style></head><body>
<h1>Force Pulse — Payment receipt</h1>
<p><strong>${esc(t.name)}</strong><br><small>Paid ${esc(p.paidAt ?? "")} · ${esc(p.method ?? "")} · Razorpay ${esc(p.razorpayPaymentId ?? "")}</small></p>
<table>${lines.map((l) => row(`${l.registrationNo} · ${l.sportId}`, formatInr(l.fee))).join("")}
${row("Entry fees", formatInr(p.entryFeePaise))}${row("Convenience fee", formatInr(p.convenienceFeePaise ?? 0))}${row("Total paid", formatInr(p.amountPaidPaise ?? 0))}</table>
<p><small>Questions about this entry, refunds or withdrawals: contact the organiser${t.contactName ? `, ${esc(t.contactName)}` : ""}${t.contactPhone ? ` (${esc(t.contactPhone)})` : ""}. No GST is charged.</small></p>
</body></html>`;
  }

  view(p: PaymentRow) {
    return {
      ...p,
      createdAt: p.createdAt.toISOString(),
      paidAt: p.paidAt?.toISOString() ?? null,
    };
  }

  private async feeSettings(): Promise<FeeSettings> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, FEE_SETTINGS_KEY));
    if (!row) throw new ApiError("PAYMENTS_UNAVAILABLE", "Fee settings are missing.");
    return row.value as FeeSettings;
  }

  // ---------- Organiser and admin money views (FR-PAY-12, FR-PAY-15, FR-ADM-04) ----------

  async tournamentSummary(auth: AuthContext, tournamentId: string) {
    const [t] = await this.db.select().from(tournaments).where(eq(tournaments.id, tournamentId));
    if (!t) throw new ApiError("NOT_FOUND", "No such tournament.");
    if (t.organiserUserId !== auth.userId && !auth.roles.includes("super_admin")) throw new ApiError("FORBIDDEN", "Only this tournament's organiser can see its money.");
    const [totals] = await this.db
      .select({
        payments: sql<number>`count(*)::int`,
        collectedPaise: sql<number>`coalesce(sum(${payments.entryFeePaise}), 0)::int`,
        platformFeePaise: sql<number>`coalesce(sum(${payments.platformFeePaise}), 0)::int`,
        organiserSharePaise: sql<number>`coalesce(sum(${payments.organiserSharePaise}), 0)::int`,
      })
      .from(payments)
      .where(and(eq(payments.tournamentId, tournamentId), eq(payments.status, "paid")));
    const schedule = await this.db.select().from(payouts).where(eq(payouts.tournamentId, tournamentId)).orderBy(payouts.sequence);
    const paidOut = schedule.filter((p) => p.status === "paid" || p.status === "processing").reduce((s, p) => s + (p.amountPaise ?? 0), 0);
    return {
      ...totals,
      paidOutPaise: paidOut,
      netPayablePaise: totals.organiserSharePaise - paidOut,
      payouts: schedule.map((p) => ({ ...p, createdAt: p.createdAt.toISOString(), processedAt: p.processedAt?.toISOString() ?? null })),
    };
  }

  /** Statement CSV: one line per paid payment (FR-PAY-12). */
  async statementCsv(auth: AuthContext, tournamentId: string): Promise<string> {
    await this.tournamentSummary(auth, tournamentId);
    const rows = await this.db.select().from(payments).where(and(eq(payments.tournamentId, tournamentId), eq(payments.status, "paid"))).orderBy(payments.paidAt);
    const header = "Paid at,Razorpay payment,Entry fees (Rs),Platform fee (Rs),Your share (Rs)";
    const rs = (p: number) => (p / 100).toFixed(2);
    return [header, ...rows.map((p) => [p.paidAt!.toISOString(), p.razorpayPaymentId, rs(p.entryFeePaise), rs(p.platformFeePaise), rs(p.organiserSharePaise)].join(","))].join("\r\n") + "\r\n";
  }

  async adminFinance() {
    const [t] = await this.db
      .select({
        paidPayments: sql<number>`count(*) filter (where ${payments.status} = 'paid')::int`,
        collectedPaise: sql<number>`coalesce(sum(${payments.amountPaidPaise}) filter (where ${payments.status} = 'paid'), 0)::int`,
        entryFeesPaise: sql<number>`coalesce(sum(${payments.entryFeePaise}) filter (where ${payments.status} = 'paid'), 0)::int`,
        platformFeePaise: sql<number>`coalesce(sum(${payments.platformFeePaise}) filter (where ${payments.status} = 'paid'), 0)::int`,
        convenienceFeePaise: sql<number>`coalesce(sum(${payments.convenienceFeePaise}) filter (where ${payments.status} = 'paid'), 0)::int`,
        gatewayFeePaise: sql<number>`coalesce(sum(${payments.gatewayFeePaise}) filter (where ${payments.status} = 'paid'), 0)::int`,
        needsAttention: sql<number>`count(*) filter (where ${payments.failureReason} is not null and ${payments.status} = 'paid')::int`,
      })
      .from(payments);
    const [po] = await this.db
      .select({
        processing: sql<number>`count(*) filter (where ${payouts.status} = 'processing')::int`,
        paidPaise: sql<number>`coalesce(sum(${payouts.amountPaise}) filter (where ${payouts.status} = 'paid'), 0)::int`,
        failed: sql<number>`count(*) filter (where ${payouts.status} = 'failed')::int`,
      })
      .from(payouts);
    return {
      ...t,
      /** Force Pulse net: platform fee + convenience fees − Razorpay charges. */
      netRevenuePaise: t.platformFeePaise + t.convenienceFeePaise - t.gatewayFeePaise,
      payouts: po,
    };
  }

  async adminPayments(status?: "created" | "paid" | "failed") {
    const rows = await this.db
      .select()
      .from(payments)
      .where(status ? eq(payments.status, status) : undefined)
      .orderBy(desc(payments.createdAt))
      .limit(200);
    return rows.map((p) => this.view(p));
  }
}
