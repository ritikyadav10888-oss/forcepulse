import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { DEFAULT_PLATFORM_FEE_BPS } from "@force-pulse/shared";
import type { Db } from "./client";
import { auctionPlans, settings, sports, userRoles, users, type FeeSettings } from "./schema";

/**
 * Sports offered at launch. The first 11 match the web app's scoring modules (src/lib/sports);
 * the last 5 are named in SRS v2 6.3 and have no scoring screen yet. Admin can switch any of them off.
 * Open item: SRS v2 says 15 sports; this list has 16 until the final list is confirmed.
 */
export const SEED_SPORTS: (typeof sports.$inferInsert)[] = [
  { id: "badminton", name: "Badminton", teamSize: 2, maxSubstitutes: 0, roles: ["Singles", "Doubles"] },
  { id: "basketball", name: "Basketball", teamSize: 5, maxSubstitutes: 7, roles: ["Point guard", "Shooting guard", "Small forward", "Power forward", "Centre"] },
  { id: "cricket", name: "Cricket", teamSize: 11, maxSubstitutes: 4, roles: ["Batsman", "Bowler", "All-rounder", "Wicket-keeper"] },
  { id: "football", name: "Football", teamSize: 11, maxSubstitutes: 5, roles: ["Goalkeeper", "Defender", "Midfielder", "Forward"] },
  { id: "hockey", name: "Hockey", teamSize: 11, maxSubstitutes: 5, roles: ["Goalkeeper", "Defender", "Midfielder", "Forward"] },
  { id: "kabaddi", name: "Kabaddi", teamSize: 7, maxSubstitutes: 5, roles: ["Raider", "Defender", "All-rounder"] },
  { id: "kho-kho", name: "Kho-kho", teamSize: 9, maxSubstitutes: 3, roles: ["Chaser", "Runner", "All-rounder"] },
  { id: "table-tennis", name: "Table tennis", teamSize: 1, maxSubstitutes: 0, roles: ["Singles", "Doubles"] },
  { id: "tennis", name: "Tennis", teamSize: 1, maxSubstitutes: 0, roles: ["Singles", "Doubles"] },
  { id: "volleyball", name: "Volleyball", teamSize: 6, maxSubstitutes: 6, roles: ["Setter", "Outside hitter", "Middle blocker", "Opposite", "Libero"] },
  { id: "wrestling", name: "Wrestling", teamSize: 1, maxSubstitutes: 0, roles: ["Freestyle", "Greco-Roman", "Pehlwani"] },
  { id: "padel", name: "Padel", teamSize: 2, maxSubstitutes: 0, roles: ["Left side", "Right side"] },
  { id: "pickleball", name: "Pickleball", teamSize: 1, maxSubstitutes: 0, roles: ["Singles", "Doubles"] },
  { id: "boxing", name: "Boxing", teamSize: 1, maxSubstitutes: 0, roles: [] },
  { id: "golf", name: "Golf", teamSize: 1, maxSubstitutes: 0, roles: [] },
  { id: "throwball", name: "Throwball", teamSize: 9, maxSubstitutes: 3, roles: [] },
].map((s) => ({ icon: s.id, accent: `var(--sport-${s.id})`, scoringModule: s.id, ...s }));

export const FEE_SETTINGS_KEY = "fees";

export const DEFAULT_FEE_SETTINGS: FeeSettings = {
  platformFeeBps: DEFAULT_PLATFORM_FEE_BPS,
  convenienceFeePaidByPlayer: true,
  gstBps: 0,
};

/** Reference data every environment needs. Safe to run again: existing rows are left as they are. */
export async function seedReferenceData(db: Db): Promise<void> {
  await db.insert(sports).values(SEED_SPORTS).onConflictDoNothing();
  await db.insert(settings).values({ key: FEE_SETTINGS_KEY, value: DEFAULT_FEE_SETTINGS }).onConflictDoNothing();
  // FR-AUC-21. Prices are still to be decided (SRS 12.3): admin sets them; until then a plan can't be bought.
  await db
    .insert(auctionPlans)
    .values([
      { id: "starter", name: "Starter", maxTeams: 4 },
      { id: "standard", name: "Standard", maxTeams: 8 },
      { id: "pro", name: "Pro", maxTeams: 16 },
      { id: "premium", name: "Premium", maxTeams: 32 },
    ])
    .onConflictDoNothing();
}

/** Creates the first super admin if no account has that email yet. Returns true when created. */
export async function ensureSuperAdmin(db: Db, email: string, password: string): Promise<boolean> {
  const normalised = email.trim().toLowerCase();
  if (!normalised || password.length < 8) throw new Error("Super admin needs an email and a password of at least 8 characters");
  const existing = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${normalised}`);
  if (existing.length) return false;
  const passwordHash = await bcrypt.hash(password, 12);
  await db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ email: normalised, passwordHash }).returning({ id: users.id });
    await tx.insert(userRoles).values([
      { userId: user.id, role: "admin", grantedByAction: "seed" },
      { userId: user.id, role: "super_admin", grantedByAction: "seed" },
    ]);
  });
  return true;
}
