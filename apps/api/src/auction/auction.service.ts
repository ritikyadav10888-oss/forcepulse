import { randomInt } from "node:crypto";
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  auctionCategories,
  auctionLots,
  auctionPlans,
  auctions,
  auctionTeams,
  bids,
  enrollments,
  players,
  teams,
  tournamentEvents,
  tournaments,
  users,
  type BidSlab,
  type Db,
} from "@force-pulse/db";
import { toE164Mobile } from "@force-pulse/shared";
import { ApiError } from "../common/api-error";
import { AuditService } from "../common/audit.service";
import { randomCode } from "../common/codes";
import type { AuthContext } from "../common/policy";
import { CLOCK, DB, type Clock } from "../common/tokens";
import { RealtimeGateway } from "../realtime.gateway";
import { RolesService } from "../roles/roles.service";
import { TournamentsService } from "../tournaments/tournaments.service";
import { checkBid, nextBid } from "./bid-rules";

type AuctionRow = typeof auctions.$inferSelect;

export interface AuctionConfig {
  purse: number;
  minSquad: number;
  maxSquad: number;
  timerSeconds: number;
  lotOrder: "category" | "random" | "manual";
  slabs: BidSlab[];
  categories: { name: string; basePoints: number; quotaPerTeam: number | null }[];
}

/**
 * Points-only player auction (SRS v2 section 7, System Design 7). Every change locks the auction row, so bids are
 * decided in the order the server receives them (FR-AUC-13), and the server, not the client, sets each bid amount.
 * shortcut: live state lives in PostgreSQL under a row lock; move it to the Redis bid script (System Design 7.3) when
 * auctions run at the 20,000-viewer peak.
 */
