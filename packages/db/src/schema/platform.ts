import { bigserial, boolean, index, integer, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
  /** photo, media: shown publicly · proof / file: owner, staff and the organiser of a tournament it was submitted to. */
  kind: text("kind").$type<"photo" | "proof" | "file" | "media">().notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** About, FAQ, terms, privacy and refund pages, edited by staff (FR-ABT-01/02). Body is simple markdown. */
export const cmsPages = platform.table("cms_pages", {
  slug: text("slug").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
});

/** Messages from the contact form (FR-ABT-01). */
export const contactMessages = platform.table("contact_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  contact: text("contact").notNull(),
  message: text("message").notNull(),
  handled: boolean("handled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** DPDP Act 2023 requests (NFR-10). Deletion anonymises the account; payment records are kept as the law requires. */
export const privacyRequests = platform.table("privacy_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  kind: text("kind").$type<"deletion">().notNull(),
  reason: text("reason").notNull().default(""),
  status: text("status").$type<"pending" | "done" | "declined">().notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});
