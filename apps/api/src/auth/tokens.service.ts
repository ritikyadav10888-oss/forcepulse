import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { and, eq, gt, isNull } from "drizzle-orm";
import { sessions, users, type Db } from "@force-pulse/db";
import type { Role } from "@force-pulse/shared";
import { ApiError } from "../common/api-error";
import { CLOCK, DB, type Clock } from "../common/tokens";

// System Design 10: JWT access token for 15 minutes, refresh token for 30 days.
export const ACCESS_TOKEN_SECONDS = 15 * 60;
export const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;

export interface AccessPayload {
  sub: string;
  sid: string;
  /** For the UI only (role switcher). Every call re-checks roles in the database. */
  roles: Role[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const newRefreshToken = () => randomBytes(32).toString("base64url");

@Injectable()
export class TokensService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly jwt: JwtService,
  ) {}

  async startSession(userId: string, roles: Role[], userAgent: string | null, tx: Db = this.db): Promise<TokenPair> {
    const refreshToken = newRefreshToken();
    const [session] = await tx
      .insert(sessions)
      .values({ userId, refreshHash: sha256(refreshToken), expiresAt: this.refreshExpiry(), userAgent, createdAt: this.clock.now() })
      .returning({ id: sessions.id });
    return { accessToken: await this.sign(userId, session.id, roles), refreshToken, expiresInSeconds: ACCESS_TOKEN_SECONDS };
  }

  /** Swaps a refresh token for a new pair. The old refresh token stops working (rotation). */
  async refresh(refreshToken: string, rolesOf: (userId: string) => Promise<Role[]>): Promise<TokenPair> {
    const now = this.clock.now();
    const [session] = await this.db
      .select({ id: sessions.id, userId: sessions.userId, status: users.status })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.refreshHash, sha256(refreshToken)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)));
    if (!session) throw new ApiError("UNAUTHENTICATED", "Please sign in again.");
    if (session.status !== "active") throw new ApiError("ACCOUNT_SUSPENDED", "This account is suspended.");

    const next = newRefreshToken();
    const rotated = await this.db
      .update(sessions)
      .set({ refreshHash: sha256(next), expiresAt: this.refreshExpiry() })
      .where(and(eq(sessions.id, session.id), eq(sessions.refreshHash, sha256(refreshToken)), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (!rotated.length) throw new ApiError("UNAUTHENTICATED", "Please sign in again.");

    const roles = await rolesOf(session.userId);
    return { accessToken: await this.sign(session.userId, session.id, roles), refreshToken: next, expiresInSeconds: ACCESS_TOKEN_SECONDS };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.update(sessions).set({ revokedAt: this.clock.now() }).where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  /** Verifies the JWT signature and expiry. Session and roles are checked by the policy guard. */
  async verifyAccess(token: string): Promise<AccessPayload> {
    try {
      return await this.jwt.verifyAsync<AccessPayload>(token);
    } catch (err) {
      if (err instanceof Error && err.name === "TokenExpiredError") throw new ApiError("SESSION_EXPIRED", "Access token expired. Refresh it.");
      throw new ApiError("UNAUTHENTICATED", "Please sign in.");
    }
  }

  /** Is this session still usable, and is its user active? */
  async sessionStatus(sessionId: string, userId: string): Promise<"ok" | "ended" | "suspended"> {
    const [row] = await this.db
      .select({ revokedAt: sessions.revokedAt, expiresAt: sessions.expiresAt, status: users.status })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
    if (!row || row.revokedAt || row.expiresAt.getTime() <= this.clock.now().getTime()) return "ended";
    return row.status === "active" ? "ok" : "suspended";
  }

  private sign(userId: string, sessionId: string, roles: Role[]) {
    const payload: AccessPayload = { sub: userId, sid: sessionId, roles };
    return this.jwt.signAsync(payload, { expiresIn: ACCESS_TOKEN_SECONDS });
  }

  private refreshExpiry() {
    return new Date(this.clock.now().getTime() + REFRESH_TOKEN_SECONDS * 1000);
  }
}
