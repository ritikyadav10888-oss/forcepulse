import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import {
  categories,
  enrollments,
  formVersions,
  inviteLinks,
  sports,
  tournamentEvents,
  tournamentInvites,
  tournaments,
  type Db,
  type TournamentStatus,
} from "@force-pulse/db";
import { checkFormDefinition, toE164Mobile, type FieldDef } from "@force-pulse/shared";
import { ApiError } from "../common/api-error";
import { AuditService } from "../common/audit.service";
import { randomCode, slugify } from "../common/codes";
import { EventBus } from "../common/event-bus";
import type { AuthContext } from "../common/policy";
import { CLOCK, DB, type Clock } from "../common/tokens";
import type { CreateTournamentInput, EventInput, InviteLinkInput, ListQuery, UpdateTournamentInput } from "./tournament.schemas";

type TournamentRow = typeof tournaments.$inferSelect;
type EventRow = typeof tournamentEvents.$inferSelect;
type CategoryRow = typeof categories.$inferSelect;
type EventInputT = z.infer<typeof EventInput>;

export type CategoryView = Omit<CategoryRow, "eventId" | "position">;
export type EventView = Omit<EventRow, "tournamentId" | "position"> & { categories: CategoryView[] };
export type TournamentView = Omit<TournamentRow, "formDraft" | "startsAt" | "endsAt" | "registrationDeadline" | "createdAt" | "updatedAt"> & {
  startsAt: string;
  endsAt: string;
  registrationDeadline: string | null;
  createdAt: string;
  /** Path of the registration link (FR-TRN-02); the web app turns it into a URL and QR code. */
  registrationPath: string;
  isPaid: boolean;
  events: EventView[];
};

/** Which status may follow which. enrollment_closed can reopen; nothing goes back once teams form. */
const NEXT_STATUS: Record<TournamentStatus, TournamentStatus[]> = {
  draft: ["enrollment_open"],
  enrollment_open: ["enrollment_closed", "draft"],
  enrollment_closed: ["enrollment_open", "team_formation", "fixtures_published"],
  team_formation: ["fixtures_published"],
  fixtures_published: ["live"],
  live: ["completed"],
  completed: [],
};

const isStaff = (auth?: AuthContext) => !!auth?.roles.includes("super_admin");

