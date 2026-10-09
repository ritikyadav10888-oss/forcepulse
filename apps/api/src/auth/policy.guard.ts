import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { Role } from "@force-pulse/shared";
import { ApiError } from "../common/api-error";
import { POLICY_KEY, type AuthContext, type Policy, type RequestWithAuth } from "../common/policy";
import { RolesService } from "../roles/roles.service";
import { TokensService } from "./tokens.service";

/**
 * Runs before every route. Reads the route's policy, checks the access token, then re-checks the
 * session and roles in the database, so a sign-out or suspension takes effect on the very next call.
 */
@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly roles: RolesService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== "http") return true; // WebSocket rooms check access themselves (realtime.gateway.ts)
    const policy = this.reflector.getAllAndOverride<Policy | undefined>(POLICY_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!policy) throw new ApiError("POLICY_MISSING", "This route has no access policy.");

    const req = ctx.switchToHttp().getRequest<Request & RequestWithAuth>();
    const token = bearer(req);

    if (policy.kind === "public") {
      if (token) req.auth = await this.load(token).catch(() => undefined);
      return true;
    }
    if (!token) throw new ApiError("UNAUTHENTICATED", "Please sign in.");
    const auth = await this.load(token);
    req.auth = auth;

    if (policy.kind === "role") {
      const wanted = policy.anyOf.includes("admin") ? [...policy.anyOf, "super_admin" as Role] : policy.anyOf;
      if (!wanted.some((r) => auth.roles.includes(r))) {
        if (wanted.some((r) => auth.suspendedRoles.includes(r))) throw new ApiError("ROLE_SUSPENDED", "This role is suspended on your account.");
        throw new ApiError("FORBIDDEN", "You don't have access to this.");
      }
    }
    return true;
  }

  private async load(token: string): Promise<AuthContext> {
    const payload = await this.tokens.verifyAccess(token);
    const status = await this.tokens.sessionStatus(payload.sid, payload.sub);
    if (status === "ended") throw new ApiError("UNAUTHENTICATED", "Please sign in again.");
    if (status === "suspended") throw new ApiError("ACCOUNT_SUSPENDED", "This account is suspended.");
    const { roles, suspendedRoles } = await this.roles.state(payload.sub);
    return { userId: payload.sub, sessionId: payload.sid, roles, suspendedRoles };
  }
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}
