import { Inject, Injectable } from "@nestjs/common";
import { asc, desc, eq } from "drizzle-orm";
import { matchEvents, matches, ruleSets, sports, tournamentEvents, tournaments, type Db } from "@force-pulse/db";
import { checkRules, getScoringModule, type ScoreEvent, type SportModule } from "@force-pulse/scoring";
import { ApiError } from "../common/api-error";
import { AuditService } from "../common/audit.service";
import { EventBus } from "../common/event-bus";
import type { AuthContext } from "../common/policy";
import { CLOCK, DB, type Clock } from "../common/tokens";
import { FixturesService } from "../fixtures/fixtures.service";
import { RealtimeGateway } from "../realtime.gateway";

type MatchRow = typeof matches.$inferSelect;

/** One scoring device per match, renewed by each sync (System Design 6.3). */
export const LEASE_SECONDS = 60;

export interface IncomingEvent {
  id: string;
  seq: number;
  action: string;
  payload: Record<string, number | string | boolean | null>;
  deviceTs?: string;
}

@Injectable()
export class ScoringService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly fixtures: FixturesService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ---------- Rule sets (FR-SCR-01 to 03) ----------

  sportRules(sportId: string) {
    const m = getScoringModule(sportId);
    if (!m) throw new ApiError("NOT_FOUND", "No scoring for this sport yet.");
    return { sportId, knobs: m.ruleKnobs ?? [], suggestions: m.sport.defaultRules };
  }

  async saveRuleSet(auth: AuthContext, input: { sportId: string; name: string; config: Record<string, number | string> }) {
    const [sport] = await this.db.select({ id: sports.id }).from(sports).where(eq(sports.id, input.sportId));
    if (!sport) throw new ApiError("BAD_REQUEST", "Unknown sport.");
    const problems = checkRules(input.sportId, input.config);
    if (problems.length) throw new ApiError("BAD_REQUEST", problems.join("; "), { problems });
    const [row] = await this.db.insert(ruleSets).values({ ...input, ownerUserId: auth.userId, createdAt: this.clock.now() }).returning();
    return row;
  }

  myRuleSets(auth: AuthContext) {
    return this.db.select().from(ruleSets).where(eq(ruleSets.ownerUserId, auth.userId)).orderBy(desc(ruleSets.createdAt));
  }

  // ---------- Live scoring ----------

  /** Kick-off: rules frozen onto the match (FR-SCR-04), this device takes the scoring lease, the caller becomes a Scorer. */
  async start(auth: AuthContext, matchId: string, deviceId: string) {
    const row = await this.db.transaction(async (tx) => {
      const { m, sportId } = await this.scoreable(tx, auth, matchId);
      if (m.status !== "scheduled") throw new ApiError("CONFLICT", "This match has already started or finished.");
      if (!m.homeEntrantId || !m.awayEntrantId) throw new ApiError("CONFLICT", "Both sides must be known before kick-off.");
      const format = await this.fixtures.format(m.formatId, tx);
      if (!format.rules) throw new ApiError("CONFLICT", "The organiser hasn't set the scoring rules for this sport yet.");
      if (!getScoringModule(sportId)) throw new ApiError("CONFLICT", "No scoring for this sport yet.");

      const squads = new Map((await this.fixtures.entrants(tx, format)).map((e) => [e.id, e.players]));
      const names = await this.fixtures.names([m.homeEntrantId, m.awayEntrantId], tx);
      const now = this.clock.now();
      const [started] = await tx
        .update(matches)
        .set({
          status: "live",
          startedAt: now,
          scorerUserId: m.scorerUserId ?? auth.userId,
          scorerDeviceId: deviceId,
          scorerLeaseUntil: new Date(now.getTime() + LEASE_SECONDS * 1000),
          ruleSnapshot: {
            ...format.rules,
            homeTeamId: m.homeEntrantId,
            awayTeamId: m.awayEntrantId,
            homeName: names.get(m.homeEntrantId) ?? "Home",
            awayName: names.get(m.awayEntrantId) ?? "Away",
            homeSquad: (squads.get(m.homeEntrantId) ?? []).join(","),
            awaySquad: (squads.get(m.awayEntrantId) ?? []).join(","),
          },
        })
        .where(eq(matches.id, m.id))
        .returning();
      return started;
    });
    await this.events.publish({ type: "MatchStartedBy", matchId, userId: auth.userId });
    return this.publish(row.id);
  }

  /**
   * Offline-friendly sync (FR-SCR-12, NFR-04): the device sends its queued events in order. Known ids are ignored,
   * so resending is safe; a gap or a clash with another device's event is refused, and the device reloads.
   */
  async sync(auth: AuthContext, matchId: string, deviceId: string, incoming: IncomingEvent[]) {
    await this.db.transaction(async (tx) => {
      const { m } = await this.scoreable(tx, auth, matchId, true);
      if (m.status !== "live") throw new ApiError("CONFLICT", "This match isn't being scored.");
      const now = this.clock.now();
      if (m.scorerDeviceId !== deviceId && m.scorerLeaseUntil && m.scorerLeaseUntil > now) {
        throw new ApiError("CONFLICT", "Another device is scoring this match. Ask the organiser to transfer it.", { reason: "lease_held" });
      }
      await tx.update(matches).set({ scorerDeviceId: deviceId, scorerLeaseUntil: new Date(now.getTime() + LEASE_SECONDS * 1000) }).where(eq(matches.id, m.id));

      const [last] = await tx.select({ seq: matchEvents.seq }).from(matchEvents).where(eq(matchEvents.matchId, m.id)).orderBy(desc(matchEvents.seq)).limit(1);
      let lastSeq = last?.seq ?? 0;
      for (const e of [...incoming].sort((a, b) => a.seq - b.seq)) {
        const [known] = await tx.select({ matchId: matchEvents.matchId }).from(matchEvents).where(eq(matchEvents.id, e.id));
        if (known) {
          if (known.matchId !== m.id) throw new ApiError("BAD_REQUEST", "Event id belongs to another match.");
          continue; // already stored: a resend after a dropped connection
        }
        if (e.seq !== lastSeq + 1) {
          throw new ApiError("CONFLICT", "The match moved on since this device last synced. Reload the events and try again.", { reason: "out_of_order", lastSeq });
        }
        await tx.insert(matchEvents).values({
          matchId: m.id,
          seq: e.seq,
          id: e.id,
          action: e.action,
          payload: e.payload,
          deviceTs: e.deviceTs ? new Date(e.deviceTs) : null,
          serverTs: now,
          userId: auth.userId,
        });
        lastSeq = e.seq;
      }
    });
    return this.publish(matchId);
  }

  /** Every event of a match, for a device that needs to catch up. */
  async eventList(auth: AuthContext, matchId: string) {
    await this.scoreable(this.db, auth, matchId);
    return this.storedEvents(matchId);
  }

  /** Public live score (FR-SCR-13): worked out from the events every time, so it is never stale. */
  async live(matchId: string) {
    const [m] = await this.db.select().from(matches).where(eq(matches.id, matchId));
    if (!m) throw new ApiError("NOT_FOUND", "No such match.");
    const sportId = await this.sportOf(this.db, m);
    const names = await this.fixtures.names([m.homeEntrantId, m.awayEntrantId]);
    const base = {
      matchId: m.id,
      sportId,
      status: m.status,
      homeName: m.homeEntrantId ? (names.get(m.homeEntrantId) ?? "") : null,
      awayName: m.awayEntrantId ? (names.get(m.awayEntrantId) ?? "") : null,
      playerOfMatchId: m.playerOfMatchId,
    };
    if (!m.ruleSnapshot) return { ...base, lastSeq: 0, phase: "setup", scores: { home: m.homeScore ?? 0, away: m.awayScore ?? 0 }, summary: null };
    const module = getScoringModule(sportId)!;
    const events = await this.storedEvents(m.id);
    const state = module.computeState(events, m.ruleSnapshot);
    return { ...base, lastSeq: events.at(-1)?.seq ?? 0, phase: state.phase, scores: state.scores, summary: module.summarise(state), winner: module.getWinner(state) };
  }

  /** Organiser hands scoring to another device (System Design 6.3). */
  async releaseLease(auth: AuthContext, matchId: string) {
    const [m] = await this.db.select().from(matches).where(eq(matches.id, matchId));
    if (!m) throw new ApiError("NOT_FOUND", "No such match.");
    const [t] = await this.db.select().from(tournaments).where(eq(tournaments.id, m.tournamentId));
    if (t.organiserUserId !== auth.userId && !auth.roles.includes("super_admin")) throw new ApiError("FORBIDDEN", "Only the organiser can transfer scoring.");
    await this.db.update(matches).set({ scorerDeviceId: null, scorerLeaseUntil: null }).where(eq(matches.id, matchId));
    await this.audit.record({ entity: "match", entityId: matchId, action: "release_scorer_device", userId: auth.userId });
  }

  /**
   * Match close (FR-SCR-14): the engine must say the match is over. The result then goes through the fixtures
   * service, so standings and the bracket update exactly as for a hand-entered result.
   */
  async close(auth: AuthContext, matchId: string, input: { playerOfMatchId?: string | null; winnerEntrantId?: string | null }) {
    const { m, module } = await this.withModule(auth, matchId);
    if (m.status !== "live") throw new ApiError("CONFLICT", "Only a match being scored can be closed.");
    const state = module.computeState(await this.storedEvents(m.id), m.ruleSnapshot!);
    if (!module.isMatchOver(state, m.ruleSnapshot!)) throw new ApiError("CONFLICT", "The match isn't over under its rules yet.");
    const squads = [...String(m.ruleSnapshot!.homeSquad ?? "").split(","), ...String(m.ruleSnapshot!.awaySquad ?? "").split(",")].filter(Boolean);
    if (input.playerOfMatchId && !squads.includes(input.playerOfMatchId)) throw new ApiError("BAD_REQUEST", "Player of the Match must be in one of the squads.");

    const w = module.getWinner(state);
    const winner = w === "home" ? m.homeEntrantId : w === "away" ? m.awayEntrantId : (input.winnerEntrantId ?? null);
    await this.fixtures.recordResult(auth, m.id, { type: "score", homeScore: state.scores.home, awayScore: state.scores.away, winnerEntrantId: winner });
    await this.db.update(matches).set({ playerOfMatchId: input.playerOfMatchId ?? null, scorerDeviceId: null, scorerLeaseUntil: null }).where(eq(matches.id, m.id));
    return this.publish(m.id);
  }

  /** Live state to everyone watching the match (FR-SCR-13), and back to the caller. */
  private async publish(matchId: string) {
    const state = await this.live(matchId);
    this.realtime.emit(`match:${matchId}`, "score.updated", state);
    return state;
  }

  // ---------- Helpers ----------

  private async storedEvents(matchId: string): Promise<ScoreEvent[]> {
    const rows = await this.db.select().from(matchEvents).where(eq(matchEvents.matchId, matchId)).orderBy(asc(matchEvents.seq));
    return rows.map((e) => ({ id: e.id, matchId: e.matchId, seq: e.seq, action: e.action, payload: e.payload, createdAt: e.serverTs.toISOString() }));
  }

  private async sportOf(tx: Db, m: MatchRow): Promise<string> {
    const format = await this.fixtures.format(m.formatId, tx);
    const [ev] = await tx.select({ sportId: tournamentEvents.sportId }).from(tournamentEvents).where(eq(tournamentEvents.id, format.eventId));
    return ev.sportId;
  }

  /** The match, if the caller is its scorer or the tournament's organiser (FR-AUTH-06). */
  private async scoreable(tx: Db, auth: AuthContext, matchId: string, lock = false): Promise<{ m: MatchRow; sportId: string }> {
    const q = tx.select().from(matches).where(eq(matches.id, matchId));
    const [m] = lock ? await q.for("update") : await q;
    if (!m) throw new ApiError("NOT_FOUND", "No such match.");
    const [t] = await tx.select({ organiserUserId: tournaments.organiserUserId }).from(tournaments).where(eq(tournaments.id, m.tournamentId));
    const allowed = m.scorerUserId === auth.userId || t.organiserUserId === auth.userId || auth.roles.includes("super_admin");
    if (!allowed) throw new ApiError("FORBIDDEN", "Only this match's scorer or the organiser can score it.");
    return { m, sportId: await this.sportOf(tx, m) };
  }

  private async withModule(auth: AuthContext, matchId: string): Promise<{ m: MatchRow; module: SportModule }> {
    const { m, sportId } = await this.scoreable(this.db, auth, matchId);
    return { m, module: getScoringModule(sportId)! };
  }
}
