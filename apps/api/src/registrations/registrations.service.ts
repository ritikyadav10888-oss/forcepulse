import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import {
  categories,
  enrollments,
  formVersions,
  inviteLinks,
  pincodes,
  players,
  teams,
  tournamentEvents,
  tournamentInvites,
  tournaments,
  users,
  type Db,
  type EnrollmentStatus,
  type GuardianConsent,
} from "@force-pulse/db";
import {
  checkCategoryEligibility,
  isMinor,
  profileValuesFrom,
  toE164Mobile,
  validateAnswers,
  type Answers,
  type FieldDef,
} from "@force-pulse/shared";
import { ApiError } from "../common/api-error";
import { AuditService } from "../common/audit.service";
import { randomCode } from "../common/codes";
import type { AuthContext } from "../common/policy";
import { CLOCK, DB, type Clock } from "../common/tokens";
import { UploadsService } from "../uploads/uploads.service";
import type { JoinTeamInput, ListEnrollmentsQuery, RegisterInput, TeamRegisterInput } from "./registration.schemas";

/** FR-PAY-07: an unpaid entry holds its place for 30 minutes. */
export const HOLD_MINUTES = 30;

type TournamentRow = typeof tournaments.$inferSelect;
type EventRow = typeof tournamentEvents.$inferSelect;
type CategoryRow = typeof categories.$inferSelect;
type PlayerRow = typeof players.$inferSelect;
type EnrollmentRow = typeof enrollments.$inferSelect;
type TeamRow = typeof teams.$inferSelect;

export type EnrollmentView = Omit<EnrollmentRow, "createdAt" | "updatedAt" | "holdExpiresAt"> & {
  createdAt: string;
  holdExpiresAt: string | null;
};

/** What a form submission shares across its entries, after checks. */
interface Prepared {
  player: PlayerRow;
  answers: Answers;
  formVersion: number;
  guardian: GuardianConsent | null;
  proofKey: string | null;
  /** dob / gender to check eligibility with: the form's answers, else the profile. */
  facts: { dob: string | null; gender: "male" | "female" | null };
  /** Under 18 without a guardian: refused by requireGuardian(), after the eligibility checks. */
  guardianMissing: boolean;
}

const isStaff = (auth: AuthContext) => auth.roles.includes("super_admin");

