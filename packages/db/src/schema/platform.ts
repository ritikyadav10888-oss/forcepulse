import { bigserial, index, integer, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";

export const platform = pgSchema("platform");

/** Append-only (NFR-11): score edits, auction undo, payments, payouts and admin changes. */
export const auditLogs = platform.table(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entity: text("entity").notNull(), // "user_role", "fee_settings" …
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(), // "suspend", "restore", "grant", "update" …
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_entity").on(t.entity, t.entityId), index("audit_logs_at").on(t.at)],
);

/** Files people upload (photos, age proofs, documents). The bytes live in storage; this row says who may see them. */
export const uploads = platform.table("uploads", {
  key: text("key").primaryKey(), // "upl_…"
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  /** photo: shown publicly · proof / file: owner, staff and the organiser of a tournament it was submitted to. */
  kind: text("kind").$type<"photo" | "proof" | "file">().notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
