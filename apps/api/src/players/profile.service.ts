import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, inArray, notInArray, or } from "drizzle-orm";
import {
  auctionCategories,
  auctionLots,
  auctions,
  auctionTeams,
  categories,
  enrollments,
  formats,
  matchEvents,
  matches,
  teams,
  tournamentEvents,
  tournaments,
  userRoles,
  type Db,
} from "@force-pulse/db";
import { getScoringModule, type ScoreEvent } from "@force-pulse/scoring";
import { combinedRoleLabel, type Role } from "@force-pulse/shared";
import type { AuthContext } from "../common/policy";
import { DB } from "../common/tokens";
import { FixturesService } from "../fixtures/fixtures.service";
import { PlayersService } from "./players.service";

const DONE = ["completed", "walkover", "forfeit"] as const;
const GONE = ["expired", "removed", "rejected"] as const;

export interface SportStats {
  sportId: string;
  played: number;
  won: number;
  lost: number;
  drawn: number;
  winPct: number;
  /** Per-sport numbers from the scoring events (runs, wickets, goals, points…). */
  stats: Record<string, number>;
}

/**
 * The player profile (FR-PRO-01 to 05): stats from closed matches, tournament and auction history, roles, badges and
 * the last 10 matches. Read-only (FR-PRO-06); private fields follow PlayersService.byId (FR-PRO-07).
 * shortcut: worked out from matches and events on every read; store per-player totals when profiles get heavy traffic.
 */
