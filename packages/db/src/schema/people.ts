import { boolean, date, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { sports } from "./competition";

export const people = pgSchema("people");

/** The master player record (SRS 9): everything else links to players.id. */
export const players = people.table("players", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Null for a managed player (a child or squad member registered by a parent or coach). */
  userId: uuid("user_id").unique().references(() => users.id, { onDelete: "set null" }),
  managedByUserId: uuid("managed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  /** Short public id shown on the profile and QR code, e.g. "FP7K3M9Q". */
  playerCode: text("player_code").notNull().unique(),
  name: text("name").notNull().default(""),
  photoUrl: text("photo_url").notNull().default(""),
  gender: text("gender").$type<"male" | "female">(),
  /** Private: never sent on public profiles (FR-PRO-07). */
  dob: date("dob"),
  pincode: text("pincode"),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  suspended: boolean("suspended").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** A player's role and level in one sport (web app: PlayerSportProfile). */
export const playerSports = people.table(
  "player_sports",
  {
    playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    sportId: text("sport_id").notNull().references(() => sports.id),
    playingRole: text("playing_role").notNull().default(""),
    skillLevel: text("skill_level").notNull().default(""),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.sportId] })],
);
