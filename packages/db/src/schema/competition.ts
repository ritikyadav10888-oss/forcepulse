import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

export const competition = pgSchema("competition");

/** Sports catalogue, managed by admin (FR-ADM-01). Ids match the web app's sport modules. */
export const sports = competition.table("sports", {
  id: text("id").primaryKey(), // "badminton", "kho-kho" …
  name: text("name").notNull().unique(),
  icon: text("icon").notNull().default(""),
  accent: text("accent").notNull().default(""),
  teamSize: integer("team_size").notNull().default(1),
  maxSubstitutes: integer("max_substitutes").notNull().default(0),
  roles: jsonb("roles").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** Optional suggestions only; never applied unless the organiser picks them (FR-SCR-02). */
  suggestedRules: jsonb("suggested_rules").$type<Record<string, number | string>>().notNull().default(sql`'{}'::jsonb`),
  /** Which scoring screen the web app opens, e.g. "cricket". */
  scoringModule: text("scoring_module").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
