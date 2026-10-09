import { randomInt } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import {
  categories,
  enrollments,
  formats,
  matches,
  players,
  teams,
  tournamentEvents,
  tournaments,
  users,
  type Db,
  type FormatConfig,
  type FormatType,
} from "@force-pulse/db";
import { checkRules } from "@force-pulse/scoring";
import { ApiError } from "../common/api-error";
import { AuditService } from "../common/audit.service";
import { EventBus } from "../common/event-bus";
import type { AuthContext } from "../common/policy";
import { DB } from "../common/tokens";
import { TournamentsService } from "../tournaments/tournaments.service";
import { planFormat, schedule, standings, type Busy, type ScheduleOptions, type Side } from "./plan";

type MatchRow = typeof matches.$inferSelect;
type FormatRow = typeof formats.$inferSelect;

const DONE = ["completed", "walkover", "forfeit"] as const;
/** Tournament states in which fixtures can be (re)generated: registration closed, play not started. */
const CAN_GENERATE = ["enrollment_closed", "team_formation", "fixtures_published"];

export type ResultInput =
  | { type: "score"; homeScore: number; awayScore: number; winnerEntrantId?: string | null }
  | { type: "walkover" | "forfeit"; winnerEntrantId: string; reason: string }
  | { type: "abandoned"; reason: string };

