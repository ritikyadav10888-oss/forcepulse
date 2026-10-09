import { sql } from "drizzle-orm";
import { boolean, index, integer, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Role } from "@force-pulse/shared";

export const identity = pgSchema("identity");

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = identity.table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** E.164, one account per mobile (SRS 2.5). Null only for staff created by email. */
  phone: text("phone").unique(),
  email: text("email").unique(),
  /** Staff only (bcrypt). Players sign in with OTP. */
  passwordHash: text("password_hash"),
  status: text("status").$type<"active" | "suspended">().notNull().default("active"),
  createdAt: createdAt(),
});

/** One row per role (System Design 4.1). PK makes grants idempotent. */
export const userRoles = identity.table(
  "user_roles",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<Role>().notNull(),
    /** What granted it: "signup", "tournament_created", "scorer_assigned", "match_started", "staff:<userId>" … */
    grantedByAction: text("granted_by_action").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    suspended: boolean("suspended").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const otpChallenges = identity.table(
  "otp_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: text("phone").notNull(),
    /** HMAC-SHA256 of the code with OTP_SECRET; the code itself is never stored. */
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("otp_challenges_phone_created").on(t.phone, t.createdAt), index("otp_challenges_ip_created").on(t.ip, t.createdAt)],
);

/** Refresh-token sessions. Revoking a row signs that device out on its next call. */
export const sessions = identity.table(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the refresh token. */
    refreshHash: text("refresh_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user").on(t.userId).where(sql`${t.revokedAt} is null`)],
);