@Injectable()
export class AuctionService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly tournaments: TournamentsService,
    private readonly roles: RolesService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** The hammer falls when a lot's timer runs out, even if nobody calls the API (FR-AUC-14). */
  onModuleInit() {
    this.timer = setInterval(() => void this.settleDue().catch(() => undefined), 500);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // ---------- Setup (FR-AUC-01 to 08, 21 to 25) ----------

  async create(auth: AuthContext, tournamentId: string, input: { eventId: string; categoryId: string | null }) {
    await this.tournaments.manageable(auth, tournamentId);
    const [ev] = await this.db.select().from(tournamentEvents).where(and(eq(tournamentEvents.id, input.eventId), eq(tournamentEvents.tournamentId, tournamentId)));
    if (!ev) throw new ApiError("BAD_REQUEST", "That sport isn't part of this tournament.");
    if (ev.entryType !== "pooled") throw new ApiError("BAD_REQUEST", "Auctions are for sports where players register alone and teams are formed afterwards.");
    const [a] = await this.db
      .insert(auctions)
      .values({ tournamentId, eventId: ev.id, categoryId: input.categoryId, createdByUserId: auth.userId })
      .onConflictDoNothing()
      .returning();
    if (!a) throw new ApiError("CONFLICT", "This sport already has an auction.");
    return this.view(a.id);
  }

  plans() {
    return this.db.select().from(auctionPlans).orderBy(asc(auctionPlans.maxTeams));
  }

  async setPlanPrice(actorId: string, planId: string, pricePaise: number) {
    const [p] = await this.db.update(auctionPlans).set({ pricePaise }).where(eq(auctionPlans.id, planId)).returning();
    if (!p) throw new ApiError("NOT_FOUND", "No such plan.");
    await this.audit.record({ entity: "auction_plan", entityId: planId, action: "set_price", after: { pricePaise }, userId: actorId });
    return p;
  }

  /** What the organiser pays to move to `planId`: the full price, or the difference when upgrading (FR-AUC-24). */
  async planCharge(auctionId: string, planId: string): Promise<{ plan: typeof auctionPlans.$inferSelect; amount: number }> {
    const a = await this.row(this.db, auctionId);
    const [plan] = await this.db.select().from(auctionPlans).where(eq(auctionPlans.id, planId));
    if (!plan) throw new ApiError("NOT_FOUND", "No such plan.");
    if (plan.pricePaise === null) throw new ApiError("PAYMENTS_UNAVAILABLE", "This plan isn't on sale yet.");
    if (plan.maxTeams <= a.maxTeams) throw new ApiError("CONFLICT", "Pick a plan with more teams than the current one.");
    const current = a.planId ? (await this.db.select().from(auctionPlans).where(eq(auctionPlans.id, a.planId)))[0] : null;
    return { plan, amount: plan.pricePaise - (current?.pricePaise ?? 0) };
  }

  /** Unlocks the auction with a plan's team limit (paid, or granted by staff). */
  async applyPlan(tx: Db, auctionId: string, planId: string) {
    const [plan] = await tx.select().from(auctionPlans).where(eq(auctionPlans.id, planId));
    const a = await this.row(tx, auctionId, true);
    if (plan.maxTeams <= a.maxTeams) return;
    await tx
      .update(auctions)
      .set({ planId, maxTeams: plan.maxTeams, status: a.status === "locked" ? "setup" : a.status })
      .where(eq(auctions.id, auctionId));
  }

  async grantPlan(actorId: string, auctionId: string, planId: string) {
    await this.db.transaction(async (tx) => {
      await this.applyPlan(tx, auctionId, planId);
      await this.audit.record({ entity: "auction", entityId: auctionId, action: "grant_plan", after: { planId }, userId: actorId }, tx);
    });
    return this.publish(auctionId);
  }

  async configure(auth: AuthContext, id: string, cfg: AuctionConfig) {
    if (cfg.minSquad > cfg.maxSquad) throw new ApiError("BAD_REQUEST", "Minimum squad is above the maximum.");
    if (!cfg.slabs.some((s) => s.from === 0)) throw new ApiError("BAD_REQUEST", "Bid slabs must start from 0.");
    await this.db.transaction(async (tx) => {
      const a = await this.auctioneer(tx, auth, id);
      if (a.status !== "locked" && a.status !== "setup") throw new ApiError("CONFLICT", "The auction has started; its settings are fixed.");
      await tx
        .update(auctions)
        .set({ purse: cfg.purse, minSquad: cfg.minSquad, maxSquad: cfg.maxSquad, timerSeconds: cfg.timerSeconds, lotOrder: cfg.lotOrder, slabs: cfg.slabs })
        .where(eq(auctions.id, id));
      const used = await tx.select({ id: auctionLots.id }).from(auctionLots).where(eq(auctionLots.auctionId, id)).limit(1);
      if (used.length) throw new ApiError("CONFLICT", "Players are already placed in categories; clear them before changing categories.");
      await tx.delete(auctionCategories).where(eq(auctionCategories.auctionId, id));
      if (cfg.categories.length) await tx.insert(auctionCategories).values(cfg.categories.map((c, i) => ({ ...c, auctionId: id, position: i })));
    });
    return this.publish(id);
  }

  /** FR-AUC-02. Beyond the plan's team limit: PLAN_LIMIT_REACHED with the upgrade on offer (AC-11). */
  async addTeam(auth: AuthContext, id: string, input: { name: string; logoUrl: string; ownerPhone: string | null }) {
    await this.db.transaction(async (tx) => {
      const a = await this.auctioneer(tx, auth, id);
      if (a.status !== "setup") throw new ApiError("CONFLICT", a.status === "locked" ? "Buy a plan to add teams." : "Teams are fixed once the auction starts.");
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(auctionTeams).where(eq(auctionTeams.auctionId, id));
      if (n >= a.maxTeams) {
        const [up] = await tx.select().from(auctionPlans).where(sql`${auctionPlans.maxTeams} > ${a.maxTeams}`).orderBy(asc(auctionPlans.maxTeams)).limit(1);
        const [cur] = a.planId ? await tx.select().from(auctionPlans).where(eq(auctionPlans.id, a.planId)) : [];
        throw new ApiError("PLAN_LIMIT_REACHED", `Your plan allows ${a.maxTeams} teams.${up ? ` Upgrade to ${up.name} for ${up.maxTeams} teams.` : ""}`, {
          maxTeams: a.maxTeams,
          upgrade: up ? { planId: up.id, maxTeams: up.maxTeams, pricePaise: up.pricePaise === null ? null : up.pricePaise - (cur?.pricePaise ?? 0) } : null,
        });
      }
      let ownerUserId: string | null = null;
      if (input.ownerPhone) {
        const phone = toE164Mobile(input.ownerPhone);
        const [u] = phone ? await tx.select({ id: users.id }).from(users).where(eq(users.phone, phone)) : [];
        if (!u) throw new ApiError("BAD_REQUEST", "The team owner must sign in to Force Pulse once before being added.");
        ownerUserId = u.id;
        await this.roles.grant(u.id, "team_owner", "auction_team_owner", tx);
      }
      await tx.insert(auctionTeams).values({ auctionId: id, name: input.name, logoUrl: input.logoUrl, ownerUserId });
    });
    return this.publish(id);
  }

  /** Players in the pool: entered in this sport (and category) as individuals waiting for a team. */
  async pool(auth: AuthContext, id: string) {
    const a = await this.auctioneer(this.db, auth, id);
    return this.db
      .select({ playerId: players.id, enrollmentId: enrollments.id, name: players.name, photoUrl: players.photoUrl, gender: players.gender, lotCategoryId: auctionLots.categoryId })
      .from(enrollments)
      .innerJoin(players, eq(players.id, enrollments.playerId))
      .leftJoin(auctionLots, and(eq(auctionLots.auctionId, id), eq(auctionLots.playerId, enrollments.playerId)))
      .where(this.poolWhere(a));
  }

  /** FR-AUC-05: every auctioned player goes into a category. Replaces the list while in setup. */
  async setLots(auth: AuthContext, id: string, list: { playerId: string; categoryId: string }[]) {
    await this.db.transaction(async (tx) => {
      const a = await this.auctioneer(tx, auth, id);
      if (a.status !== "setup") throw new ApiError("CONFLICT", "Players can be placed only during setup.");
      const pool = await tx.select({ playerId: enrollments.playerId, enrollmentId: enrollments.id }).from(enrollments).where(this.poolWhere(a));
      const cats = new Set((await tx.select({ id: auctionCategories.id }).from(auctionCategories).where(eq(auctionCategories.auctionId, id))).map((c) => c.id));
      const rows = list.map((l, i) => {
        const entry = pool.find((p) => p.playerId === l.playerId);
        if (!entry) throw new ApiError("BAD_REQUEST", "Someone in the list isn't in this auction's pool.");
        if (!cats.has(l.categoryId)) throw new ApiError("BAD_REQUEST", "Unknown category.");
        return { auctionId: id, playerId: l.playerId, enrollmentId: entry.enrollmentId, categoryId: l.categoryId, position: i };
      });
      await tx.delete(auctionLots).where(eq(auctionLots.auctionId, id));
      if (rows.length) await tx.insert(auctionLots).values(rows);
    });
    return this.publish(id);
  }

  // ---------- Live (FR-AUC-09 to 18) ----------

  async start(auth: AuthContext, id: string) {
    await this.db.transaction(async (tx) => {
      const a = await this.auctioneer(tx, auth, id);
      if (a.status !== "setup") throw new ApiError("CONFLICT", a.status === "locked" ? "Buy a plan first (FR-AUC-21)." : "The auction has already started.");
      const [{ t }] = await tx.select({ t: sql<number>`count(*)::int` }).from(auctionTeams).where(eq(auctionTeams.auctionId, id));
      const [{ l }] = await tx.select({ l: sql<number>`count(*)::int` }).from(auctionLots).where(eq(auctionLots.auctionId, id));
      if (t < 2) throw new ApiError("CONFLICT", "Add at least two teams.");
      if (!l) throw new ApiError("CONFLICT", "Place players in categories first.");
      if (a.purse <= 0 || !a.slabs.length) throw new ApiError("CONFLICT", "Set the purse and bid slabs first.");
      await tx.update(auctions).set({ status: "live" }).where(eq(auctions.id, id));
    });
    return this.publish(id);
  }

  /** FR-AUC-09: next player by category order, random draw, or the auctioneer's pick. */
  async next(auth: AuthContext, id: string, lotId: string | null) {
    await this.db.transaction(async (tx) => {
      const a = await this.auctioneer(tx, auth, id);
      await this.settle(tx, a);
      const fresh = await this.row(tx, id);
      if (fresh.status !== "live") throw new ApiError("CONFLICT", "The auction isn't running.");
      if (fresh.currentLotId) throw new ApiError("CONFLICT", "A player is already on the block.");
      const upcoming = await tx
        .select({ lot: auctionLots, catPos: auctionCategories.position })
        .from(auctionLots)
        .innerJoin(auctionCategories, eq(auctionCategories.id, auctionLots.categoryId))
        .where(and(eq(auctionLots.auctionId, id), eq(auctionLots.status, "upcoming")))
        .orderBy(asc(auctionCategories.position), asc(auctionLots.position));
      if (!upcoming.length) throw new ApiError("CONFLICT", "No players left. Re-auction the unsold ones or close the auction.");
      let pick = upcoming[0].lot;
      if (lotId) {
        const chosen = upcoming.find((u) => u.lot.id === lotId);
        if (!chosen) throw new ApiError("BAD_REQUEST", "That player isn't waiting to be auctioned.");
        pick = chosen.lot;
      } else if (fresh.lotOrder === "random") pick = upcoming[randomInt(upcoming.length)].lot;
      else if (fresh.lotOrder === "manual") throw new ApiError("BAD_REQUEST", "Pick the next player (manual order).");

      await tx.update(auctionLots).set({ status: "live" }).where(eq(auctionLots.id, pick.id));
      await tx
        .update(auctions)
        .set({ currentLotId: pick.id, currentBid: null, leadingTeamId: null, endsAt: this.deadline(fresh), pausedRemainingMs: null })
        .where(eq(auctions.id, id));
    });
    return this.publish(id);
  }

  /**
   * A bid (FR-AUC-11/12). Team owners bid for their own team; the auctioneer may enter a floor bid for any team
   * (FR-AUC-16). The amount is always set here: base price first, then the slab raise. Each bid resets the timer.
   */
  async bid(auth: AuthContext, id: string, teamId: string, floor: boolean) {
    const accepted = await this.db.transaction(async (tx): Promise<number | null> => {
      const a = await this.row(tx, id, true);
      const [t] = await tx.select({ organiserUserId: tournaments.organiserUserId }).from(tournaments).where(eq(tournaments.id, a.tournamentId));
      const [team] = await tx.select().from(auctionTeams).where(and(eq(auctionTeams.id, teamId), eq(auctionTeams.auctionId, id)));
      if (!team) throw new ApiError("NOT_FOUND", "No such team in this auction.");
      const isAuctioneer = t.organiserUserId === auth.userId || auth.roles.includes("super_admin");
      if (floor ? !isAuctioneer : team.ownerUserId !== auth.userId) {
        throw new ApiError("FORBIDDEN", floor ? "Only the auctioneer enters floor bids." : "You can bid only for the team you own.");
      }
      if (await this.settle(tx, a)) return null; // the sale stands; the late bid is refused below
      if (a.status !== "live" || !a.currentLotId) throw new ApiError("CONFLICT", a.status === "paused" ? "The auction is paused." : "No player is on the block.");
      if (a.leadingTeamId === teamId) throw new ApiError("CONFLICT", "This team already leads.");

      const [lot] = await tx.select().from(auctionLots).where(eq(auctionLots.id, a.currentLotId));
      const cats = await tx.select().from(auctionCategories).where(eq(auctionCategories.auctionId, id));
      const cat = cats.find((c) => c.id === lot.categoryId)!;
      const bought = await tx.select({ points: auctionLots.soldPoints, categoryId: auctionLots.categoryId }).from(auctionLots).where(and(eq(auctionLots.auctionId, id), eq(auctionLots.soldTeamId, teamId)));
      const amount = nextBid(a.currentBid, cat.basePoints, a.slabs);
      const check = checkBid({
        amount,
        pointsLeft: a.purse - bought.reduce((s, b) => s + (b.points ?? 0), 0),
        squadSize: bought.length,
        minSquad: a.minSquad,
        maxSquad: a.maxSquad,
        lowestBase: Math.min(...cats.map((c) => c.basePoints)),
        inCategory: bought.filter((b) => b.categoryId === cat.id).length,
        quota: cat.quotaPerTeam,
      });
      if (!check.ok) throw new ApiError(check.code, check.reason, { amount });

      await tx.insert(bids).values({ lotId: lot.id, teamId, points: amount, round: lot.round, byUserId: auth.userId, floor, createdAt: this.clock.now() });
      await tx.update(auctions).set({ currentBid: amount, leadingTeamId: teamId, endsAt: this.deadline(a) }).where(eq(auctions.id, id));
      return amount;
    });
    const state = await this.publish(id);
    if (accepted === null) throw new ApiError("CONFLICT", "Time ran out on this player.");
    return { accepted, state };
  }

  async pause(auth: AuthContext, id: string) {
    await this.db.transaction(async (tx) => {
      const a = await this.auctioneer(tx, auth, id);
      if (a.status !== "live") throw new ApiError("CONFLICT", "The auction isn't running.");
      const remaining = a.endsAt ? Math.max(0, a.endsAt.getTime() - this.clock.now().getTime()) : null;
      await tx.update(auctions).set({ status: "paused", pausedRemainingMs: remaining, endsAt: null }).where(eq(auctions.id, id));
    });
    return this.publish(id);
  }

  async resume(auth: AuthContext, id: string) {
    await this.db.transaction(async (tx) => {
      const a = await this.auctioneer(tx, auth, id);
      if (a.status !== "paused") throw new ApiError("CONFLICT", "The auction isn't paused.");
      const endsAt = a.currentLotId ? new Date(this.clock.now().getTime() + (a.pausedRemainingMs ?? a.timerSeconds * 1000)) : null;
      await tx.update(auctions).set({ status: "live", endsAt, pausedRemainingMs: null }).where(eq(auctions.id, id));
    });
    return this.publish(id);
  }

  /** FR-AUC-15: takes back the most recent sale; the player returns to the pool and the points to the team. */
  async undoLastSale(auth: AuthContext, id: string, reason: string) {
    await this.db.transaction(async (tx) => {
      const a = await this.auctioneer(tx, auth, id);
      if (a.status !== "live" && a.status !== "paused") throw new ApiError("CONFLICT", "Only during the auction.");
      if (a.currentLotId) throw new ApiError("CONFLICT", "Finish the player on the block first.");
      const [last] = await tx.select().from(auctionLots).where(and(eq(auctionLots.auctionId, id), eq(auctionLots.status, "sold"))).orderBy(desc(auctionLots.soldAt)).limit(1);
      if (!last) throw new ApiError("CONFLICT", "Nothing has been sold yet.");
      await tx.update(auctionLots).set({ status: "upcoming", soldTeamId: null, soldPoints: null, soldAt: null }).where(eq(auctionLots.id, last.id));
      await this.audit.record({ entity: "auction_lot", entityId: last.id, action: "undo_sale", before: { teamId: last.soldTeamId, points: last.soldPoints }, reason, userId: auth.userId }, tx);
    });
    return this.publish(id);
  }

  /** FR-AUC-15/25: unsold players go round again, within the same plan. */
  async reauction(auth: AuthContext, id: string) {
    await this.db.transaction(async (tx) => {
      const a = await this.auctioneer(tx, auth, id);
      if (a.status !== "live" && a.status !== "paused") throw new ApiError("CONFLICT", "Only during the auction.");
      const unsold = await tx.update(auctionLots).set({ status: "upcoming", round: a.round + 1 }).where(and(eq(auctionLots.auctionId, id), eq(auctionLots.status, "unsold"))).returning({ id: auctionLots.id });
      if (!unsold.length) throw new ApiError("CONFLICT", "No unsold players.");
      await tx.update(auctions).set({ round: a.round + 1 }).where(eq(auctions.id, id));
    });
    return this.publish(id);
  }

  /**
   * FR-AUC-19, AC-10: each team with players becomes a tournament team, and every sold player is enrolled under it
   * (their existing entry moves to the team). Unsold players stay entered without a team.
   */
  async close(auth: AuthContext, id: string) {
    await this.db.transaction(async (tx) => {
      const a = await this.auctioneer(tx, auth, id);
      await this.settle(tx, a);
      const fresh = await this.row(tx, id);
      if (fresh.status !== "live" && fresh.status !== "paused") throw new ApiError("CONFLICT", "Only a running auction can be closed.");
      if (fresh.currentLotId) throw new ApiError("CONFLICT", "Finish the player on the block first.");

      const sold = await tx.select().from(auctionLots).where(and(eq(auctionLots.auctionId, id), eq(auctionLots.status, "sold"))).orderBy(asc(auctionLots.soldAt));
      for (const team of await tx.select().from(auctionTeams).where(eq(auctionTeams.auctionId, id))) {
        const mine = sold.filter((l) => l.soldTeamId === team.id);
        if (!mine.length) continue;
        let code = randomCode(6);
        while ((await tx.select({ id: teams.id }).from(teams).where(eq(teams.code, code))).length) code = randomCode(6);
        const [ct] = await tx
          .insert(teams)
          .values({ tournamentId: a.tournamentId, eventId: a.eventId, categoryId: a.categoryId, name: team.name, code, captainPlayerId: mine[0].playerId, status: "confirmed" })
          .returning();
        await tx.update(auctionTeams).set({ competitionTeamId: ct.id }).where(eq(auctionTeams.id, team.id));
        await tx.update(enrollments).set({ teamId: ct.id, joinedVia: "auction" }).where(inArray(enrollments.id, mine.map((l) => l.enrollmentId)));
        await tx.update(enrollments).set({ isCaptain: true }).where(eq(enrollments.id, mine[0].enrollmentId));
      }
      await tx.update(auctions).set({ status: "completed", endsAt: null }).where(eq(auctions.id, id));
      await this.audit.record({ entity: "auction", entityId: id, action: "close", after: { sold: sold.length }, userId: auth.userId }, tx);
    });
    return this.publish(id);
  }

  // ---------- Timer ----------

  /** Sells (or marks unsold) the lot on the block once its time is up. Returns true when it did. */
  private async settle(tx: Db, a: AuctionRow): Promise<boolean> {
    if (a.status !== "live" || !a.currentLotId || !a.endsAt || a.endsAt > this.clock.now()) return false;
    const now = this.clock.now();
    if (a.leadingTeamId) {
      await tx.update(auctionLots).set({ status: "sold", soldTeamId: a.leadingTeamId, soldPoints: a.currentBid, soldAt: now }).where(eq(auctionLots.id, a.currentLotId));
    } else {
      await tx.update(auctionLots).set({ status: "unsold" }).where(eq(auctionLots.id, a.currentLotId));
    }
    await tx.update(auctions).set({ currentLotId: null, currentBid: null, leadingTeamId: null, endsAt: null }).where(eq(auctions.id, a.id));
    return true;
  }

  async settleDue(): Promise<void> {
    const due = await this.db.select({ id: auctions.id }).from(auctions).where(and(eq(auctions.status, "live"), lte(auctions.endsAt, this.clock.now())));
    for (const { id } of due) await this.settleOne(id);
  }

  private async settleOne(id: string) {
    const done = await this.db.transaction(async (tx) => this.settle(tx, await this.row(tx, id, true)));
    if (done) await this.publish(id);
  }

  // ---------- Reading (FR-AUC-10, FR-AUC-17, FR-AUC-18, FR-AUC-20) ----------

  /** Public read: same visibility as the tournament. */
  async get(id: string, viewer?: AuthContext) {
    const a = await this.row(this.db, id);
    await this.tournaments.get(a.tournamentId, viewer);
    await this.settleOne(id);
    return this.view(id);
  }

  /** Everything the bidder screens and projector show; sent in full on every change. */
  private async view(id: string) {
    const a = await this.row(this.db, id);
    const [cats, ts, lots] = await Promise.all([
      this.db.select().from(auctionCategories).where(eq(auctionCategories.auctionId, id)).orderBy(asc(auctionCategories.position)),
      this.db.select().from(auctionTeams).where(eq(auctionTeams.auctionId, id)),
      this.db
        .select({ lot: auctionLots, name: players.name, photoUrl: players.photoUrl, gender: players.gender })
        .from(auctionLots)
        .innerJoin(players, eq(players.id, auctionLots.playerId))
        .where(eq(auctionLots.auctionId, id))
        .orderBy(asc(auctionLots.position)),
    ]);
    const current = lots.find((l) => l.lot.id === a.currentLotId);
    const recent = current
      ? await this.db.select().from(bids).where(eq(bids.lotId, current.lot.id)).orderBy(desc(bids.id)).limit(10)
      : [];
    const catOf = (cid: string) => cats.find((c) => c.id === cid);
    return {
      ...a,
      createdAt: a.createdAt.toISOString(),
      endsAt: a.endsAt?.toISOString() ?? null,
      serverTime: this.clock.now().toISOString(),
      categories: cats,
      teams: ts.map((t) => {
        const mine = lots.filter((l) => l.lot.soldTeamId === t.id);
        const spent = mine.reduce((s, l) => s + (l.lot.soldPoints ?? 0), 0);
        return { ...t, pointsLeft: a.purse - spent, players: mine.length, slotsLeft: Math.max(0, a.maxSquad - mine.length) };
      }),
      current: current
        ? {
            lotId: current.lot.id,
            playerId: current.lot.playerId,
            name: current.name,
            photoUrl: current.photoUrl,
            gender: current.gender,
            category: catOf(current.lot.categoryId)?.name ?? "",
            basePoints: catOf(current.lot.categoryId)?.basePoints ?? 0,
            round: current.lot.round,
          }
        : null,
      bids: recent.map((b) => ({ teamId: b.teamId, points: b.points, floor: b.floor, at: b.createdAt.toISOString() })),
      lots: lots.map((l) => ({
        lotId: l.lot.id,
        playerId: l.lot.playerId,
        name: l.name,
        category: catOf(l.lot.categoryId)?.name ?? "",
        status: l.lot.status,
        soldTeamId: l.lot.soldTeamId,
        soldPoints: l.lot.soldPoints,
      })),
    };
  }

  async exportCsv(auth: AuthContext, id: string): Promise<string> {
    await this.auctioneer(this.db, auth, id);
    const v = await this.view(id);
    const team = (tid: string | null) => v.teams.find((t) => t.id === tid)?.name ?? "";
    const cell = (s: string) => (/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""');
    const lines = v.lots.map((l) => [l.name, l.category, l.status, team(l.soldTeamId), l.soldPoints ?? ""].map((x) => `"${cell(String(x))}"`).join(","));
    return ["Player,Category,Status,Team,Points", ...lines].join("\r\n") + "\r\n";
  }

  async forTournament(tournamentId: string, viewer?: AuthContext) {
    await this.tournaments.get(tournamentId, viewer);
    return this.db.select().from(auctions).where(eq(auctions.tournamentId, tournamentId));
  }

  /** The auction, if the caller runs it (used by plan payments). */
  forAuctioneer(auth: AuthContext, id: string) {
    return this.auctioneer(this.db, auth, id, false);
  }

  // ---------- Helpers ----------

  private deadline(a: AuctionRow) {
    return new Date(this.clock.now().getTime() + a.timerSeconds * 1000);
  }

  private poolWhere(a: AuctionRow) {
    return and(eq(enrollments.eventId, a.eventId), eq(enrollments.status, "enrolled"), a.categoryId ? eq(enrollments.categoryId, a.categoryId) : undefined, isNull(enrollments.teamId));
  }

  private async row(tx: Db, id: string, lock = false): Promise<AuctionRow> {
    const q = tx.select().from(auctions).where(eq(auctions.id, id));
    const [a] = lock ? await q.for("update") : await q;
    if (!a) throw new ApiError("NOT_FOUND", "No such auction.");
    return a;
  }

  /** The auction, locked, if the caller runs it: the tournament's organiser or super admin. */
  private async auctioneer(tx: Db, auth: AuthContext, id: string, lock = true): Promise<AuctionRow> {
    const a = await this.row(tx, id, lock);
    const [t] = await tx.select({ organiserUserId: tournaments.organiserUserId }).from(tournaments).where(eq(tournaments.id, a.tournamentId));
    if (t.organiserUserId !== auth.userId && !auth.roles.includes("super_admin")) throw new ApiError("FORBIDDEN", "Only the auctioneer can do that.");
    return a;
  }

  private async publish(id: string) {
    const state = await this.view(id);
    this.realtime.emit(`auction:${id}`, "auction.updated", state);
    return state;
  }
}
