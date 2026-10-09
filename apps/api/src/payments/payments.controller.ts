import { Body, Controller, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, type RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { Authenticated, CurrentAuth, Public, RequireRole, type AuthContext } from "../common/policy";
import { parse } from "../common/validate";
import { PaymentsService } from "./payments.service";
import { PayoutAccountsService } from "./payout-accounts.service";
import { PayoutsService } from "./payouts.service";

const OrderInput = z.object({ enrollmentIds: z.array(z.uuid()).min(1).max(20) }).strict();
const CheckoutInput = z
  .object({ razorpayOrderId: z.string().min(1).max(60), razorpayPaymentId: z.string().min(1).max(60), razorpaySignature: z.string().min(1).max(200) })
  .strict();
const PayoutAccountInput = z
  .object({
    holderName: z.string().trim().min(2).max(100),
    accountNumber: z.string().regex(/^\d{9,18}$/, "Account number: 9 to 18 digits"),
    ifsc: z.string().trim().regex(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, "IFSC: 11 characters, like HDFC0001234"),
  })
  .strict();
const Reference = z.object({ reference: z.string().trim().min(3).max(100) }).strict();
const Reason = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const PaymentsQuery = z.object({ status: z.enum(["created", "paid", "failed"]).optional() });
const PayoutsQuery = z.object({ status: z.enum(["scheduled", "processing", "paid", "failed", "skipped"]).optional() });

@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly payouts: PayoutsService,
    private readonly accounts: PayoutAccountsService,
  ) {}

  // ---------- Player ----------

  @Post("payments/orders")
  @Authenticated()
  createOrder(@Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.payments.createOrder(auth, parse(OrderInput, body).enrollmentIds);
  }

  /** Razorpay calls this; only the signature over the raw body is trusted (FR-PAY-06). */
  @Post("payments/webhook")
  @HttpCode(200)
  @Public()
  webhook(@Req() req: RawBodyRequest<Request>, @Headers("x-razorpay-signature") signature?: string) {
    return this.payments.handleWebhook(req.rawBody, signature);
  }

  @Post("payments/confirm")
  @HttpCode(200)
  @Authenticated()
  confirm(@Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.payments.confirmFromCheckout(auth, parse(CheckoutInput, body));
  }

  @Get("me/payments")
  @Authenticated()
  mine(@CurrentAuth() auth: AuthContext) {
    return this.payments.mine(auth);
  }

  @Get("payments/:id")
  @Authenticated()
  get(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.payments.get(auth, id);
  }

  @Get("payments/:id/receipt")
  @Authenticated()
  @Header("Content-Type", "text/html; charset=utf-8")
  receipt(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.payments.receiptHtml(auth, id);
  }

  // ---------- Organiser ----------

  @Get("payout-accounts/me")
  @Authenticated()
  myAccount(@CurrentAuth() auth: AuthContext) {
    return this.accounts.mine(auth.userId);
  }

  @Put("payout-accounts/me")
  @Authenticated()
  saveAccount(@Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.accounts.save(auth.userId, parse(PayoutAccountInput, body));
  }

  @Get("tournaments/:id/finance")
  @Authenticated()
  finance(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.payments.tournamentSummary(auth, id);
  }

  @Get("tournaments/:id/statement.csv")
  @Authenticated()
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="statement.csv"')
  statement(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.payments.statementCsv(auth, id);
  }

  // ---------- Admin (FR-PAY-15, FR-ADM-04) ----------

  @Get("admin/finance")
  @RequireRole("admin")
  adminFinance() {
    return this.payments.adminFinance();
  }

  @Get("admin/payments")
  @RequireRole("admin")
  adminPayments(@Query() q: unknown) {
    return this.payments.adminPayments(parse(PaymentsQuery, q).status);
  }

  @Post("admin/payout-accounts/:userId/verify")
  @HttpCode(200)
  @RequireRole("super_admin")
  verifyAccount(@Param("userId", ParseUUIDPipe) userId: string, @CurrentAuth() auth: AuthContext) {
    return this.accounts.setVerified(auth.userId, userId);
  }

  /** Organisers waiting to be paid: completed tournaments with money still owed (dashboard alert). */
  @Get("admin/payouts/due")
  @RequireRole("admin")
  payoutsDue() {
    return this.payouts.due();
  }

  @Get("admin/payouts")
  @RequireRole("admin")
  adminPayouts(@Query() q: unknown) {
    const { status } = parse(PayoutsQuery, q);
    return this.payouts.list(status ? [status] : undefined);
  }

  /** After a completed tournament's organiser asks to be paid: takes what they are owed and marks it for transfer. */
  @Post("admin/tournaments/:id/payouts")
  @RequireRole("super_admin")
  createPayout(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.payouts.create(auth.userId, id);
  }

  @Post("admin/payouts/:id/mark-paid")
  @HttpCode(200)
  @RequireRole("super_admin")
  markPaid(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.payouts.markPaid(auth.userId, id, parse(Reference, body).reference);
  }

  @Post("admin/payouts/:id/mark-failed")
  @HttpCode(200)
  @RequireRole("super_admin")
  markFailed(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.payouts.markFailed(auth.userId, id, parse(Reason, body).reason);
  }
}
