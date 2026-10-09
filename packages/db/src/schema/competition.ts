import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { Answers, CategoryGender, FieldDef, FieldRule } from "@force-pulse/shared";
import { users } from "./identity";
import { players } from "./people";

export const competition = pgSchema("competition");

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

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
  createdAt: createdAt(),
});

export const TOURNAMENT_STATUSES = ["draft", "enrollment_open", "enrollment_closed", "team_formation", "fixtures_published", "live", "completed"] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];

/** FR-TRN-01. Web app: Tournament. */
export const tournaments = competition.table(
  "tournaments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organiserUserId: uuid("organiser_user_id").notNull().references(() => users.id),
    /** Registration link: /t/<slug> (FR-TRN-02). */
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    bannerUrl: text("banner_url").notNull().default(""),
    logoUrl: text("logo_url").notNull().default(""),
    venue: text("venue").notNull().default(""),
    city: text("city").notNull().default(""),
    mapUrl: text("map_url").notNull().default(""),
    prizes: text("prizes").notNull().default(""),
    rulesText: text("rules_text").notNull().default(""),
    contactName: text("contact_name").notNull().default(""),
    contactPhone: text("contact_phone").notNull().default(""),
    refundPolicy: text("refund_policy").notNull().default(""),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    registrationDeadline: timestamp("registration_deadline", { withTimezone: true }),
    status: text("status").$type<TournamentStatus>().notNull().default("draft"),
    visibility: text("visibility").$type<"public" | "private">().notNull().default("public"),
    /** Private tournaments only: invite list of phones, or a shareable link. */
    inviteMode: text("invite_mode").$type<"list" | "link">(),
    /** Review add-on (FR-REG-12): entries wait for the organiser to approve, reject or waitlist. */
    reviewRequired: boolean("review_required").notNull().default(false),
    /** The form being edited. Players see only published versions. */
    formDraft: jsonb("form_draft").$type<FieldDef[]>().notNull().default(sql`'[]'::jsonb`),
    /** Latest published form version; 0 = no form (core profile only). */
    formVersion: integer("form_version").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tournaments_organiser").on(t.organiserUserId), index("tournaments_listing").on(t.visibility, t.status, t.startsAt)],
);

/** Published form versions, frozen (System Design 4.2): an entry keeps the version it was made with. */
export const formVersions = competition.table(
  "form_versions",
  {
    tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    fields: jsonb("fields").$type<FieldDef[]>().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.version] })],
);

export type EntryType = "team" | "pooled" | "individual";

/** One sport inside a tournament. Web app: TournamentEvent. */
export const tournamentEvents = competition.table(
  "tournament_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    sportId: text("sport_id").notNull().references(() => sports.id),
    /** team: a captain registers a team · pooled: players alone, teams formed later · individual: no teams. */
    entryType: text("entry_type").$type<EntryType>().notNull(),
    poolFormation: text("pool_formation").$type<"auction" | "organizer_assigns">(),
    /** Organiser's rule set; nothing is applied by default (FR-SCR-01). */
    rules: jsonb("rules").$type<Record<string, number | string>>().notNull().default(sql`'{}'::jsonb`),
    /** Teams, or entries for individual sports. Null = no limit. Applies per category when categories exist. */
    maxTeams: integer("max_teams"),
    minPlayersPerTeam: integer("min_players_per_team"),
    maxPlayersPerTeam: integer("max_players_per_team"),
    /** Per team for team entry, otherwise per player. 0 = free. */
    feePaise: integer("fee_paise").notNull().default(0),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("tournament_events_sport").on(t.tournamentId, t.sportId)],
);

/** Eligibility group inside one sport, e.g. "U12 Boys". Web app: TournamentCategory. */
export const categories = competition.table(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull().references(() => tournamentEvents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    minAge: integer("min_age"),
    underAge: integer("under_age"),
    ageOn: date("age_on"),
    gender: text("gender").$type<CategoryGender>().notNull().default("any"),
    allowPlayingUp: boolean("allow_playing_up").notNull().default(false),
    proofRequired: boolean("proof_required").notNull().default(false),
    /** Overrides the event's maxTeams. */
    maxTeams: integer("max_teams"),
    /** Overrides the event's fee. */
    feePaise: integer("fee_paise"),
    fieldRules: jsonb("field_rules").$type<FieldRule[]>().notNull().default(sql`'[]'::jsonb`),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("categories_event_name").on(t.eventId, sql`lower(${t.name})`)],
);

/** Phones allowed into a private tournament with inviteMode "list". */
export const tournamentInvites = competition.table(
  "tournament_invites",
  {
    tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(),
    name: text("name").notNull().default(""),
    addedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.phone] })],
);

/** Shareable link for a private tournament with inviteMode "link". */
export const inviteLinks = competition.table("invite_links", {
  tournamentId: uuid("tournament_id").primaryKey().references(() => tournaments.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
});

export type TeamStatus = "pending" | "confirmed" | "cancelled";

/** A registered team (FR-REG-07). Team-mates join with `code`. */
export const teams = competition.table(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().references(() => tournamentEvents.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id),
    name: text("name").notNull(),
    code: text("code").notNull().unique(),
    captainPlayerId: uuid("captain_player_id").notNull().references(() => players.id),
    color: text("color").notNull().default(""),
    /** pending until the captain's entry is confirmed (paid, or approved with the Review add-on). */
    status: text("status").$type<TeamStatus>().notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("teams_event_name").on(t.eventId, sql`lower(${t.name})`).where(sql`${t.status} <> 'cancelled'`)],
);

