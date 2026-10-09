import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { sessions, userRoles, users, type Db } from "@force-pulse/db";
import { STAFF_ROLES, type PlatformRole, type Role } from "@force-pulse/shared";
import { ApiError } from "../common/api-error";
import { AuditService } from "../common/audit.service";
import { EventBus } from "../common/event-bus";
import { CLOCK, DB, type Clock } from "../common/tokens";

export interface RoleState {
  roles: Role[];
  suspendedRoles: Role[];
}

@Injectable()
export class RolesService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  // Roles are granted by what people do, not by forms (System Design 4.1).
  onModuleInit() {
    this.events.on("TournamentCreated", (e) => this.grant(e.organiserUserId, "organiser", "tournament_created").then(() => undefined));
    this.events.on("ScorerAssigned", (e) => this.grant(e.scorerUserId, "scorer", "scorer_assigned").then(() => undefined));
    this.events.on("MatchStartedBy", (e) => this.grant(e.userId, "scorer", "match_started").then(() => undefined));
  }

  /** Adds a role if the user doesn't have it. Returns true only when a new row was written. */
  async grant(userId: string, role: Role, grantedByAction: string, tx: Db = this.db): Promise<boolean> {
    const rows = await tx
      .insert(userRoles)
      .values({ userId, role, grantedByAction, grantedAt: this.clock.now() })
      .onConflictDoNothing()
      .returning({ role: userRoles.role });
    return rows.length > 0;
  }

  async state(userId: string, tx: Db = this.db): Promise<RoleState> {
    const rows = await tx.select({ role: userRoles.role, suspended: userRoles.suspended }).from(userRoles).where(eq(userRoles.userId, userId));
    return {
      roles: rows.filter((r) => !r.suspended).map((r) => r.role),
      suspendedRoles: rows.filter((r) => r.suspended).map((r) => r.role),
    };
  }

  /** Suspends or restores one role (FR-AUTH-07). Suspending signs the user out everywhere. */
  async setSuspended(actorId: string, userId: string, role: Role, suspended: boolean, reason: string | null): Promise<RoleState> {
    if (suspended && actorId === userId && role === "super_admin") {
      throw new ApiError("FORBIDDEN", "You can't suspend your own super admin role.");
    }
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(userRoles)
        .set({ suspended })
        .where(and(eq(userRoles.userId, userId), eq(userRoles.role, role)))
        .returning();
      if (!row) throw new ApiError("NOT_FOUND", "This account doesn't have that role.");
      if (suspended) await this.revokeSessions(userId, tx);
      await this.audit.record(
        { entity: "user_role", entityId: `${userId}:${role}`, action: suspended ? "suspend" : "restore", before: { suspended: !suspended }, after: { suspended }, reason, userId: actorId },
        tx,
      );
      return this.state(userId, tx);
    });
  }

  /** Sets the web app's platformRole by adding or removing the admin / super_admin rows. */
  async setPlatformRole(actorId: string, userId: string, platformRole: PlatformRole): Promise<RoleState> {
    if (actorId === userId && platformRole !== "super_admin") {
      throw new ApiError("FORBIDDEN", "You can't remove your own super admin access.");
    }
    const wanted: Role[] = platformRole === "super_admin" ? ["admin", "super_admin"] : platformRole === "admin" ? ["admin"] : [];
    return this.db.transaction(async (tx) => {
      const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
      if (!user) throw new ApiError("NOT_FOUND", "No such user.");
      const before = await this.state(userId, tx);
      const remove = STAFF_ROLES.filter((r) => !wanted.includes(r));
      if (remove.length) await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), inArray(userRoles.role, remove)));
      for (const role of wanted) await this.grant(userId, role, `staff:${actorId}`, tx);
      await this.revokeSessions(userId, tx);
      const after = await this.state(userId, tx);
      await this.audit.record({ entity: "user", entityId: userId, action: "set_platform_role", before, after, userId: actorId }, tx);
      return after;
    });
  }

  private async revokeSessions(userId: string, tx: Db) {
    await tx.update(sessions).set({ revokedAt: this.clock.now() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }
}
