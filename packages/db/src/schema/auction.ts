import { sql } from "drizzle-orm";
import { bigserial, boolean, index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { players } from "./people";
import { categories, enrollments, teams, tournamentEvents, tournaments } from "./competition";

export const auction = pgSchema("auction");

/** Plans differ only by team count (FR-AUC-21/22). Price null = not on sale yet (set by admin, FR-AUC-23). */
export const auctionPlans = auction.table("plans", {
  id: text("id").primaryKey(), // starter, standard, pro, premium
  name: text("name").notNull(),
  maxTeams: integer("max_teams").notNull(),
  pricePaise: integer("price_paise"),
});

export type AuctionStatus = "locked" | "setup" | "live" | "paused" | "completed";
/** Raise applied while the current bid is at or above `from` (FR-AUC-06). */
export interface BidSlab {
  from: number;
  raise: number;
}

/** Points-only auction for one sport (or category) of a tournament (FR-AUC-01 to 07). No real money. */
export const auctions = auction.table(
  "auctions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().references(() => tournamentEvents.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    status: text("status").$type<AuctionStatus>().notNull().default("locked"),
    planId: text("plan_id").references(() => auctionPlans.id),
    maxTeams: integer("max_teams").notNull().default(0),
    purse: integer("purse").notNull().default(0),
    minSquad: integer("min_squad").notNull().default(1),
    maxSquad: integer("max_squad").notNull().default(1),
    timerSeconds: integer("timer_seconds").notNull().default(30),
    lotOrder: text("lot_order").$type<"category" | "random" | "manual">().notNull().default("category"),
    slabs: jsonb("slabs").$type<BidSlab[]>().notNull().default(sql`'[]'::jsonb`),
    round: integer("round").notNull().default(1),
    /** The lot on the block and its live bid (System Design 7.2). */
    currentLotId: uuid("current_lot_id"),
    currentBid: integer("current_bid"),
    leadingTeamId: uuid("leading_team_id"),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    /** Paused: what was left on the clock. */
    pausedRemainingMs: integer("paused_remaining_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("auctions_event_category").on(t.eventId, sql`coalesce(${t.categoryId}, '00000000-0000-0000-0000-000000000000'::uuid)`)],
);

/** Player grades with a base price in points and an optional per-team quota (FR-AUC-04). */
export const auctionCategories = auction.table("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  auctionId: uuid("auction_id").notNull().references(() => auctions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  basePoints: integer("base_points").notNull(),
  quotaPerTeam: integer("quota_per_team"),
  position: integer("position").notNull().default(0),
});

export const auctionTeams = auction.table("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  auctionId: uuid("auction_id").notNull().references(() => auctions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  logoUrl: text("logo_url").notNull().default(""),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  /** The tournament team made for it when the auction closes (FR-AUC-19). */
  competitionTeamId: uuid("competition_team_id").references(() => teams.id),
});

export type LotStatus = "upcoming" | "live" | "sold" | "unsold";

/** One pool player in one auction (uniqueness per auction, not per tournament: System Design 7.4). */
export const auctionLots = auction.table(
  "lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    auctionId: uuid("auction_id").notNull().references(() => auctions.id, { onDelete: "cascade" }),
    playerId: uuid("player_id").notNull().references(() => players.id),
    enrollmentId: uuid("enrollment_id").notNull().references(() => enrollments.id),
    categoryId: uuid("category_id").notNull().references(() => auctionCategories.id),
    status: text("status").$type<LotStatus>().notNull().default("upcoming"),
    round: integer("round").notNull().default(1),
    soldTeamId: uuid("sold_team_id").references(() => auctionTeams.id),
    soldPoints: integer("sold_points"),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("lots_auction_player").on(t.auctionId, t.playerId)],
);

export const bids = auction.table(
  "bids",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    lotId: uuid("lot_id").notNull().references(() => auctionLots.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull().references(() => auctionTeams.id),
    points: integer("points").notNull(),
    round: integer("round").notNull(),
    byUserId: uuid("by_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Entered by the auctioneer for a team in the room (FR-AUC-16). */
    floor: boolean("floor").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bids_lot").on(t.lotId, t.id)],
);
