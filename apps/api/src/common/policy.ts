import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Role } from "@force-pulse/shared";

// Central policy layer (FR-AUTH-06, System Design 4.1). Every route must carry exactly one of these;
// a route without one is refused (fail closed) and a test checks that none exists.
// Ownership checks (organiser → own tournament, scorer → assigned match) live in the services,
// which receive the caller's AuthContext.

export type Policy = { kind: "public" } | { kind: "authenticated" } | { kind: "role"; anyOf: Role[] };

export const POLICY_KEY = "fp:policy";

/** Anyone, signed in or not. A valid token is still read, so the handler can tailor the answer. */
export const Public = () => SetMetadata(POLICY_KEY, { kind: "public" } satisfies Policy);

/** Any signed-in account with an active session. */
export const Authenticated = () => SetMetadata(POLICY_KEY, { kind: "authenticated" } satisfies Policy);

/** Signed in and holding at least one of these roles, not suspended. super_admin also passes "admin". */
export const RequireRole = (...anyOf: Role[]) => SetMetadata(POLICY_KEY, { kind: "role", anyOf } satisfies Policy);

export interface AuthContext {
  userId: string;
  sessionId: string;
  /** Active (not suspended) roles. */
  roles: Role[];
  suspendedRoles: Role[];
}

export type RequestWithAuth = { auth?: AuthContext };

/** The caller's AuthContext; undefined on a public route when nobody is signed in. */
export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext | undefined => ctx.switchToHttp().getRequest<RequestWithAuth>().auth,
);