@Injectable()
export class RegistrationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly uploads: UploadsService,
  ) {}

  // ---------- Player side ----------

  /** Individual and pooled sports, one or more in one submission (FR-REG-07/08/11, FR-PAY-07). */
  async register(auth: AuthContext, tournamentId: string, input: RegisterInput) {
    const result = await this.db.transaction(async (tx) => {
      const t = await this.lockTournament(tx, tournamentId);
      const prep = await this.prepare(tx, auth, t, input, { checkInvite: true });
      const out: EnrollmentRow[] = [];

      for (const entry of input.entries) {
        const { event, category } = await this.eventAndCategory(tx, t, entry.eventId, entry.categoryId ?? null);
        if (event.entryType === "team") throw new ApiError("BAD_REQUEST", "This sport takes teams. Register a team, or join one with its code.");
        this.checkEligible(prep, category, t, input.proofKey);

        this.requireGuardian(prep);
        const existing = await this.activeEntry(tx, event.id, prep.player.id);
        if (existing) {
          out.push(existing); // Already in: same answer again (web app rule 20).
          continue;
        }
        const full = await this.isFull(tx, event, category, "players");
        const fee = category?.feePaise ?? event.feePaise;
        out.push(await this.insertEntry(tx, t, event, category, prep, auth, { full, fee }));
      }

      await this.useInviteLink(tx, t, input.inviteCode);
      return out;
    });
    return this.summary(result);
  }

  /** FR-REG-07: the captain registers the team and pays the team fee once (FR-PAY-02). */
  async registerTeam(auth: AuthContext, tournamentId: string, eventId: string, input: TeamRegisterInput) {
    const { team, entry } = await this.db.transaction(async (tx) => {
      const t = await this.lockTournament(tx, tournamentId);
      const prep = await this.prepare(tx, auth, t, input, { checkInvite: true });
      const { event, category } = await this.eventAndCategory(tx, t, eventId, input.categoryId ?? null);
      if (event.entryType !== "team") throw new ApiError("BAD_REQUEST", "This sport doesn't take team entries. Register as a player.");
      this.checkEligible(prep, category, t, input.proofKey);
      this.requireGuardian(prep);
      if (await this.activeEntry(tx, event.id, prep.player.id)) throw new ApiError("CONFLICT", "You're already registered in this sport.");

      const [nameTaken] = await tx
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.eventId, event.id), ne(teams.status, "cancelled"), sql`lower(${teams.name}) = ${input.teamName.toLowerCase()}`));
      if (nameTaken) throw new ApiError("CONFLICT", "A team with this name is already registered. Pick another name.");

      const full = await this.isFull(tx, event, category, "teams");
      const fee = category?.feePaise ?? event.feePaise;
      const [team] = await tx
        .insert(teams)
        .values({ tournamentId: t.id, eventId: event.id, categoryId: category?.id ?? null, name: input.teamName, color: input.color, code: await this.newTeamCode(tx), captainPlayerId: prep.player.id })
        .returning();
      const entry = await this.insertEntry(tx, t, event, category, prep, auth, { full, fee, teamId: team.id, isCaptain: true });
      await this.syncTeam(tx, team.id);
      await this.useInviteLink(tx, t, input.inviteCode);
      const [fresh] = await tx.select().from(teams).where(eq(teams.id, team.id));
      return { team: fresh, entry };
    });
    return { team: this.teamView(team, 1), ...this.summary([entry]) };
  }

  /** What a team-mate sees before joining. */
  async teamByCode(code: string) {
    const team = await this.teamWithCode(this.db, code);
    return this.teamView(team, await this.squadSize(this.db, team.id));
  }

  /** A team-mate joins a registered team with its code; no fee (the captain paid for the team). */
  async joinTeam(auth: AuthContext, input: JoinTeamInput) {
    const entry = await this.db.transaction(async (tx) => {
      const found = await this.teamWithCode(tx, input.code);
      const t = await this.lockTournament(tx, found.tournamentId);
      const [team] = await tx.select().from(teams).where(eq(teams.id, found.id)).for("update");
      if (team.status === "cancelled") throw new ApiError("NOT_FOUND", "This team is no longer registered.");
      if (team.status !== "confirmed") throw new ApiError("CONFLICT", "The captain hasn't finished registering this team yet. Ask them to complete payment first.");

      // The team code is the invitation, so the private-tournament check is skipped.
      const prep = await this.prepare(tx, auth, t, input, { checkInvite: false });
      const { event, category } = await this.eventAndCategory(tx, t, team.eventId, team.categoryId);
      this.checkEligible(prep, category, t, input.proofKey);
      this.requireGuardian(prep);
      if (await this.activeEntry(tx, event.id, prep.player.id)) throw new ApiError("CONFLICT", "You're already registered in this sport.");
      if (event.maxPlayersPerTeam !== null && (await this.squadSize(tx, team.id)) >= event.maxPlayersPerTeam) {
        throw new ApiError("CONFLICT", `This team already has the maximum of ${event.maxPlayersPerTeam} players.`);
      }
      return this.insertEntry(tx, t, event, category, prep, auth, { full: false, fee: 0, teamId: team.id, joinedVia: "team_code" });
    });
    return this.view(entry);
  }

  /** The caller's entries and those of players they manage (a child, a squad). */
  async mine(auth: AuthContext): Promise<EnrollmentView[]> {
    const mineIds = await this.db
      .select({ id: players.id })
      .from(players)
      .where(or(eq(players.userId, auth.userId), eq(players.managedByUserId, auth.userId)));
    if (!mineIds.length) return [];
    await this.expireHolds(this.db, { playerIds: mineIds.map((p) => p.id) });
    const rows = await this.db.select().from(enrollments).where(inArray(enrollments.playerId, mineIds.map((p) => p.id))).orderBy(desc(enrollments.createdAt));
    return rows.map((r) => this.view(r));
  }

  // ---------- Organiser side ----------

  async list(auth: AuthContext, tournamentId: string, q: z.infer<typeof ListEnrollmentsQuery>) {
    await this.manageable(this.db, auth, tournamentId);
    await this.expireHolds(this.db, { tournamentId });
    const where: SQL[] = [eq(enrollments.tournamentId, tournamentId)];
    if (q.status) where.push(eq(enrollments.status, q.status));
    if (q.eventId) where.push(eq(enrollments.eventId, q.eventId));
    if (q.categoryId) where.push(eq(enrollments.categoryId, q.categoryId));
    const rows = await this.db
      .select({ e: enrollments, playerName: players.name, playerCode: players.playerCode, gender: players.gender, dob: players.dob, phone: users.phone, teamName: teams.name })
      .from(enrollments)
      .innerJoin(players, eq(players.id, enrollments.playerId))
      .leftJoin(users, eq(users.id, sql`coalesce(${players.userId}, ${enrollments.registeredByUserId})`))
      .leftJoin(teams, eq(teams.id, enrollments.teamId))
      .where(and(...where))
      .orderBy(asc(enrollments.createdAt));
    return rows.map(({ e, ...player }) => ({ ...this.view(e), player }));
  }

  /** FR-REG-17. Cells that start like a formula are prefixed so spreadsheets don't run them. */
  async csv(auth: AuthContext, tournamentId: string): Promise<string> {
    const t = await this.manageable(this.db, auth, tournamentId);
    const rows = await this.list(auth, tournamentId, {});
    const fields = t.formVersion ? ((await this.db.select().from(formVersions).where(and(eq(formVersions.tournamentId, t.id), eq(formVersions.version, t.formVersion))))[0]?.fields ?? []) : [];
    const evs = await this.db.select({ id: tournamentEvents.id, sportId: tournamentEvents.sportId }).from(tournamentEvents).where(eq(tournamentEvents.tournamentId, t.id));
    const cats = evs.length ? await this.db.select({ id: categories.id, name: categories.name }).from(categories).where(inArray(categories.eventId, evs.map((e) => e.id))) : [];

    const header = ["Registration no", "Status", "Payment", "Sport", "Category", "Team", "Captain", "Player", "Player id", "Phone", "Gender", "Date of birth", "Registered at", "Flagged", ...fields.map((f) => f.label)];
    const lines = rows.map((r) => [
      r.registrationNo,
      r.status,
      r.paymentStatus,
      evs.find((e) => e.id === r.eventId)?.sportId ?? "",
      cats.find((c) => c.id === r.categoryId)?.name ?? "",
      r.player.teamName ?? "",
      r.isCaptain ? "yes" : "",
      r.player.playerName,
      r.player.playerCode,
      r.player.phone ?? "",
      r.player.gender ?? "",
      r.player.dob ?? "",
      r.createdAt,
      r.flagged ? "yes" : "",
      ...fields.map((f) => answerText(r.answers[f.key])),
    ]);
    return [header, ...lines].map((cells) => cells.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  /** Organiser removes an entry. A removed captain takes the team (and its members) out. Frees a place for the waitlist. */
  async remove(auth: AuthContext, enrollmentId: string, reason: string | null) {
    return this.change(auth, enrollmentId, "remove", reason, (e) => {
      if (e.status === "removed") return null;
      return "removed";
    });
  }

  /** Review add-on (FR-REG-12): approve, reject with a reason, or waitlist. */
  async review(auth: AuthContext, enrollmentId: string, action: "approve" | "reject" | "waitlist", reason: string | null) {
    return this.change(auth, enrollmentId, action, reason, (e, t) => {
      if (!t.reviewRequired) throw new ApiError("CONFLICT", "Turn on the Review add-on in tournament settings to approve, reject or waitlist entries.");
      if (action === "approve") {
        if (e.status !== "pending_review") throw new ApiError("CONFLICT", "Only entries waiting for review can be approved.");
        return "enrolled";
      }
      if (action === "waitlist") {
        if (e.status !== "pending_review") throw new ApiError("CONFLICT", "Only entries waiting for review can be waitlisted.");
        return "waitlisted";
      }
      if (!["pending_review", "waitlisted", "enrolled"].includes(e.status)) throw new ApiError("CONFLICT", "This entry can't be rejected now.");
      return "rejected";
    });
  }

  async setFlag(auth: AuthContext, enrollmentId: string, flagged: boolean) {
    const [e] = await this.db.select().from(enrollments).where(eq(enrollments.id, enrollmentId));
    if (!e) throw new ApiError("NOT_FOUND", "No such entry.");
    await this.manageable(this.db, auth, e.tournamentId);
    const [row] = await this.db.update(enrollments).set({ flagged }).where(eq(enrollments.id, enrollmentId)).returning();
    return this.view(row);
  }

  // ---------- Managed players (a parent or coach registers someone without their own login) ----------

  async createManagedPlayer(auth: AuthContext, input: { name: string; dob: string; gender: "male" | "female" }) {
    const [row] = await this.db
      .insert(players)
      .values({ ...input, managedByUserId: auth.userId, playerCode: await this.newPlayerCode(this.db) })
      .returning();
    return row;
  }

  managedPlayers(auth: AuthContext) {
    return this.db.select().from(players).where(eq(players.managedByUserId, auth.userId)).orderBy(asc(players.createdAt));
  }

  // ---------- Status changes ----------

  private async change(
    auth: AuthContext,
    enrollmentId: string,
    action: string,
    reason: string | null,
    next: (e: EnrollmentRow, t: TournamentRow) => EnrollmentStatus | null,
  ) {
    const row = await this.db.transaction(async (tx) => {
      const [found] = await tx.select().from(enrollments).where(eq(enrollments.id, enrollmentId));
      if (!found) throw new ApiError("NOT_FOUND", "No such entry.");
      const t = await this.lockTournament(tx, found.tournamentId);
      if (t.organiserUserId !== auth.userId && !isStaff(auth)) throw new ApiError("FORBIDDEN", "Only this tournament's organiser can do that.");
      const [e] = await tx.select().from(enrollments).where(eq(enrollments.id, enrollmentId));
      const status = next(e, t);
      if (!status) return e;

      const heldSpot = this.holdsSpot(e);
      const [updated] = await tx
        .update(enrollments)
        .set({ status, reviewNote: status === "rejected" ? reason : e.reviewNote, holdExpiresAt: status === "payment_pending" ? e.holdExpiresAt : null })
        .where(eq(enrollments.id, e.id))
        .returning();
      await this.audit.record({ entity: "enrollment", entityId: e.id, action, before: { status: e.status }, after: { status }, reason, userId: auth.userId }, tx);
      if (e.teamId) await this.syncTeam(tx, e.teamId);
      if (heldSpot && !this.holdsSpot(updated)) await this.promoteFromWaitlist(tx, t, e.eventId, e.categoryId);
      return updated;
    });
    return this.view(row);
  }

  /** When a place frees up, the earliest waitlisted entry for the same sport and category takes it. */
  private async promoteFromWaitlist(tx: Db, t: TournamentRow, eventId: string, categoryId: string | null) {
    const [event] = await tx.select().from(tournamentEvents).where(eq(tournamentEvents.id, eventId));
    const category = categoryId ? (await tx.select().from(categories).where(eq(categories.id, categoryId)))[0] : undefined;
    const unit = event.entryType === "team" ? "teams" : "players";
    if (await this.isFull(tx, event, category ?? null, unit)) return;

    const [next] = await tx
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.eventId, eventId),
          categoryId ? eq(enrollments.categoryId, categoryId) : isNull(enrollments.categoryId),
          eq(enrollments.status, "waitlisted"),
          unit === "teams" ? eq(enrollments.isCaptain, true) : sql`true`,
        ),
      )
      .orderBy(asc(enrollments.createdAt))
      .limit(1);
    if (!next) return;
    const s = this.startingStatus(t, false, next.feePaise);
    await tx.update(enrollments).set(s).where(eq(enrollments.id, next.id));
    await this.audit.record({ entity: "enrollment", entityId: next.id, action: "promote_from_waitlist", before: { status: "waitlisted" }, after: { status: s.status }, userId: null }, tx);
    if (next.teamId) await this.syncTeam(tx, next.teamId);
  }

  /** A team follows its captain's entry: confirmed once the captain is in, cancelled (with its members) if the captain is out. */
  async syncTeam(tx: Db, teamId: string) {
    const [captain] = await tx.select().from(enrollments).where(and(eq(enrollments.teamId, teamId), eq(enrollments.isCaptain, true))).orderBy(desc(enrollments.createdAt)).limit(1);
    if (!captain) return;
    const status = captain.status === "enrolled" ? "confirmed" : ["removed", "rejected", "expired"].includes(captain.status) ? "cancelled" : "pending";
    await tx.update(teams).set({ status }).where(eq(teams.id, teamId));
    if (status === "cancelled") {
      await tx
        .update(enrollments)
        .set({ status: "removed" })
        .where(and(eq(enrollments.teamId, teamId), eq(enrollments.isCaptain, false), inArray(enrollments.status, ["enrolled", "pending_review", "waitlisted"])));
    }
  }

  /** Unpaid entries past their 30 minutes stop holding a place (FR-PAY-07, AC-03). */
  async expireHolds(tx: Db, scope: { tournamentId?: string; playerIds?: string[] }) {
    const where: SQL[] = [eq(enrollments.status, "payment_pending"), lte(enrollments.holdExpiresAt, this.clock.now())];
    if (scope.tournamentId) where.push(eq(enrollments.tournamentId, scope.tournamentId));
    if (scope.playerIds) where.push(inArray(enrollments.playerId, scope.playerIds));
    const expired = await tx.update(enrollments).set({ status: "expired" }).where(and(...where)).returning({ teamId: enrollments.teamId });
    for (const { teamId } of expired) if (teamId) await this.syncTeam(tx, teamId);
  }

  // ---------- Checks shared by every way in ----------

  private async prepare(
    tx: Db,
    auth: AuthContext,
    t: TournamentRow,
    input: { playerId?: string; inviteCode?: string | null; guardian?: { name: string; phone: string } | null; answers: Record<string, unknown>; proofKey?: string | null },
    opts: { checkInvite: boolean },
  ): Promise<Prepared> {
    const now = this.clock.now();
    if (t.status === "draft") throw new ApiError("CONFLICT", "Registration hasn't opened yet.");
    if (t.status !== "enrollment_open") throw new ApiError("CONFLICT", "Registration is closed.");
    if (t.registrationDeadline && now > t.registrationDeadline) throw new ApiError("CONFLICT", "The registration deadline has passed.");

    const player = await this.playerFor(tx, auth, input.playerId);
    if (player.suspended) throw new ApiError("FORBIDDEN", "This player is suspended.");
    if (opts.checkInvite) await this.checkInvite(tx, auth, t, input.inviteCode ?? null);

    const fields = await this.formFields(tx, t);
    const { errors, answers } = validateAnswers(fields, input.answers ?? {});
    if (Object.keys(errors).length) throw new ApiError("BAD_REQUEST", Object.values(errors).join("; "), { fields: errors });

    // Fill empty profile fields from the form (System Design 4.2); never overwrite what the player already has.
    const fromForm = profileValuesFrom(fields, answers);
    const patch: Partial<typeof players.$inferInsert> = {};
    if (fromForm.name && !player.name) patch.name = fromForm.name;
    if (fromForm.gender && !player.gender && (fromForm.gender === "male" || fromForm.gender === "female")) patch.gender = fromForm.gender;
    if (fromForm.dob && !player.dob) patch.dob = fromForm.dob;
    if (fromForm.photoUrl && !player.photoUrl) patch.photoUrl = `/api/v1/uploads/${fromForm.photoUrl}`;
    if (fromForm.pincode && !player.pincode) {
      patch.pincode = fromForm.pincode;
      const [pin] = await tx.select().from(pincodes).where(eq(pincodes.pincode, fromForm.pincode));
      if (pin && !player.city) Object.assign(patch, { city: pin.city, state: pin.state });
    }
    const updated = Object.keys(patch).length ? (await tx.update(players).set(patch).where(eq(players.id, player.id)).returning())[0] : player;

    const formGender = fromForm.gender === "male" || fromForm.gender === "female" ? fromForm.gender : null;
    const facts = { dob: fromForm.dob ?? updated.dob, gender: formGender ?? updated.gender };

    const minor = !!facts.dob && isMinor(facts.dob, now.toISOString());
    const guardianMissing = minor && !(input.guardian?.name && input.guardian.phone);
    let guardian: GuardianConsent | null = null;
    if (minor && input.guardian && !guardianMissing) {
      const phone = toE164Mobile(input.guardian.phone);
      if (!phone) throw new ApiError("INVALID_PHONE", "Enter the guardian's 10-digit mobile number.");
      guardian = { name: input.guardian.name, phone, consentAt: now.toISOString() };
    }

    for (const f of fields) {
      const v = answers[f.key];
      if ((f.type === "photo" || f.type === "file") && typeof v === "string") await this.uploads.assertOwned(auth.userId, v, f.type === "photo" ? "photo" : "file", tx);
    }
    if (input.proofKey) await this.uploads.assertOwned(auth.userId, input.proofKey, "proof", tx);

    return { player: updated, answers, formVersion: t.formVersion, guardian, proofKey: input.proofKey ?? null, facts, guardianMissing };
  }

  /** Players under 18 need a parent or guardian's consent. */
  private requireGuardian(prep: Prepared) {
    if (prep.guardianMissing) throw new ApiError("BAD_REQUEST", "A parent or guardian must give consent for players under 18.");
  }

  private checkEligible(prep: Prepared, category: CategoryRow | null, t: TournamentRow, proofKey?: string | null) {
    if (!category) return;
    const ok = checkCategoryEligibility(prep.facts, { ...category, ageOn: category.ageOn ?? null }, t.startsAt.toISOString(), prep.answers);
    if (!ok.ok) throw new ApiError("BAD_REQUEST", `Not eligible for ${category.name}: ${ok.reason}`);
    if (category.proofRequired && !proofKey) throw new ApiError("BAD_REQUEST", `${category.name} needs an age proof upload.`);
  }

  private async playerFor(tx: Db, auth: AuthContext, playerId?: string): Promise<PlayerRow> {
    if (!playerId) {
      const [own] = await tx.select().from(players).where(eq(players.userId, auth.userId));
      if (!own) throw new ApiError("NOT_FOUND", "This account has no player profile.");
      return own;
    }
    const [p] = await tx.select().from(players).where(eq(players.id, playerId));
    if (!p || (p.userId !== auth.userId && p.managedByUserId !== auth.userId)) throw new ApiError("FORBIDDEN", "You can register only yourself or players you manage.");
    return p;
  }

  private async checkInvite(tx: Db, auth: AuthContext, t: TournamentRow, code: string | null) {
    if (t.visibility === "public") return;
    if (t.inviteMode === "list") {
      const [u] = await tx.select({ phone: users.phone }).from(users).where(eq(users.id, auth.userId));
      const [hit] = u?.phone ? await tx.select().from(tournamentInvites).where(and(eq(tournamentInvites.tournamentId, t.id), eq(tournamentInvites.phone, u.phone))) : [];
      if (!hit) throw new ApiError("FORBIDDEN", "Invite only: your number isn't on the organiser's list.");
      return;
    }
    const [link] = await tx.select().from(inviteLinks).where(eq(inviteLinks.tournamentId, t.id));
    const now = this.clock.now();
    if (!link || !code || link.code !== code.toUpperCase()) throw new ApiError("FORBIDDEN", "Invite only: ask the organiser for the link.");
    if (!link.active) throw new ApiError("FORBIDDEN", "This invite link has been turned off.");
    if (link.expiresAt && now > link.expiresAt) throw new ApiError("FORBIDDEN", "This invite link has expired.");
    if (link.maxUses !== null && link.uses >= link.maxUses) throw new ApiError("FORBIDDEN", "This invite link has been used up.");
  }

  private async useInviteLink(tx: Db, t: TournamentRow, code: string | null | undefined) {
    if (t.visibility === "private" && t.inviteMode === "link" && code) {
      await tx.update(inviteLinks).set({ uses: sql`${inviteLinks.uses} + 1` }).where(eq(inviteLinks.tournamentId, t.id));
    }
  }

  private async formFields(tx: Db, t: TournamentRow): Promise<FieldDef[]> {
    if (!t.formVersion) return [];
    const [row] = await tx.select().from(formVersions).where(and(eq(formVersions.tournamentId, t.id), eq(formVersions.version, t.formVersion)));
    return row?.fields ?? [];
  }

  private async eventAndCategory(tx: Db, t: TournamentRow, eventId: string, categoryId: string | null) {
    const [event] = await tx.select().from(tournamentEvents).where(and(eq(tournamentEvents.id, eventId), eq(tournamentEvents.tournamentId, t.id)));
    if (!event) throw new ApiError("BAD_REQUEST", "That sport isn't part of this tournament.");
    const cats = await tx.select().from(categories).where(eq(categories.eventId, event.id));
    if (!cats.length) return { event, category: null };
    const category = cats.find((c) => c.id === categoryId);
    if (!category) throw new ApiError("BAD_REQUEST", "Pick a category.");
    return { event, category };
  }

  /** Entries holding a place, counted per category when the sport has categories (FR-REG-15). */
  private async isFull(tx: Db, event: EventRow, category: CategoryRow | null, unit: "players" | "teams"): Promise<boolean> {
    const entries = category?.maxTeams ?? event.maxTeams;
    let limit: number | null;
    if (unit === "teams" || event.entryType === "individual") limit = entries;
    else limit = entries !== null && event.maxPlayersPerTeam !== null ? entries * event.maxPlayersPerTeam : null;
    if (limit === null) return false;

    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.eventId, event.id),
          category ? eq(enrollments.categoryId, category.id) : sql`true`,
          unit === "teams" ? eq(enrollments.isCaptain, true) : sql`true`,
          or(inArray(enrollments.status, ["enrolled", "pending_review"]), and(eq(enrollments.status, "payment_pending"), gt(enrollments.holdExpiresAt, this.clock.now()))),
        ),
      );
    return n >= limit;
  }

  private holdsSpot(e: EnrollmentRow) {
    if (e.status === "enrolled" || e.status === "pending_review") return true;
    return e.status === "payment_pending" && !!e.holdExpiresAt && e.holdExpiresAt > this.clock.now();
  }

  /** The player's live entry in this sport, after releasing an expired hold. */
  private async activeEntry(tx: Db, eventId: string, playerId: string): Promise<EnrollmentRow | undefined> {
    await tx
      .update(enrollments)
      .set({ status: "expired" })
      .where(and(eq(enrollments.eventId, eventId), eq(enrollments.playerId, playerId), eq(enrollments.status, "payment_pending"), lte(enrollments.holdExpiresAt, this.clock.now())));
    const [row] = await tx
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.eventId, eventId), eq(enrollments.playerId, playerId), inArray(enrollments.status, ["payment_pending", "pending_review", "enrolled", "waitlisted"])));
    return row;
  }

  /** Free → enrolled, or pending review with the add-on. Paid → payment pending with a 30-minute hold (Review comes after payment). */
  private startingStatus(t: TournamentRow, full: boolean, fee: number) {
    if (full) return { status: "waitlisted" as const, paymentStatus: "not_required" as const, holdExpiresAt: null };
    if (fee > 0) {
      return { status: "payment_pending" as const, paymentStatus: "pending" as const, holdExpiresAt: new Date(this.clock.now().getTime() + HOLD_MINUTES * 60_000) };
    }
    return { status: t.reviewRequired ? ("pending_review" as const) : ("enrolled" as const), paymentStatus: "not_required" as const, holdExpiresAt: null };
  }

  private async insertEntry(
    tx: Db,
    t: TournamentRow,
    event: EventRow,
    category: CategoryRow | null,
    prep: Prepared,
    auth: AuthContext,
    o: { full: boolean; fee: number; teamId?: string; isCaptain?: boolean; joinedVia?: "form" | "team_code" },
  ): Promise<EnrollmentRow> {
    const [row] = await tx
      .insert(enrollments)
      .values({
        registrationNo: `FPR-${randomCode(8)}`,
        tournamentId: t.id,
        eventId: event.id,
        categoryId: category?.id ?? null,
        playerId: prep.player.id,
        teamId: o.teamId ?? null,
        isCaptain: o.isCaptain ?? false,
        joinedVia: o.joinedVia ?? "form",
        feePaise: o.fee,
        registeredByUserId: auth.userId,
        guardian: prep.guardian,
        answers: prep.answers,
        formVersion: prep.formVersion,
        proofKey: prep.proofKey,
        createdAt: this.clock.now(),
        ...this.startingStatus(t, o.full, o.fee),
      })
      .returning();
    return row;
  }

  /** Locks the tournament row for this transaction, so two registrations can't both take the last place. */
  private async lockTournament(tx: Db, id: string): Promise<TournamentRow> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError("NOT_FOUND", "No such tournament.");
    const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, id)).for("update");
    if (!t) throw new ApiError("NOT_FOUND", "No such tournament.");
    return t;
  }

  private async manageable(tx: Db, auth: AuthContext, tournamentId: string): Promise<TournamentRow> {
    if (!/^[0-9a-f-]{36}$/i.test(tournamentId)) throw new ApiError("NOT_FOUND", "No such tournament.");
    const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, tournamentId));
    if (!t) throw new ApiError("NOT_FOUND", "No such tournament.");
    if (t.organiserUserId !== auth.userId && !isStaff(auth)) throw new ApiError("FORBIDDEN", "Only this tournament's organiser can do that.");
    return t;
  }

  private async teamWithCode(tx: Db, code: string): Promise<TeamRow> {
    const [team] = await tx.select().from(teams).where(eq(teams.code, code.trim().toUpperCase()));
    if (!team || team.status === "cancelled") throw new ApiError("NOT_FOUND", "No team with that code.");
    return team;
  }

  private async squadSize(tx: Db, teamId: string): Promise<number> {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(enrollments)
      .where(and(eq(enrollments.teamId, teamId), inArray(enrollments.status, ["enrolled", "pending_review", "payment_pending"])));
    return n;
  }

  private teamView(team: TeamRow, players: number) {
    return { id: team.id, tournamentId: team.tournamentId, eventId: team.eventId, categoryId: team.categoryId, name: team.name, code: team.code, color: team.color, status: team.status, players };
  }

  private async newTeamCode(tx: Db) {
    for (let i = 0; i < 5; i++) {
      const code = randomCode(6);
      if (!(await tx.select({ id: teams.id }).from(teams).where(eq(teams.code, code))).length) return code;
    }
    throw new ApiError("INTERNAL", "Could not create a team code. Please try again.");
  }

  private async newPlayerCode(tx: Db) {
    for (let i = 0; i < 5; i++) {
      const code = `FP${randomCode(6)}`;
      if (!(await tx.select({ id: players.id }).from(players).where(eq(players.playerCode, code))).length) return code;
    }
    throw new ApiError("INTERNAL", "Could not create a player id. Please try again.");
  }

  private summary(rows: EnrollmentRow[]) {
    const due = rows.filter((r) => r.status === "payment_pending");
    const holds = due.map((r) => r.holdExpiresAt!.getTime());
    return {
      enrollments: rows.map((r) => this.view(r)),
      /** Entry fees still to pay (paise). The convenience fee is added at checkout (week 3). */
      amountDuePaise: due.reduce((sum, r) => sum + r.feePaise, 0),
      holdExpiresAt: holds.length ? new Date(Math.min(...holds)).toISOString() : null,
    };
  }

  view(e: EnrollmentRow): EnrollmentView {
    const { updatedAt: _u, ...rest } = e;
    return { ...rest, createdAt: e.createdAt.toISOString(), holdExpiresAt: e.holdExpiresAt?.toISOString() ?? null };
  }
}

function answerText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.join("; ");
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
