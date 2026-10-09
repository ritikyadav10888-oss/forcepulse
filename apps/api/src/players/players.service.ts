import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { players, playerSports, sports, type Db } from "@force-pulse/db";
import { ApiError } from "../common/api-error";
import { AuditService } from "../common/audit.service";
import type { AuthContext } from "../common/policy";
import { CLOCK, DB, type Clock } from "../common/tokens";

type PlayerRow = typeof players.$inferSelect;

/** The web app's PlayerProfile. `dob` and `pincode` are null on public views (FR-PRO-07). */
export interface PlayerView {
  id: string;
  userId: string;
  playerCode: string;
  name: string;
  photoUrl: string;
  gender: "male" | "female" | null;
  dob: string | null;
  age: number | null;
  pincode: string | null;
  city: string;
  state: string;
  suspended: boolean;
  managedByUserId: string | null;
}

export interface ProfilePatch {
  name?: string;
  photoUrl?: string;
  gender?: "male" | "female" | null;
  dob?: string | null;
  pincode?: string | null;
  city?: string;
  state?: string;
}

@Injectable()
export class PlayersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async mine(userId: string): Promise<PlayerView> {
    return this.view(await this.rowForUser(userId), true);
  }

  /** Public profile; the player themself and staff also get date of birth and pincode. */
  async byId(id: string, viewer?: AuthContext): Promise<PlayerView> {
    const [row] = await this.db.select().from(players).where(eq(players.id, id));
    if (!row) throw new ApiError("NOT_FOUND", "No such player.");
    const privateView = !!viewer && (row.userId === viewer.userId || viewer.roles.some((r) => r === "admin" || r === "super_admin"));
    return this.view(row, privateView);
  }

  /** Players edit basic details only; stats and history are read-only (FR-PRO-06). */
  async updateMine(userId: string, patch: ProfilePatch): Promise<PlayerView> {
    const row = await this.rowForUser(userId);
    if (patch.dob) this.checkDob(patch.dob);
    const [updated] = await this.db.update(players).set(patch).where(eq(players.id, row.id)).returning();
    return this.view(updated, true);
  }

  async sportsOf(playerId: string) {
    return this.db
      .select({ playerId: playerSports.playerId, sportId: playerSports.sportId, playingRole: playerSports.playingRole, skillLevel: playerSports.skillLevel })
      .from(playerSports)
      .where(eq(playerSports.playerId, playerId));
  }

  async saveMySport(userId: string, sportId: string, playingRole: string, skillLevel: string) {
    const row = await this.rowForUser(userId);
    const [sport] = await this.db.select().from(sports).where(and(eq(sports.id, sportId), eq(sports.active, true)));
    if (!sport) throw new ApiError("NOT_FOUND", "No such sport.");
    if (sport.roles.length && playingRole && !sport.roles.includes(playingRole)) {
      throw new ApiError("BAD_REQUEST", `Playing role must be one of: ${sport.roles.join(", ")}.`);
    }
    const value = { playerId: row.id, sportId, playingRole, skillLevel };
    await this.db.insert(playerSports).values(value).onConflictDoUpdate({ target: [playerSports.playerId, playerSports.sportId], set: { playingRole, skillLevel } });
    return value;
  }

  async removeMySport(userId: string, sportId: string): Promise<void> {
    const row = await this.rowForUser(userId);
    await this.db.delete(playerSports).where(and(eq(playerSports.playerId, row.id), eq(playerSports.sportId, sportId)));
  }

  /** Super admin suspends or restores a player (FR-ADM-02, web app rule 12). */
  async setSuspended(actorId: string, playerId: string, suspended: boolean, reason: string | null): Promise<PlayerView> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.update(players).set({ suspended }).where(eq(players.id, playerId)).returning();
      if (!row) throw new ApiError("NOT_FOUND", "No such player.");
      await this.audit.record(
        { entity: "player", entityId: playerId, action: suspended ? "suspend" : "restore", before: { suspended: !suspended }, after: { suspended }, reason, userId: actorId },
        tx,
      );
      return this.view(row, true);
    });
  }

  private async rowForUser(userId: string): Promise<PlayerRow> {
    const [row] = await this.db.select().from(players).where(eq(players.userId, userId));
    if (!row) throw new ApiError("NOT_FOUND", "This account has no player profile.");
    return row;
  }

  private checkDob(dob: string) {
    const age = ageOn(dob, this.clock.now());
    if (age === null || age < 3 || age > 100) throw new ApiError("BAD_REQUEST", "dob: enter a real date of birth.");
  }

  private view(row: PlayerRow, privateView: boolean): PlayerView {
    return {
      id: row.id,
      userId: row.userId ?? "",
      playerCode: row.playerCode,
      name: row.name,
      photoUrl: row.photoUrl,
      gender: row.gender,
      dob: privateView ? row.dob : null,
      age: row.dob ? ageOn(row.dob, this.clock.now()) : null,
      pincode: privateView ? row.pincode : null,
      city: row.city,
      state: row.state,
      suspended: row.suspended,
      managedByUserId: row.managedByUserId,
    };
  }
}

/** Completed years on a date. Null for an unreadable date. */
export function ageOn(dob: string, on: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = on.getUTCFullYear() - y;
  if (on.getUTCMonth() + 1 < mo || (on.getUTCMonth() + 1 === mo && on.getUTCDate() < d)) age--;
  return age;
}
