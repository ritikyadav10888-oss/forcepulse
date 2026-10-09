import { jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";

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