@Injectable()
export class FixturesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tournaments: TournamentsService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  // ---------- Format and generation ----------

  /** Sets how a sport (or one category of it) is played. Replaces fixtures that haven't started. */
  async setFormat(auth: AuthContext, eventId: string, input: { categoryId: string | null; type: FormatType; config: FormatConfig; rules?: Record<string, number | string> | null }) {
    const [event] = await this.db.select().from(tournamentEvents).where(eq(tournamentEvents.id, eventId));
    if (!event) throw new ApiError("NOT_FOUND", "No such sport in a tournament.");
    await this.tournaments.manageable(auth, event.tournamentId);
    if (input.rules) {
      const problems = checkRules(event.sportId, input.rules);
      if (problems.length) throw new ApiError("BAD_REQUEST", problems.join("; "), { problems });
    }
    if (input.categoryId) {
      const [c] = await this.db.select().from(categories).where(and(eq(categories.id, input.categoryId), eq(categories.eventId, eventId)));
      if (!c) throw new ApiError("BAD_REQUEST", "That category isn't part of this sport.");
    }
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(formats)
        .where(and(eq(formats.eventId, eventId), input.categoryId ? eq(formats.categoryId, input.categoryId) : isNull(formats.categoryId)));
      if (existing) {
        await this.assertNotStarted(tx, existing.id);
        await tx.delete(matches).where(eq(matches.formatId, existing.id));
        const [row] = await tx.update(formats).set({ type: input.type, config: input.config, rules: input.rules ?? existing.rules }).where(eq(formats.id, existing.id)).returning();
        return row;
      }
      const [row] = await tx.insert(formats).values({ tournamentId: event.tournamentId, eventId, categoryId: input.categoryId, type: input.type, config: input.config, rules: input.rules ?? null }).returning();
      return row;
    });
  }

  /** FR-TRN-08: fixtures from the confirmed entrants, scheduled on the organiser's courts without clashes. */
  async generate(auth: AuthContext, formatId: string, opts: ScheduleOptions) {
    const format = await this.format(formatId);
    const t = await this.tournaments.manageable(auth, format.tournamentId);
    if (!CAN_GENERATE.includes(t.status)) throw new ApiError("CONFLICT", "Close registration before generating fixtures.");

    await this.db.transaction(async (tx) => {
      await this.assertNotStarted(tx, format.id);
      const entrants = await this.entrants(tx, format);
      if (entrants.length < 2) throw new ApiError("CONFLICT", "At least two confirmed entries are needed.");
      const seeded = this.seed(entrants.map((e) => e.id), format.config);

      let plan;
      let slots;
      try {
        plan = planFormat(format.type, seeded, format.config);
        const playersById = new Map(entrants.map((e) => [e.id, e.players]));
        const playersOf = (s: Side) => (s && "entrantId" in s ? (playersById.get(s.entrantId) ?? []) : []);
        slots = schedule(plan, playersOf, opts, await this.busyElsewhere(tx, format));
      } catch (err) {
        throw new ApiError("BAD_REQUEST", err instanceof Error ? err.message : "Couldn't build fixtures.");
      }

      await tx.delete(matches).where(eq(matches.formatId, format.id));
      await tx.insert(matches).values(
        plan.map((m, i) => ({
          tournamentId: format.tournamentId,
          formatId: format.id,
          stage: m.stage,
          groupName: m.groupName,
          round: m.round,
          matchNo: m.matchNo,
          homeEntrantId: m.home && "entrantId" in m.home ? m.home.entrantId : null,
          awayEntrantId: m.away && "entrantId" in m.away ? m.away.entrantId : null,
          homeSource: m.home && "source" in m.home ? m.home.source : null,
          awaySource: m.away && "source" in m.away ? m.away.source : null,
          court: slots[i].court,
          scheduledAt: slots[i].scheduledAt,
        })),
      );
      await this.audit.record({ entity: "format", entityId: format.id, action: "generate_fixtures", after: { matches: plan.length }, userId: auth.userId }, tx);
    });
    return this.list(format.tournamentId, auth, format.id);
  }

  // ---------- Reading (public pages, FR-TRN-13) ----------

  async list(tournamentId: string, viewer?: AuthContext, formatId?: string) {
    await this.tournaments.get(tournamentId, viewer); // hides drafts from the public
    const rows = await this.db
      .select()
      .from(matches)
      .where(and(eq(matches.tournamentId, tournamentId), formatId ? eq(matches.formatId, formatId) : undefined))
      .orderBy(asc(matches.scheduledAt), asc(matches.court));
    const names = await this.names(rows.flatMap((m) => [m.homeEntrantId, m.awayEntrantId]));
    return rows.map((m) => this.view(m, names));
  }

  /** Points tables per group, worked out from results each time (FR-TRN-11). */
  async standings(tournamentId: string, viewer?: AuthContext) {
    await this.tournaments.get(tournamentId, viewer);
    const fs = await this.db.select().from(formats).where(and(eq(formats.tournamentId, tournamentId), ne(formats.type, "knockout")));
    const out = [];
    for (const f of fs) {
      const groupMatches = await this.db.select().from(matches).where(and(eq(matches.formatId, f.id), eq(matches.stage, "group")));
      const names = await this.names(groupMatches.flatMap((m) => [m.homeEntrantId, m.awayEntrantId]));
      for (const g of [...new Set(groupMatches.map((m) => m.groupName!))].sort()) {
        const rows = this.groupTable(groupMatches.filter((m) => m.groupName === g), f.config);
        out.push({ formatId: f.id, eventId: f.eventId, categoryId: f.categoryId, group: g, rows: rows.map((r, i) => ({ position: i + 1, name: names.get(r.entrantId) ?? "", ...r })) });
      }
    }
    return out;
  }

  // ---------- Organiser edits (FR-TRN-09, FR-TRN-10) ----------

  async update(auth: AuthContext, matchId: string, patch: { scheduledAt?: string; court?: string; scorerUserId?: string | null; homeEntrantId?: string; awayEntrantId?: string }) {
    const m = await this.match(matchId);
    await this.tournaments.manageable(auth, m.tournamentId);
    if (m.status !== "scheduled") throw new ApiError("CONFLICT", "Only a match that hasn't started can be changed.");

    if (patch.homeEntrantId || patch.awayEntrantId) {
      const allowed = new Set((await this.entrants(this.db, await this.format(m.formatId))).map((e) => e.id));
      for (const id of [patch.homeEntrantId, patch.awayEntrantId]) if (id && !allowed.has(id)) throw new ApiError("BAD_REQUEST", "That entrant isn't in this sport or category.");
    }
    if (patch.scorerUserId) {
      const [u] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, patch.scorerUserId));
      if (!u) throw new ApiError("BAD_REQUEST", "No such scorer account.");
    }
    const [row] = await this.db
      .update(matches)
      .set({
        ...(patch.scheduledAt ? { scheduledAt: new Date(patch.scheduledAt) } : {}),
        ...(patch.court !== undefined ? { court: patch.court } : {}),
        ...(patch.scorerUserId !== undefined ? { scorerUserId: patch.scorerUserId } : {}),
        ...(patch.homeEntrantId ? { homeEntrantId: patch.homeEntrantId } : {}),
        ...(patch.awayEntrantId ? { awayEntrantId: patch.awayEntrantId } : {}),
      })
      .where(eq(matches.id, matchId))
      .returning();
    if (patch.scorerUserId) await this.events.publish({ type: "ScorerAssigned", matchId, scorerUserId: patch.scorerUserId });
    const names = await this.names([row.homeEntrantId, row.awayEntrantId]);
    return { match: this.view(row, names), warnings: await this.clashes(row) };
  }

  async cancel(auth: AuthContext, matchId: string, reason: string) {
    const m = await this.match(matchId);
    await this.tournaments.manageable(auth, m.tournamentId);
    if (m.status !== "scheduled") throw new ApiError("CONFLICT", "Only a match that hasn't started can be cancelled.");
    const [row] = await this.db.update(matches).set({ status: "cancelled", resultNote: reason }).where(eq(matches.id, matchId)).returning();
    await this.audit.record({ entity: "match", entityId: matchId, action: "cancel", reason, userId: auth.userId });
    return this.view(row, await this.names([row.homeEntrantId, row.awayEntrantId]));
  }

  /**
   * Result entered by the organiser or the match's scorer (FR-TRN-12; the live scoring app arrives later).
   * Winners and losers move on in the bracket; when the group stage is over, group places fill the knockout.
   */
  async recordResult(auth: AuthContext, matchId: string, input: ResultInput) {
    const row = await this.db.transaction(async (tx) => {
      const [m] = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update");
      if (!m) throw new ApiError("NOT_FOUND", "No such match.");
      const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, m.tournamentId));
      const allowed = t.organiserUserId === auth.userId || m.scorerUserId === auth.userId || auth.roles.includes("super_admin");
      if (!allowed) throw new ApiError("FORBIDDEN", "Only the organiser or this match's scorer can enter its result.");
      if (m.status === "cancelled") throw new ApiError("CONFLICT", "This match was cancelled.");
      if (!m.homeEntrantId || !m.awayEntrantId) throw new ApiError("CONFLICT", "Both sides must be known before a result can be entered.");

      const feeds = [`W:${m.matchNo}`, `L:${m.matchNo}`];
      const next = await tx.select().from(matches).where(and(eq(matches.formatId, m.formatId), or(inArray(matches.homeSource, feeds), inArray(matches.awaySource, feeds))));
      if (next.some((n) => n.status !== "scheduled")) throw new ApiError("CONFLICT", "The next round has started, so this result can't change.");

      const sides = [m.homeEntrantId, m.awayEntrantId];
      let set: Partial<MatchRow>;
      if (input.type === "abandoned") {
        set = { status: "abandoned", homeScore: null, awayScore: null, winnerEntrantId: null, resultNote: input.reason };
      } else if (input.type === "score") {
        let winner = input.homeScore > input.awayScore ? m.homeEntrantId : input.awayScore > input.homeScore ? m.awayEntrantId : null;
        if (input.winnerEntrantId) {
          if (!sides.includes(input.winnerEntrantId)) throw new ApiError("BAD_REQUEST", "The winner must be one of the two sides.");
          if (winner && winner !== input.winnerEntrantId) throw new ApiError("BAD_REQUEST", "The winner doesn't match the score.");
          winner = input.winnerEntrantId;
        }
        if (!winner && m.stage === "knockout") throw new ApiError("BAD_REQUEST", "A knockout match needs a winner. Give winnerEntrantId for a tie-break or shoot-out.");
        set = { status: "completed", homeScore: input.homeScore, awayScore: input.awayScore, winnerEntrantId: winner, resultNote: null };
      } else {
        if (!sides.includes(input.winnerEntrantId)) throw new ApiError("BAD_REQUEST", "The winner must be one of the two sides.");
        set = { status: input.type, homeScore: null, awayScore: null, winnerEntrantId: input.winnerEntrantId, resultNote: input.reason };
      }
      const [updated] = await tx.update(matches).set(set).where(eq(matches.id, m.id)).returning();
      await this.audit.record({ entity: "match", entityId: m.id, action: "result", before: { status: m.status, home: m.homeScore, away: m.awayScore }, after: set, userId: auth.userId }, tx);

      await this.advance(tx, updated);
      if (updated.stage === "group") await this.fillFromGroups(tx, updated.formatId);
      return updated;
    });
    return this.view(row, await this.names([row.homeEntrantId, row.awayEntrantId]));
  }

  // ---------- Bracket filling ----------

  /** The winner (and, for the third-place match, the loser) take their places in the next matches. */
  private async advance(tx: Db, m: MatchRow) {
    const winner = m.winnerEntrantId;
    const loser = winner ? (winner === m.homeEntrantId ? m.awayEntrantId : m.homeEntrantId) : null;
    for (const [source, entrant] of [[`W:${m.matchNo}`, winner], [`L:${m.matchNo}`, loser]] as const) {
      await tx.update(matches).set({ homeEntrantId: entrant }).where(and(eq(matches.formatId, m.formatId), eq(matches.homeSource, source)));
      await tx.update(matches).set({ awayEntrantId: entrant }).where(and(eq(matches.formatId, m.formatId), eq(matches.awaySource, source)));
    }
  }

  /** Once every group match is decided, "A1", "B2" … in the knockout become real entrants (FR-TRN-07). */
  private async fillFromGroups(tx: Db, formatId: string) {
    const format = await this.format(formatId, tx);
    if (format.type !== "league_knockout") return;
    const group = await tx.select().from(matches).where(and(eq(matches.formatId, formatId), eq(matches.stage, "group")));
    if (group.some((m) => m.status === "scheduled" || m.status === "live")) return;
    const places = new Map<string, string>();
    for (const g of new Set(group.map((m) => m.groupName!))) {
      this.groupTable(group.filter((m) => m.groupName === g), format.config).forEach((r, i) => places.set(`${g}${i + 1}`, r.entrantId));
    }
    const ko = await tx.select().from(matches).where(and(eq(matches.formatId, formatId), eq(matches.stage, "knockout"), eq(matches.round, 1)));
    for (const m of ko) {
      await tx
        .update(matches)
        .set({ homeEntrantId: places.get(m.homeSource ?? "") ?? m.homeEntrantId, awayEntrantId: places.get(m.awaySource ?? "") ?? m.awayEntrantId })
        .where(eq(matches.id, m.id));
    }
  }

  private groupTable(group: MatchRow[], config: FormatConfig) {
    const entrants = [...new Set(group.flatMap((m) => [m.homeEntrantId!, m.awayEntrantId!]))];
    const results = group
      .filter((m) => (DONE as readonly string[]).includes(m.status))
      .map((m) => ({ home: m.homeEntrantId!, away: m.awayEntrantId!, homeScore: m.homeScore, awayScore: m.awayScore, winner: m.winnerEntrantId }));
    return standings(entrants, results, config);
  }

  // ---------- Helpers ----------

  /** Confirmed teams for team sports; enrolled players' entries for individual ones. */
  async entrants(tx: Db, f: FormatRow): Promise<{ id: string; players: string[] }[]> {
    const [event] = await tx.select().from(tournamentEvents).where(eq(tournamentEvents.id, f.eventId));
    const inCategory = (col: typeof teams.categoryId | typeof enrollments.categoryId) => (f.categoryId ? eq(col, f.categoryId) : undefined);
    if (event.entryType === "individual") {
      const rows = await tx
        .select({ id: enrollments.id, playerId: enrollments.playerId })
        .from(enrollments)
        .where(and(eq(enrollments.eventId, f.eventId), eq(enrollments.status, "enrolled"), inCategory(enrollments.categoryId)));
      return rows.map((r) => ({ id: r.id, players: [r.playerId] }));
    }
    const ts = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.eventId, f.eventId), eq(teams.status, "confirmed"), inCategory(teams.categoryId)));
    if (!ts.length) return [];
    const members = await tx
      .select({ teamId: enrollments.teamId, playerId: enrollments.playerId })
      .from(enrollments)
      .where(and(inArray(enrollments.teamId, ts.map((x) => x.id)), eq(enrollments.status, "enrolled")));
    return ts.map((x) => ({ id: x.id, players: members.filter((m) => m.teamId === x.id).map((m) => m.playerId) }));
  }

  private seed(ids: string[], config: FormatConfig): string[] {
    if (config.seeding === "manual") {
      const known = config.seeds.filter((s) => ids.includes(s));
      return [...known, ...this.shuffle(ids.filter((id) => !known.includes(id)))];
    }
    return this.shuffle(ids);
  }

  private shuffle<T>(list: T[]): T[] {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Players and courts already booked by other sports and categories of the same tournament. */
  private async busyElsewhere(tx: Db, f: FormatRow): Promise<Busy[]> {
    const others = await tx
      .select()
      .from(matches)
      .where(and(eq(matches.tournamentId, f.tournamentId), ne(matches.formatId, f.id), isNotNull(matches.scheduledAt), ne(matches.status, "cancelled")));
    if (!others.length) return [];
    const byFormat = new Map<string, Map<string, string[]>>();
    for (const fid of new Set(others.map((m) => m.formatId))) {
      byFormat.set(fid, new Map((await this.entrants(tx, await this.format(fid, tx))).map((e) => [e.id, e.players])));
    }
    // shortcut: other matches are assumed to take 60 minutes (duration isn't stored per match); store it if formats use very different lengths.
    return others.map((m) => {
      const ps = byFormat.get(m.formatId)!;
      const start = m.scheduledAt!.getTime();
      return { start, end: start + 60 * 60_000, court: m.court, players: [...(ps.get(m.homeEntrantId ?? "") ?? []), ...(ps.get(m.awayEntrantId ?? "") ?? [])] };
    });
  }

  /** Warnings after a manual change: same court, or a shared player, at the same start time. */
  private async clashes(m: MatchRow): Promise<string[]> {
    if (!m.scheduledAt) return [];
    const same = await this.db
      .select()
      .from(matches)
      .where(and(eq(matches.tournamentId, m.tournamentId), eq(matches.scheduledAt, m.scheduledAt), ne(matches.id, m.id), ne(matches.status, "cancelled")));
    const warnings: string[] = [];
    if (m.court && same.some((o) => o.court === m.court)) warnings.push(`Court ${m.court} already has a match at this time.`);
    const mine = new Set([m.homeEntrantId, m.awayEntrantId].filter(Boolean));
    if (same.some((o) => mine.has(o.homeEntrantId) || mine.has(o.awayEntrantId))) warnings.push("A side in this match is already playing at this time.");
    return warnings;
  }

  private async assertNotStarted(tx: Db, formatId: string) {
    const started = await tx.select({ id: matches.id }).from(matches).where(and(eq(matches.formatId, formatId), ne(matches.status, "scheduled"), ne(matches.status, "cancelled"))).limit(1);
    if (started.length) throw new ApiError("CONFLICT", "Some matches have been played, so the fixtures can't be regenerated.");
  }

  async format(id: string, tx: Db = this.db): Promise<FormatRow> {
    const [f] = await tx.select().from(formats).where(eq(formats.id, id));
    if (!f) throw new ApiError("NOT_FOUND", "No such format.");
    return f;
  }

  private async match(id: string): Promise<MatchRow> {
    const [m] = await this.db.select().from(matches).where(eq(matches.id, id));
    if (!m) throw new ApiError("NOT_FOUND", "No such match.");
    return m;
  }

  /** Display names: team name, or the player's name for an individual entry. */
  async names(ids: (string | null)[], tx: Db = this.db): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    if (!list.length) return new Map();
    const t = await tx.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, list));
    const e = await tx.select({ id: enrollments.id, name: players.name }).from(enrollments).innerJoin(players, eq(players.id, enrollments.playerId)).where(inArray(enrollments.id, list));
    return new Map([...t, ...e].map((x) => [x.id, x.name]));
  }

  private view(m: MatchRow, names: Map<string, string>) {
    const { updatedAt: _u, ...rest } = m;
    return {
      ...rest,
      homeName: m.homeEntrantId ? (names.get(m.homeEntrantId) ?? "") : null,
      awayName: m.awayEntrantId ? (names.get(m.awayEntrantId) ?? "") : null,
      scheduledAt: m.scheduledAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
    };
  }
}