@Injectable()
export class ProfileService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly players: PlayersService,
    private readonly fixtures: FixturesService,
  ) {}

  async profile(playerId: string, viewer?: AuthContext) {
    const player = await this.players.byId(playerId, viewer);

    // Every entry this player has: their own, and the teams they play in. Matches name these as entrants.
    const entries = await this.db
      .select({
        id: enrollments.id,
        teamId: enrollments.teamId,
        status: enrollments.status,
        tournamentId: tournaments.id,
        tournamentName: tournaments.name,
        slug: tournaments.slug,
        startsAt: tournaments.startsAt,
        sportId: tournamentEvents.sportId,
        category: categories.name,
        teamName: teams.name,
      })
      .from(enrollments)
      .innerJoin(tournaments, eq(tournaments.id, enrollments.tournamentId))
      .innerJoin(tournamentEvents, eq(tournamentEvents.id, enrollments.eventId))
      .leftJoin(categories, eq(categories.id, enrollments.categoryId))
      .leftJoin(teams, eq(teams.id, enrollments.teamId))
      .where(and(eq(enrollments.playerId, playerId), notInArray(enrollments.status, [...GONE])))
      .orderBy(desc(tournaments.startsAt));
    const mine = new Set(entries.flatMap((e) => [e.id, e.teamId]).filter((x): x is string => !!x));

    const played = mine.size
      ? await this.db
          .select({ m: matches, sportId: tournamentEvents.sportId, tournamentName: tournaments.name })
          .from(matches)
          .innerJoin(formats, eq(formats.id, matches.formatId))
          .innerJoin(tournamentEvents, eq(tournamentEvents.id, formats.eventId))
          .innerJoin(tournaments, eq(tournaments.id, matches.tournamentId))
          .where(and(inArray(matches.status, [...DONE]), or(inArray(matches.homeEntrantId, [...mine]), inArray(matches.awayEntrantId, [...mine]))))
          .orderBy(desc(matches.scheduledAt))
      : [];

    const sportStats = await this.sportStats(playerId, mine, played);
    const names = await this.fixtures.names(played.flatMap(({ m }) => [m.homeEntrantId, m.awayEntrantId]));
    const last10 = played.slice(0, 10).map(({ m, sportId, tournamentName }) => {
      const home = mine.has(m.homeEntrantId ?? "");
      return {
        matchId: m.id,
        sportId,
        tournamentName,
        playedAt: m.scheduledAt?.toISOString() ?? null,
        opponent: names.get((home ? m.awayEntrantId : m.homeEntrantId) ?? "") ?? "",
        score: m.homeScore === null ? null : home ? `${m.homeScore}–${m.awayScore}` : `${m.awayScore}–${m.homeScore}`,
        result: outcome(m, mine),
        how: m.status === "completed" ? null : m.status,
        playerOfMatch: m.playerOfMatchId === playerId,
      };
    });

    const finishes = await this.finishes(mine, entries.map((e) => e.tournamentId));
    const history = entries.map((e) => ({
      tournamentId: e.tournamentId,
      tournamentName: e.tournamentName,
      slug: e.slug,
      startsAt: e.startsAt.toISOString(),
      sportId: e.sportId,
      category: e.category,
      team: e.teamName,
      status: e.status,
      finish: finishes.get(e.teamId ?? e.id) ?? null,
    }));

    const auctionHistory = await this.db
      .select({
        tournamentName: tournaments.name,
        category: auctionCategories.name,
        basePoints: auctionCategories.basePoints,
        status: auctionLots.status,
        soldPoints: auctionLots.soldPoints,
        team: auctionTeams.name,
      })
      .from(auctionLots)
      .innerJoin(auctions, eq(auctions.id, auctionLots.auctionId))
      .innerJoin(tournaments, eq(tournaments.id, auctions.tournamentId))
      .innerJoin(auctionCategories, eq(auctionCategories.id, auctionLots.categoryId))
      .leftJoin(auctionTeams, eq(auctionTeams.id, auctionLots.soldTeamId))
      .where(eq(auctionLots.playerId, playerId));

    const roles = player.userId ? (await this.db.select({ role: userRoles.role }).from(userRoles).where(and(eq(userRoles.userId, player.userId), eq(userRoles.suspended, false)))).map((r) => r.role as Role) : [];
    const [org] = player.userId ? await this.db.select({ n: count() }).from(tournaments).where(eq(tournaments.organiserUserId, player.userId)) : [{ n: 0 }];
    const [scored] = player.userId ? await this.db.select({ n: count() }).from(matches).where(and(eq(matches.scorerUserId, player.userId), inArray(matches.status, [...DONE]))) : [{ n: 0 }];

    const totals = sportStats.reduce((a, s) => ({ played: a.played + s.played, won: a.won + s.won }), { played: 0, won: 0 });
    const potm = played.filter(({ m }) => m.playerOfMatchId === playerId).length;
    const titles = history.filter((h) => h.finish === "Winner").length;

    return {
      player,
      roles,
      roleLabel: combinedRoleLabel(roles),
      tournamentsOrganised: org.n,
      matchesScored: scored.n,
      totals: { ...totals, winPct: pct(totals.won, totals.played) },
      sports: sportStats,
      history,
      auctions: auctionHistory,
      lastMatches: last10,
      badges: badges({ played: totals.played, won: totals.won, potm, titles, sports: sportStats.length, sold: auctionHistory.some((a) => a.status === "sold") }),
    };
  }

  private async sportStats(playerId: string, mine: Set<string>, played: { m: typeof matches.$inferSelect; sportId: string }[]): Promise<SportStats[]> {
    const withEvents = played.filter(({ m }) => m.ruleSnapshot).map(({ m }) => m.id);
    const events = withEvents.length ? await this.db.select().from(matchEvents).where(inArray(matchEvents.matchId, withEvents)).orderBy(matchEvents.seq) : [];

    const bySport = new Map<string, SportStats>();
    for (const { m, sportId } of played) {
      const s = bySport.get(sportId) ?? { sportId, played: 0, won: 0, lost: 0, drawn: 0, winPct: 0, stats: {} };
      s.played++;
      const r = outcome(m, mine);
      if (r === "won") s.won++;
      else if (r === "lost") s.lost++;
      else s.drawn++;

      const module = getScoringModule(sportId);
      const evs: ScoreEvent[] = events.filter((e) => e.matchId === m.id).map((e) => ({ id: e.id, matchId: e.matchId, seq: e.seq, action: e.action, payload: e.payload, createdAt: e.serverTs.toISOString() }));
      if (module && evs.length) {
        for (const [k, v] of Object.entries(module.playerStats(evs)[playerId] ?? {})) s.stats[k] = (s.stats[k] ?? 0) + v;
      }
      bySport.set(sportId, s);
    }
    return [...bySport.values()].map((s) => ({ ...s, winPct: pct(s.won, s.played) }));
  }

  /** "Winner" / "Runner-up" from each knockout final the player's entry reached (not the third-place match). */
  private async finishes(mine: Set<string>, tournamentIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!mine.size || !tournamentIds.length) return out;
    const ko = await this.db
      .select()
      .from(matches)
      .where(and(inArray(matches.tournamentId, tournamentIds), eq(matches.stage, "knockout"), inArray(matches.status, [...DONE])));
    const lastRound = new Map<string, number>();
    for (const m of ko) lastRound.set(m.formatId, Math.max(lastRound.get(m.formatId) ?? 0, m.round));
    for (const m of ko) {
      if (m.round !== lastRound.get(m.formatId) || m.homeSource?.startsWith("L:")) continue;
      for (const side of [m.homeEntrantId, m.awayEntrantId]) {
        if (side && mine.has(side)) out.set(side, m.winnerEntrantId === side ? "Winner" : "Runner-up");
      }
    }
    return out;
  }
}

function outcome(m: typeof matches.$inferSelect, mine: Set<string>): "won" | "lost" | "drawn" {
  if (!m.winnerEntrantId) return "drawn";
  return mine.has(m.winnerEntrantId) ? "won" : "lost";
}

const pct = (won: number, played: number) => (played ? Math.round((won / played) * 100) : 0);

/** Badges earned from what the player has done (FR-PRO-05). */
export function badges(a: { played: number; won: number; potm: number; titles: number; sports: number; sold: boolean }): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  if (a.played >= 1) out.push({ id: "debut", label: "First match" });
  if (a.won >= 1) out.push({ id: "first-win", label: "First win" });
  if (a.played >= 10) out.push({ id: "ten", label: "10 matches" });
  if (a.played >= 50) out.push({ id: "fifty", label: "50 matches" });
  if (a.potm >= 1) out.push({ id: "potm", label: a.potm > 1 ? `Player of the Match ×${a.potm}` : "Player of the Match" });
  if (a.titles >= 1) out.push({ id: "champion", label: a.titles > 1 ? `Champion ×${a.titles}` : "Champion" });
  if (a.sports >= 2) out.push({ id: "multi", label: "Multi-sport" });
  if (a.sold) out.push({ id: "sold", label: "Sold at auction" });
  return out;
}