@Injectable()
export class TournamentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  // ---------- Create and edit ----------

  /** FR-TRN-01. Any player may create one; the Organiser role follows from the event (FR-AUTH-03). */
  async create(auth: AuthContext, input: CreateTournamentInput): Promise<TournamentView> {
    this.checkDates(input.startsAt, input.endsAt, input.registrationDeadline);
    const eventRows = await this.checkEvents(input.events);
    const { events: _events, ...details } = input;

    const id = await this.db.transaction(async (tx) => {
      const [t] = await tx
        .insert(tournaments)
        .values({
          ...details,
          name: details.name.trim(),
          organiserUserId: auth.userId,
          slug: `${slugify(details.name)}-${randomCode(5).toLowerCase()}`,
          startsAt: new Date(details.startsAt),
          endsAt: new Date(details.endsAt),
          registrationDeadline: details.registrationDeadline ? new Date(details.registrationDeadline) : null,
          inviteMode: details.visibility === "private" ? (details.inviteMode ?? "link") : null,
        })
        .returning();
      await this.insertEvents(tx, t.id, eventRows);
      if (t.inviteMode === "link") await tx.insert(inviteLinks).values({ tournamentId: t.id, code: randomCode(10) });
      return t.id;
    });

    await this.events.publish({ type: "TournamentCreated", tournamentId: id, organiserUserId: auth.userId });
    return this.view(await this.row(id));
  }

  async update(auth: AuthContext, id: string, input: UpdateTournamentInput, sentKeys: string[]): Promise<TournamentView> {
    const t = await this.manageable(auth, id);
    const patch = Object.fromEntries(Object.entries(input).filter(([k]) => sentKeys.includes(k))) as UpdateTournamentInput;

    const startsAt = patch.startsAt ?? t.startsAt.toISOString();
    const endsAt = patch.endsAt ?? t.endsAt.toISOString();
    const deadline = patch.registrationDeadline !== undefined ? patch.registrationDeadline : (t.registrationDeadline?.toISOString() ?? null);
    this.checkDates(startsAt, endsAt, deadline);

    const visibility = patch.visibility ?? t.visibility;
    const inviteMode = visibility === "private" ? (patch.inviteMode ?? t.inviteMode ?? "link") : null;

    await this.db.transaction(async (tx) => {
      await tx
        .update(tournaments)
        .set({
          ...patch,
          ...(patch.name ? { name: patch.name.trim() } : {}),
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          registrationDeadline: deadline ? new Date(deadline) : null,
          visibility,
          inviteMode,
        })
        .where(eq(tournaments.id, id));
      if (inviteMode === "link") await tx.insert(inviteLinks).values({ tournamentId: id, code: randomCode(10) }).onConflictDoNothing();
    });
    return this.view(await this.row(id));
  }

  /** Replaces sports and categories. Only before anyone has registered: entries point at them. */
  async replaceEvents(auth: AuthContext, id: string, events: EventInputT[]): Promise<TournamentView> {
    await this.manageable(auth, id);
    const eventRows = await this.checkEvents(events);
    await this.db.transaction(async (tx) => {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(enrollments).where(eq(enrollments.tournamentId, id));
      if (n > 0) throw new ApiError("CONFLICT", "Players have registered, so sports and categories can't be replaced any more.");
      await tx.delete(tournamentEvents).where(eq(tournamentEvents.tournamentId, id));
      await this.insertEvents(tx, id, eventRows);
    });
    return this.view(await this.row(id));
  }

  async setStatus(auth: AuthContext, id: string, status: TournamentStatus): Promise<TournamentView> {
    const t = await this.manageable(auth, id);
    if (t.status === status) return this.view(t);
    if (!NEXT_STATUS[t.status].includes(status)) {
      throw new ApiError("CONFLICT", `A tournament can't go from ${t.status.replace(/_/g, " ")} to ${status.replace(/_/g, " ")}.`);
    }
    if (status === "enrollment_open" && t.formVersion === 0 && t.formDraft.length > 0) {
      throw new ApiError("CONFLICT", "Publish the registration form before opening registration.");
    }
    await this.db.transaction(async (tx) => {
      await tx.update(tournaments).set({ status }).where(eq(tournaments.id, id));
      await this.audit.record({ entity: "tournament", entityId: id, action: "set_status", before: { status: t.status }, after: { status }, userId: auth.userId }, tx);
    });
    if (t.status === "enrollment_open" && status !== "draft") {
      await this.events.publish({ type: "RegistrationClosed", tournamentId: id, closedAt: this.clock.now().toISOString() });
    }
    return this.view(await this.row(id));
  }

  // ---------- Read ----------

  /** By id or slug. Drafts are visible only to their organiser and super admin. */
  async get(idOrSlug: string, viewer?: AuthContext): Promise<TournamentView> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const [t] = await this.db.select().from(tournaments).where(isUuid ? eq(tournaments.id, idOrSlug) : eq(tournaments.slug, idOrSlug));
    if (!t || (t.status === "draft" && t.organiserUserId !== viewer?.userId && !isStaff(viewer))) {
      throw new ApiError("NOT_FOUND", "No such tournament.");
    }
    return this.view(t);
  }

  /** Public directory (web app rule 13): public and not draft. */
  async list(q: z.infer<typeof ListQuery>): Promise<TournamentView[]> {
    const where: SQL[] = [eq(tournaments.visibility, "public"), ne(tournaments.status, "draft")];
    if (q.status) where.push(eq(tournaments.status, q.status));
    if (q.city) where.push(ilike(tournaments.city, q.city));
    if (q.q) where.push(or(ilike(tournaments.name, `%${q.q.replace(/[%_\\]/g, "\\$&")}%`), ilike(tournaments.city, `%${q.q.replace(/[%_\\]/g, "\\$&")}%`))!);
    if (q.sportId) {
      where.push(sql`exists (select 1 from ${tournamentEvents} where ${tournamentEvents.tournamentId} = ${tournaments.id} and ${tournamentEvents.sportId} = ${q.sportId})`);
    }
    const rows = await this.db.select().from(tournaments).where(and(...where)).orderBy(asc(tournaments.startsAt)).limit(q.limit).offset(q.offset);
    return this.views(rows);
  }

  async mine(userId: string): Promise<TournamentView[]> {
    const rows = await this.db.select().from(tournaments).where(eq(tournaments.organiserUserId, userId)).orderBy(desc(tournaments.createdAt));
    return this.views(rows);
  }

  // ---------- Registration form (FR-REG-03/04, System Design 4.2) ----------

  async form(auth: AuthContext, id: string) {
    const t = await this.manageable(auth, id);
    return { draft: t.formDraft, publishedVersion: t.formVersion, published: await this.publishedFields(id, t.formVersion) };
  }

  async saveForm(auth: AuthContext, id: string, fields: FieldDef[]) {
    await this.manageable(auth, id);
    const problems = checkFormDefinition(fields);
    if (problems.length) throw new ApiError("BAD_REQUEST", problems.join("; "), { problems });
    await this.db.update(tournaments).set({ formDraft: fields }).where(eq(tournaments.id, id));
    return this.form(auth, id);
  }

  /** Freezes the draft as a new version. Entries made earlier keep their own version. */
  async publishForm(auth: AuthContext, id: string) {
    const t = await this.manageable(auth, id);
    const problems = checkFormDefinition(t.formDraft);
    if (problems.length) throw new ApiError("BAD_REQUEST", problems.join("; "), { problems });
    const version = t.formVersion + 1;
    await this.db.transaction(async (tx) => {
      await tx.insert(formVersions).values({ tournamentId: id, version, fields: t.formDraft, publishedAt: this.clock.now() });
      await tx.update(tournaments).set({ formVersion: version }).where(eq(tournaments.id, id));
    });
    return this.form(auth, id);
  }

  async publishedFields(tournamentId: string, version: number): Promise<FieldDef[]> {
    if (version === 0) return [];
    const [row] = await this.db
      .select({ fields: formVersions.fields })
      .from(formVersions)
      .where(and(eq(formVersions.tournamentId, tournamentId), eq(formVersions.version, version)));
    return row?.fields ?? [];
  }

  /** What the registration page needs: the tournament, its sports and categories, and the live form. */
  async registrationPage(slug: string, viewer?: AuthContext) {
    const t = await this.get(slug, viewer);
    return { tournament: t, form: { version: t.formVersion, fields: await this.publishedFields(t.id, t.formVersion) } };
  }

  // ---------- Private tournaments ----------

  async invites(auth: AuthContext, id: string) {
    await this.manageable(auth, id);
    return this.db.select().from(tournamentInvites).where(eq(tournamentInvites.tournamentId, id)).orderBy(asc(tournamentInvites.addedAt));
  }

  async addInvite(auth: AuthContext, id: string, rawPhone: string, name: string) {
    await this.manageable(auth, id);
    const phone = toE164Mobile(rawPhone);
    if (!phone) throw new ApiError("INVALID_PHONE", "Enter a valid 10-digit Indian mobile number.");
    const [row] = await this.db
      .insert(tournamentInvites)
      .values({ tournamentId: id, phone, name, addedAt: this.clock.now() })
      .onConflictDoUpdate({ target: [tournamentInvites.tournamentId, tournamentInvites.phone], set: { name } })
      .returning();
    return row;
  }

  async removeInvite(auth: AuthContext, id: string, rawPhone: string) {
    await this.manageable(auth, id);
    const phone = toE164Mobile(rawPhone) ?? rawPhone;
    await this.db.delete(tournamentInvites).where(and(eq(tournamentInvites.tournamentId, id), eq(tournamentInvites.phone, phone)));
  }

  async inviteLink(auth: AuthContext, id: string) {
    await this.manageable(auth, id);
    const [link] = await this.db.select().from(inviteLinks).where(eq(inviteLinks.tournamentId, id));
    if (!link) throw new ApiError("NOT_FOUND", "This tournament has no invite link. Make it private with link invites first.");
    return link;
  }

  async updateInviteLink(auth: AuthContext, id: string, patch: z.infer<typeof InviteLinkInput>, reset: boolean) {
    await this.inviteLink(auth, id);
    const [link] = await this.db
      .update(inviteLinks)
      .set({
        ...(patch.maxUses !== undefined ? { maxUses: patch.maxUses } : {}),
        ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt ? new Date(patch.expiresAt) : null } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        ...(reset ? { code: randomCode(10), uses: 0 } : {}),
      })
      .where(eq(inviteLinks.tournamentId, id))
      .returning();
    return link;
  }

  // ---------- Helpers ----------

  /** The tournament, if the caller organises it or is super admin (FR-AUTH-06, web app rule 8). */
  async manageable(auth: AuthContext, id: string): Promise<TournamentRow> {
    const t = await this.row(id);
    if (t.organiserUserId !== auth.userId && !isStaff(auth)) throw new ApiError("FORBIDDEN", "Only this tournament's organiser can do that.");
    return t;
  }

  async row(id: string): Promise<TournamentRow> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError("NOT_FOUND", "No such tournament.");
    const [t] = await this.db.select().from(tournaments).where(eq(tournaments.id, id));
    if (!t) throw new ApiError("NOT_FOUND", "No such tournament.");
    return t;
  }

  async view(t: TournamentRow): Promise<TournamentView> {
    return (await this.views([t]))[0];
  }

  private async views(rows: TournamentRow[]): Promise<TournamentView[]> {
    if (!rows.length) return [];
    const ids = rows.map((t) => t.id);
    const evs = await this.db.select().from(tournamentEvents).where(inArray(tournamentEvents.tournamentId, ids)).orderBy(asc(tournamentEvents.position));
    const cats = evs.length
      ? await this.db.select().from(categories).where(inArray(categories.eventId, evs.map((e) => e.id))).orderBy(asc(categories.position))
      : [];
    return rows.map(({ formDraft: _d, updatedAt: _u, ...t }) => {
      const events: EventView[] = evs
        .filter((e) => e.tournamentId === t.id)
        .map(({ tournamentId: _t, position: _p, ...e }) => ({
          ...e,
          categories: cats.filter((c) => c.eventId === e.id).map(({ eventId: _e, position: _q, ...c }) => c),
        }));
      return {
        ...t,
        startsAt: t.startsAt.toISOString(),
        endsAt: t.endsAt.toISOString(),
        registrationDeadline: t.registrationDeadline?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
        registrationPath: `/t/${t.slug}`,
        isPaid: events.some((e) => e.feePaise > 0 || e.categories.some((c) => (c.feePaise ?? 0) > 0)),
        events,
      };
    });
  }

  private checkDates(startsAt: string, endsAt: string, deadline: string | null) {
    if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new ApiError("BAD_REQUEST", "End must be after start.");
    if (deadline && Date.parse(deadline) > Date.parse(endsAt)) throw new ApiError("BAD_REQUEST", "Registration must close before the tournament ends.");
  }

  /** Same checks as the web app's buildEvents, done again here because the client can't be trusted. */
  private async checkEvents(events: EventInputT[]): Promise<EventInputT[]> {
    const ids = events.map((e) => e.sportId);
    const known = await this.db.select({ id: sports.id, name: sports.name }).from(sports).where(and(inArray(sports.id, ids), eq(sports.active, true)));
    const name = (id: string) => known.find((s) => s.id === id)?.name ?? id;
    const seen = new Set<string>();
    return events.map((e) => {
      if (!known.some((s) => s.id === e.sportId)) throw new ApiError("BAD_REQUEST", `Unknown sport: ${e.sportId}`);
      if (seen.has(e.sportId)) throw new ApiError("BAD_REQUEST", `${name(e.sportId)} is added twice. Use categories instead.`);
      seen.add(e.sportId);
      const individual = e.entryType === "individual";
      if (!individual && e.minPlayersPerTeam && e.maxPlayersPerTeam && e.minPlayersPerTeam > e.maxPlayersPerTeam) {
        throw new ApiError("BAD_REQUEST", `${name(e.sportId)}: minimum players per team is above the maximum.`);
      }
      const names = new Set<string>();
      for (const c of e.categories) {
        const key = c.name.trim().toLowerCase();
        if (names.has(key)) throw new ApiError("BAD_REQUEST", `${name(e.sportId)}: category "${c.name}" is added twice.`);
        names.add(key);
        if (c.minAge !== null && c.underAge !== null && c.minAge >= c.underAge) {
          throw new ApiError("BAD_REQUEST", `${c.name}: the minimum age must be below the upper age limit.`);
        }
      }
      return {
        ...e,
        poolFormation: e.entryType === "pooled" ? (e.poolFormation ?? "organizer_assigns") : null,
        minPlayersPerTeam: individual ? null : e.minPlayersPerTeam,
        maxPlayersPerTeam: individual ? null : e.maxPlayersPerTeam,
      };
    });
  }

  private async insertEvents(tx: Db, tournamentId: string, events: EventInputT[]) {
    for (const [position, { categories: cats, ...e }] of events.entries()) {
      const [ev] = await tx.insert(tournamentEvents).values({ ...e, tournamentId, position }).returning({ id: tournamentEvents.id });
      if (cats.length) await tx.insert(categories).values(cats.map((c, i) => ({ ...c, name: c.name.trim(), eventId: ev.id, position: i })));
    }
  }
}
