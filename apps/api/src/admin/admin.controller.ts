import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { desc, eq, lt, and, type SQL } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, FEE_SETTINGS_KEY, settings, type Db, type FeeSettings } from "@force-pulse/db";
import { ROLES } from "@force-pulse/shared";
import { ApiError } from "../common/api-error";
import { AuditService } from "../common/audit.service";
import { CurrentAuth, RequireRole, type AuthContext } from "../common/policy";
import { DB } from "../common/tokens";
import { parse } from "../common/validate";
import { PlayersService } from "../players/players.service";
import { RolesService } from "../roles/roles.service";

const Reason = z.object({ reason: z.string().trim().max(500).optional() });
const PlatformRoleInput = z.object({ platformRole: z.enum(["player", "admin", "super_admin"]) });
const RoleParam = z.enum(ROLES);
const FeesInput = z
  .object({
    platformFeeBps: z.number().int().min(0).max(2_000),
    convenienceFeePaidByPlayer: z.boolean(),
    gstBps: z.number().int().min(0).max(2_800),
  })
  .strict();
const AuditQuery = z.object({
  entity: z.string().max(40).optional(),
  entityId: z.string().max(120).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

@Controller("admin")
export class AdminController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly roles: RolesService,
    private readonly players: PlayersService,
    private readonly audit: AuditService,
  ) {}

  @Get("users/:id/roles")
  @RequireRole("admin")
  userRoles(@Param("id", ParseUUIDPipe) id: string) {
    return this.roles.state(id);
  }

  /** FR-AUTH-07: suspend any role on any account. Signs the user out everywhere. */
  @Post("users/:id/roles/:role/suspend")
  @HttpCode(200)
  @RequireRole("super_admin")
  suspendRole(@Param("id", ParseUUIDPipe) id: string, @Param("role") role: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.roles.setSuspended(auth.userId, id, parse(RoleParam, role), true, parse(Reason, body ?? {}).reason ?? null);
  }

  @Post("users/:id/roles/:role/restore")
  @HttpCode(200)
  @RequireRole("super_admin")
  restoreRole(@Param("id", ParseUUIDPipe) id: string, @Param("role") role: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.roles.setSuspended(auth.userId, id, parse(RoleParam, role), false, parse(Reason, body ?? {}).reason ?? null);
  }

  /** Web app's patchUserRole: make someone a player, admin or super admin. */
  @Put("users/:id/platform-role")
  @RequireRole("super_admin")
  setPlatformRole(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.roles.setPlatformRole(auth.userId, id, parse(PlatformRoleInput, body).platformRole);
  }

  @Post("players/:id/suspend")
  @HttpCode(200)
  @RequireRole("super_admin")
  suspendPlayer(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.players.setSuspended(auth.userId, id, true, parse(Reason, body ?? {}).reason ?? null);
  }

  @Post("players/:id/restore")
  @HttpCode(200)
  @RequireRole("super_admin")
  restorePlayer(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.players.setSuspended(auth.userId, id, false, parse(Reason, body ?? {}).reason ?? null);
  }

  @Get("settings/fees")
  @RequireRole("admin")
  async fees(): Promise<FeeSettings> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, FEE_SETTINGS_KEY));
    if (!row) throw new ApiError("NOT_FOUND", "Fee settings are missing. Run the seed.");
    return row.value as FeeSettings;
  }

  /** FR-ADM-03. New rates apply to payments made after the change; past payments keep their frozen rates. */
  @Put("settings/fees")
  @RequireRole("super_admin")
  async setFees(@Body() body: unknown, @CurrentAuth() auth: AuthContext): Promise<FeeSettings> {
    const value: FeeSettings = parse(FeesInput, body);
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(settings).where(eq(settings.key, FEE_SETTINGS_KEY));
      await tx
        .insert(settings)
        .values({ key: FEE_SETTINGS_KEY, value, updatedBy: auth.userId })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: auth.userId, updatedAt: new Date() } });
      await this.audit.record({ entity: "fee_settings", entityId: FEE_SETTINGS_KEY, action: "update", before: before?.value ?? null, after: value, userId: auth.userId }, tx);
      return value;
    });
  }

  /** FR-ADM-05. Newest first; page with ?before=<last id>. */
  @Get("audit-logs")
  @RequireRole("admin")
  auditLogs(@Query() query: unknown) {
    const q = parse(AuditQuery, query);
    const where: SQL[] = [];
    if (q.entity) where.push(eq(auditLogs.entity, q.entity));
    if (q.entityId) where.push(eq(auditLogs.entityId, q.entityId));
    if (q.before) where.push(lt(auditLogs.id, q.before));
    return this.db.select().from(auditLogs).where(and(...where)).orderBy(desc(auditLogs.id)).limit(q.limit);
  }
}