export const ENROLLMENT_STATUSES = ["payment_pending", "pending_review", "enrolled", "waitlisted", "rejected", "removed", "expired"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
/** Entries that hold a place (count towards limits). payment_pending only while its hold hasn't expired. */
export const SPOT_HOLDING: EnrollmentStatus[] = ["payment_pending", "pending_review", "enrolled"];
/** Entries that block a new entry by the same player in the same sport. */
export const ACTIVE_ENROLLMENT: EnrollmentStatus[] = ["payment_pending", "pending_review", "enrolled", "waitlisted"];

export interface GuardianConsent {
  name: string;
  phone: string;
  consentAt: string;
}

/** One player's entry into one sport of a tournament. Web app: Enrollment. */
export const enrollments = competition.table(
  "enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Short id printed on confirmations (FR-REG-16), e.g. "FPR-7K3M9Q2A". */
    registrationNo: text("registration_no").notNull().unique(),
    tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().references(() => tournamentEvents.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id),
    playerId: uuid("player_id").notNull().references(() => players.id),
    teamId: uuid("team_id").references(() => teams.id),
    isCaptain: boolean("is_captain").notNull().default(false),
    joinedVia: text("joined_via").$type<"form" | "team_code" | "auction" | "organiser">().notNull().default("form"),
    status: text("status").$type<EnrollmentStatus>().notNull(),
    paymentStatus: text("payment_status").$type<"not_required" | "pending" | "paid" | "failed">().notNull(),
    /** Fee frozen at registration (paise). */
    feePaise: integer("fee_paise").notNull().default(0),
    /** payment_pending only: the place is released after this (FR-PAY-07). */
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    /** The user who submitted: the player, or a parent or coach. */
    registeredByUserId: uuid("registered_by_user_id").references(() => users.id, { onDelete: "set null" }),
    guardian: jsonb("guardian").$type<GuardianConsent | null>(),
    answers: jsonb("answers").$type<Answers>().notNull().default(sql`'{}'::jsonb`),
    formVersion: integer("form_version").notNull().default(0),
    proofKey: text("proof_key"),
    flagged: boolean("flagged").notNull().default(false),
    /** Reason given with a Review add-on rejection. */
    reviewNote: text("review_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One live entry per player per sport; removed / rejected / expired entries don't block a new one.
    uniqueIndex("enrollments_one_active")
      .on(t.eventId, t.playerId)
      .where(sql`${t.status} in ('payment_pending', 'pending_review', 'enrolled', 'waitlisted')`),
    index("enrollments_tournament_status").on(t.tournamentId, t.status),
    index("enrollments_player").on(t.playerId),
    index("enrollments_team").on(t.teamId),
  ],
);

export type FormatType = "league" | "knockout" | "league_knockout";
export type TieBreaker = "points" | "score_diff" | "scored" | "wins" | "head_to_head";

/** How one sport (or one category of it) is played (FR-TRN-04 to 07). */
export interface FormatConfig {
  /** League: groups and round robin. */
  groups: number;
  /** 1 = single round robin, 2 = double. */
  legs: 1 | 2;
  points: { win: number; draw: number; loss: number };
  tieBreakers: TieBreaker[];
  /** League + knockout: how many from each group go through. */
  qualifiersPerGroup: number;
  thirdPlace: boolean;
  /** random, or manual using `seeds` (entrant ids, best first). */
  seeding: "random" | "manual";
  seeds: string[];
}

export const formats = competition.table(
  "formats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().references(() => tournamentEvents.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "cascade" }),
    type: text("type").$type<FormatType>().notNull(),
    config: jsonb("config").$type<FormatConfig>().notNull(),
  },
  (t) => [uniqueIndex("formats_event_category").on(t.eventId, sql`coalesce(${t.categoryId}, '00000000-0000-0000-0000-000000000000'::uuid)`)],
);

export type MatchStatus = "scheduled" | "live" | "completed" | "walkover" | "forfeit" | "abandoned" | "cancelled";

/**
 * A fixture (FR-TRN-08 to 12). Entrants are teams for team sports and entries (enrollments) for individual ones.
 * Knockout matches name where their entrants come from: the winner of a match, or a group place ("A1").
 */
export const matches = competition.table(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    formatId: uuid("format_id").notNull().references(() => formats.id, { onDelete: "cascade" }),
    stage: text("stage").$type<"group" | "knockout">().notNull(),
    /** "A", "B" … for group matches. */
    groupName: text("group_name"),
    round: integer("round").notNull(),
    /** Order within the stage, 1-based; for knockout it is the bracket position in the round. */
    matchNo: integer("match_no").notNull(),
    homeEntrantId: uuid("home_entrant_id"),
    awayEntrantId: uuid("away_entrant_id"),
    /** Knockout placeholders until filled: "A1", "W:<matchNo>" (winner), "L:<matchNo>" (loser, third place). */
    homeSource: text("home_source"),
    awaySource: text("away_source"),
    court: text("court"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    scorerUserId: uuid("scorer_user_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status").$type<MatchStatus>().notNull().default("scheduled"),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    winnerEntrantId: uuid("winner_entrant_id"),
    resultNote: text("result_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("matches_tournament").on(t.tournamentId, t.scheduledAt), index("matches_format").on(t.formatId, t.stage, t.round)],
);
