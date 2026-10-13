import { Body, Controller, Get, HttpCode, Inject, Ip, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  cmsPages,
  contactMessages,
  enrollments,
  payments,
  players,
  playerSports,
  privacyRequests,
  sessions,
  users,
  type Db,
} from "@force-pulse/db";
import { ApiError } from "./common/api-error";
import { AuditService } from "./common/audit.service";
import { Authenticated, CurrentAuth, Public, RequireRole, type AuthContext } from "./common/policy";
import { CLOCK, DB, type Clock } from "./common/tokens";
import { parse } from "./common/validate";

const PageInput = z.object({ title: z.string().trim().min(1).max(120), body: z.string().max(50_000) }).strict();
const ContactInput = z.object({ name: z.string().trim().min(1).max(80), contact: z.string().trim().min(5).max(120), message: z.string().trim().min(5).max(3000) }).strict();
const DeletionInput = z.object({ reason: z.string().trim().max(500).default("") }).strict();

/**
 * Site pages and the contact form (FR-ABT-01/02), and privacy rights under the DPDP Act 2023 (NFR-10):
 * download your data, ask for deletion. Deletion anonymises the account; payment records stay as the law requires.
 */
@Controller()
export class SiteController {
  // shortcut: in-memory per-address limit for the contact form; move to Redis when the API runs on several servers.
  private readonly contactHits = new Map<string, number[]>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  // ---------- Pages ----------

  @Get("pages/:slug")
  @Public()
  async page(@Param("slug") slug: string) {
    const [p] = await this.db.select({ slug: cmsPages.slug, title: cmsPages.title, body: cmsPages.body, updatedAt: cmsPages.updatedAt }).from(cmsPages).where(eq(cmsPages.slug, slug));
    if (!p) throw new ApiError("NOT_FOUND", "No such page.");
    return p;
  }

  @Get("pages")
  @Public()
  pages() {
    return this.db.select({ slug: cmsPages.slug, title: cmsPages.title }).from(cmsPages);
  }

  @Put("admin/pages/:slug")
  @RequireRole("super_admin")
  async savePage(@Param("slug") slug: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) throw new ApiError("BAD_REQUEST", "Page address: lowercase letters, digits and dashes.");
    const input = parse(PageInput, body);
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(cmsPages).where(eq(cmsPages.slug, slug));
      const values = { ...input, updatedAt: this.clock.now(), updatedByUserId: auth.userId };
      const [row] = await tx.insert(cmsPages).values({ slug, ...values }).onConflictDoUpdate({ target: cmsPages.slug, set: values }).returning();
      await this.audit.record({ entity: "cms_page", entityId: slug, action: before ? "update" : "create", before: before ? { title: before.title } : null, after: { title: row.title }, userId: auth.userId }, tx);
      return row;
    });
  }

  // ---------- Contact ----------

  @Post("contact")
  @HttpCode(201)
  @Public()
  async contact(@Body() body: unknown, @Ip() ip: string) {
    const now = this.clock.now().getTime();
    const hits = (this.contactHits.get(ip) ?? []).filter((t) => now - t < 3600_000);
    if (hits.length >= 5) throw new ApiError("RATE_LIMITED", "Too many messages. Please try again in an hour.");
    this.contactHits.set(ip, [...hits, now]);
    await this.db.insert(contactMessages).values({ ...parse(ContactInput, body), createdAt: this.clock.now() });
    return { received: true };
  }

  @Get("admin/contact-messages")
  @RequireRole("admin")
  messages() {
    return this.db.select().from(contactMessages).where(eq(contactMessages.handled, false)).orderBy(desc(contactMessages.createdAt)).limit(200);
  }

  @Post("admin/contact-messages/:id/handled")
  @HttpCode(204)
  @RequireRole("admin")
  async handled(@Param("id", ParseUUIDPipe) id: string) {
    await this.db.update(contactMessages).set({ handled: true }).where(eq(contactMessages.id, id));
  }

  // ---------- Privacy (NFR-10) ----------

  /** Everything Force Pulse holds about the caller, as one JSON download. */
  @Get("me/data")
  @Authenticated()
  async myData(@CurrentAuth() auth: AuthContext) {
    const [user] = await this.db.select({ id: users.id, phone: users.phone, email: users.email, createdAt: users.createdAt }).from(users).where(eq(users.id, auth.userId));
    const [player] = await this.db.select().from(players).where(eq(players.userId, auth.userId));
    return {
      exportedAt: this.clock.now().toISOString(),
      user,
      player: player ?? null,
      sports: player ? await this.db.select().from(playerSports).where(eq(playerSports.playerId, player.id)) : [],
      registrations: player ? await this.db.select().from(enrollments).where(eq(enrollments.playerId, player.id)) : [],
      payments: await this.db.select().from(payments).where(eq(payments.payerUserId, auth.userId)),
      privacyRequests: await this.db.select().from(privacyRequests).where(eq(privacyRequests.userId, auth.userId)),
    };
  }

  @Post("me/deletion-request")
  @Authenticated()
  async requestDeletion(@Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    const { reason } = parse(DeletionInput, body);
    const [open] = await this.db.select().from(privacyRequests).where(and(eq(privacyRequests.userId, auth.userId), eq(privacyRequests.status, "pending")));
    if (open) return open;
    const [row] = await this.db.insert(privacyRequests).values({ userId: auth.userId, kind: "deletion", reason, createdAt: this.clock.now() }).returning();
    return row;
  }

  @Get("admin/privacy-requests")
  @RequireRole("super_admin")
  requests() {
    return this.db
      .select({ id: privacyRequests.id, userId: privacyRequests.userId, reason: privacyRequests.reason, createdAt: privacyRequests.createdAt, phone: users.phone, name: players.name })
      .from(privacyRequests)
      .innerJoin(users, eq(users.id, privacyRequests.userId))
      .leftJoin(players, eq(players.userId, privacyRequests.userId))
      .where(eq(privacyRequests.status, "pending"))
      .orderBy(privacyRequests.createdAt);
  }

  /**
   * Deletes the person from Force Pulse: profile details cleared, mobile and email removed, account closed and signed
   * out. Results stay (shown as "Deleted player") so other players' tables don't break; payments stay by law.
   */
  @Post("admin/privacy-requests/:id/complete")
  @HttpCode(200)
  @RequireRole("super_admin")
  async complete(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(privacyRequests).where(and(eq(privacyRequests.id, id), eq(privacyRequests.status, "pending"))).for("update");
      if (!r) throw new ApiError("NOT_FOUND", "No open request with that id.");
      const now = this.clock.now();
      await tx.update(players).set({ name: "Deleted player", photoUrl: "", gender: null, dob: null, pincode: null, city: "", state: "" }).where(eq(players.userId, r.userId));
      await tx.update(users).set({ phone: null, email: null, status: "suspended" }).where(eq(users.id, r.userId));
      await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, r.userId), isNull(sessions.revokedAt)));
      const [done] = await tx.update(privacyRequests).set({ status: "done", processedAt: now }).where(eq(privacyRequests.id, id)).returning();
      await this.audit.record({ entity: "user", entityId: r.userId, action: "delete_personal_data", reason: r.reason || null, userId: auth.userId }, tx);
      return done;
    });
  }
}
