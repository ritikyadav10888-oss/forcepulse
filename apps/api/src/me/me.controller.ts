import { Controller, Get } from "@nestjs/common";
import { combinedRoleLabel, platformRoleOf } from "@force-pulse/shared";
import { AuthService } from "../auth/auth.service";
import { Authenticated, CurrentAuth, type AuthContext } from "../common/policy";

@Controller("me")
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @Authenticated()
  me(@CurrentAuth() auth: AuthContext) {
    return this.auth.userView(auth.userId);
  }

  /** For the account header and role switcher (FR-AUTH-05). */
  @Get("roles")
  @Authenticated()
  roles(@CurrentAuth() auth: AuthContext) {
    return {
      roles: auth.roles,
      suspendedRoles: auth.suspendedRoles,
      label: combinedRoleLabel(auth.roles),
      platformRole: platformRoleOf(auth.roles),
    };
  }
}
