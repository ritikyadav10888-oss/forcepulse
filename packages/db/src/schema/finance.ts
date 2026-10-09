import { bigserial, boolean, date, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { enrollments, tournaments } from "./competition";

export const finance = pgSchema("finance");

/** Fee settings changed by super admin (FR-ADM-03). Rates are frozen onto each payment when it is made. */
export interface FeeSettings {
  /** Force Pulse's share of the entry fee, in basis points. 300 = 3%. */
  platformFeeBps: number;
  /** Razorpay's charge is added on top and paid by the player (Customer Fee Bearer). */
  convenienceFeePaidByPlayer: boolean;
  /** 0 for now (FR-PAY-17). */
  gstBps: number;
}

export const settings = finance.table("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PaymentStatus = "created" | "paid" | "failed";

/** One Razorpay order covering one or more entries (FR-PAY-05). Amounts in paise. */
export const payments = finance.table(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id),
    /** registration: entry fees (3% / 97%). auction_plan: a plan bought by the organiser, all Force Pulse revenue (FR-PAY-16). */
    purpose: text("purpose").$type<"registration" | "auction_plan">().notNull().default("registration"),
    auctionId: uuid("auction_id"),
    planId: text("plan_id"),
    payerUserId: uuid("payer_user_id").notNull().references(() => users.id),
    /** Sum of the entry fees (what the organiser set). */
    entryFeePaise: integer("entry_fee_paise").notNull(),
    /** Frozen at order time (System Design 5.2). */
    platformFeeBps: integer("platform_fee_bps").notNull(),
    platformFeePaise: integer("platform_fee_paise").notNull(),
    organiserSharePaise: integer("organiser_share_paise").notNull(),
    /** Filled from Razorpay when captured: total the player paid, Razorpay's charge, and the convenience fee (paid − entry fee). */
    amountPaidPaise: integer("amount_paid_paise"),
    gatewayFeePaise: integer("gateway_fee_paise"),
    convenienceFeePaise: integer("convenience_fee_paise"),
    status: text("status").$type<PaymentStatus>().notNull().default("created"),
    razorpayOrderId: text("razorpay_order_id").notNull().unique(),
    razorpayPaymentId: text("razorpay_payment_id").unique(),
    method: text("method"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => [index("payments_tournament_status").on(t.tournamentId, t.status), index("payments_payer").on(t.payerUserId)],
);

/** Which entries a payment pays for. */
export const paymentItems = finance.table(
  "payment_items",
  {
    paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
    enrollmentId: uuid("enrollment_id").notNull().references(() => enrollments.id),
    feePaise: integer("fee_paise").notNull(),
  },
  (t) => [primaryKey({ columns: [t.paymentId, t.enrollmentId] })],
);

export const LEDGER_ACCOUNTS = [
  "razorpay_clearing",
  "organiser_payable",
  "platform_fee_revenue",
  "convenience_fee_revenue",
  "gateway_fee_expense",
  "auction_plan_revenue",
] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

/**
 * Append-only double-entry ledger (System Design 5). Every transaction_id balances
 * (debits = credits), checked by the database at commit. Balances are always summed from here.
 */
export const ledgerEntries = finance.table(
  "ledger_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    transactionId: uuid("transaction_id").notNull(),
    account: text("account").$type<LedgerAccount>().notNull(),
    /** Set for organiser_payable, so each tournament's balance can be summed. */
    tournamentId: uuid("tournament_id").references(() => tournaments.id),
    paymentId: uuid("payment_id").references(() => payments.id),
    payoutId: uuid("payout_id"),
    debitPaise: integer("debit_paise").notNull().default(0),
    creditPaise: integer("credit_paise").notNull().default(0),
    memo: text("memo").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ledger_transaction").on(t.transactionId), index("ledger_account_tournament").on(t.account, t.tournamentId)],
);

/** Organiser bank details for payouts (FR-PAY-11). The account number is stored encrypted; only the last 4 digits are kept in clear. */
export const payoutAccounts = finance.table("payout_accounts", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  holderName: text("holder_name").notNull(),
  /** AES-256-GCM: iv.tag.ciphertext, base64url. */
  accountNumberEnc: text("account_number_enc").notNull(),
  accountLast4: text("account_last4").notNull(),
  ifsc: text("ifsc").notNull(),
  verified: boolean("verified").notNull().default(false),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PayoutStatus = "scheduled" | "processing" | "paid" | "failed" | "skipped";

/** Organiser payout, scheduled at registration close + 2 days (FR-PAY-10). A late payment adds a top-up (next sequence). */
export const payouts = finance.table(
  "payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id),
    organiserUserId: uuid("organiser_user_id").notNull().references(() => users.id),
    sequence: integer("sequence").notNull(),
    /** India date (YYYY-MM-DD) it becomes due. */
    scheduledOn: date("scheduled_on").notNull(),
    /** Filled when it runs: the organiser-payable balance at that moment. */
    amountPaise: integer("amount_paise"),
    status: text("status").$type<PayoutStatus>().notNull().default("scheduled"),
    /** Razorpay payout / transfer id, or a bank reference when sent by hand. */
    reference: text("reference"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("payouts_tournament_sequence").on(t.tournamentId, t.sequence), index("payouts_due").on(t.scheduledOn, t.status)],
);
