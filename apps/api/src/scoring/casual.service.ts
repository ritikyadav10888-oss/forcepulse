import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { enrollments, formats, matches, players, teams, tournamentEvents, tournaments, users, type Db } from "@force-pulse/db";
import { checkRules, getScoringModule } from "@force-pulse/scoring";
import { toE164Mobile } from "@force-pulse/shared";
import { ApiError } from "../common/api-error";
import { randomCode } from "../common/codes";
import type { AuthContext } from "../common/policy";
import { CLOCK, DB, type Clock } from "../common/tokens";
import { RolesService } from "../roles/roles.service";

export interface CasualSide {
  name: string;
  players: { phone: string; name?: string }[];
}

/**
 * Casual matches (FR-SCR-05): any player sets one up with a sport, their own rules and two sides of players added by
 * mobile number. Held as a private one-match tournament, so scoring, the live board and profiles work unchanged.
 * Creating one doesn't make the player an Organiser; starting to score makes them a Scorer (FR-AUTH-04).
 */
@Injectable()
export class CasualService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly roles: RolesService,
  ) {}

  async create(auth: AuthContext, input: { sportId: string; rules: Record<string, number | string>; home: CasualSide; away: CasualSide }) {
    const module = getScoringModule(input.sportId);
    if (!module) throw new ApiError("BAD_REQUEST", "Live scoring isn't available for this sport yet.");
    const problems = checkRules(input.sportId, input.rules);
    if (problems.length) throw new ApiError("BAD_REQUEST", problems.join("; "), { problems });
    const phones = [...input.home.players, ...input.away.players].map((p) => toE164Mobile(p.phone));
    if (phones.some((p) => !p)) throw new ApiError("INVALID_PHONE", "Every player needs a valid 10-digit Indian mobile number.");
    if (new Set(phones).size !== phones.length) throw new ApiError("BAD_REQUEST", "A player can't be on both sides, or twice on one side.");

    const now = this.clock.now();
    const matchId = await this.db.transaction(async (tx) => {
      const [t] = await tx
        .insert(tournaments)
        .values({
          kind: "casual",
          organiserUserId: auth.userId,
          slug: `casual-${randomCode(10).toLowerCase()}`,
          name: `${input.home.name} vs ${input.away.name}`,
          startsAt: now,
          endsAt: new Date(now.getTime() + 24 * 3600_000),
          visibility: "private",
          status: "live",
        })
        .returning();
      const [ev] = await tx.insert(tournamentEvents).values({ tournamentId: t.id, sportId: input.sportId, entryType: "team" }).returning();
      const [f] = await tx
        .insert(formats)
        .values({
          tournamentId: t.id,
          eventId: ev.id,
          type: "league",
          rules: input.rules,
          config: { groups: 1, legs: 1, points: { win: 1, draw: 0, loss: 0 }, tieBreakers: [], qualifiersPerGroup: 1, thirdPlace: false, seeding: "random", seeds: [] },
        })
        .returning();

      const side = async (s: CasualSide) => {
        const ids = [];
        for (const p of s.players) ids.push(await this.playerFor(tx, toE164Mobile(p.phone)!, p.name?.trim() ?? ""));
        const [team] = await tx
          .insert(teams)
          .values({ tournamentId: t.id, eventId: ev.id, name: s.name.trim(), code: await this.teamCode(tx), captainPlayerId: ids[0], status: "confirmed" })
          .returning();
        await tx.insert(enrollments).values(
          ids.map((playerId, i) => ({
            registrationNo: `FPC-${randomCode(8)}`,
            tournamentId: t.id,
            eventId: ev.id,
            playerId,
            teamId: team.id,
            isCaptain: i === 0,
            status: "enrolled" as const,
            paymentStatus: "not_required" as const,
            feePaise: 0,
            registeredByUserId: auth.userId,
          })),
        );
        return team.id;
      };
      const homeId = await side(input.home);
      const awayId = await side(input.away);
      const [m] = await tx
        .insert(matches)
        .values({ tournamentId: t.id, formatId: f.id, stage: "group", groupName: "A", round: 1, matchNo: 1, homeEntrantId: homeId, awayEntrantId: awayId, scheduledAt: now, scorerUserId: auth.userId })
        .returning();
      return m.id;
    });
    return { matchId };
  }

  /** The caller's casual matches, newest first (My games). */
  async mine(auth: AuthContext) {
    return this.db
      .select({ matchId: matches.id, name: tournaments.name, sportId: tournamentEvents.sportId, status: matches.status, homeScore: matches.homeScore, awayScore: matches.awayScore, scheduledAt: matches.scheduledAt })
      .from(matches)
      .innerJoin(tournaments, eq(tournaments.id, matches.tournamentId))
      .innerJoin(formats, eq(formats.id, matches.formatId))
      .innerJoin(tournamentEvents, eq(tournamentEvents.id, formats.eventId))
      .where(and(eq(tournaments.kind, "casual"), eq(tournaments.organiserUserId, auth.userId)))
      .orderBy(desc(matches.scheduledAt))
      .limit(50);
  }

  /** Finds the player with this mobile, or makes an account for them, as OTP sign-in would (FR-REG-10). */
  private async playerFor(tx: Db, phone: string, name: string): Promise<string> {
    let [u] = await tx.select().from(users).where(eq(users.phone, phone));
    if (!u) [u] = await tx.insert(users).values({ phone, createdAt: this.clock.now() }).returning();
    let [p] = await tx.select().from(players).where(eq(players.userId, u.id));
    if (!p) {
      let code = `FP${randomCode(6)}`;
      while ((await tx.select({ id: players.id }).from(players).where(eq(players.playerCode, code))).length) code = `FP${randomCode(6)}`;
      [p] = await tx.insert(players).values({ userId: u.id, playerCode: code, name }).returning();
      await this.roles.grant(u.id, "player", "added_to_casual_match", tx);
    } else if (!p.name && name) {
      await tx.update(players).set({ name }).where(eq(players.id, p.id));
    }
    return p.id;
  }

  private async teamCode(tx: Db) {
    let code = randomCode(6);
    while ((await tx.select({ id: teams.id }).from(teams).where(eq(teams.code, code))).length) code = randomCode(6);
    return code;
  }
}
