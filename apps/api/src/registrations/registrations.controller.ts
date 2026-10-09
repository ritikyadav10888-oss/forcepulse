import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { Authenticated, CurrentAuth, Public, RequireRole, type AuthContext } from "../common/policy";
import { parse } from "../common/validate";
import { FlagInput, JoinTeamInput, ListEnrollmentsQuery, ManagedPlayerInput, ReasonInput, RegisterInput, ReviewInput, TeamRegisterInput } from "./registration.schemas";
import { RegistrationsService } from "./registrations.service";

@Controller()
export class RegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  // ---------- Player ----------

  @Post("tournaments/:id/registrations")
  @RequireRole("player")
  register(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.registrations.register(auth, id, parse(RegisterInput, body));
  }

  @Post("tournaments/:id/events/:eventId/teams")
  @RequireRole("player")
  registerTeam(@Param("id", ParseUUIDPipe) id: string, @Param("eventId", ParseUUIDPipe) eventId: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.registrations.registerTeam(auth, id, eventId, parse(TeamRegisterInput, body));
  }

  /** Team name, sport and size behind a code, shown before joining. */
  @Get("teams/code/:code")
  @Public()
  teamByCode(@Param("code") code: string) {
    return this.registrations.teamByCode(code);
  }

  @Post("teams/join")
  @RequireRole("player")
  joinTeam(@Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.registrations.joinTeam(auth, parse(JoinTeamInput, body));
  }

  @Get("me/enrollments")
  @Authenticated()
  mine(@CurrentAuth() auth: AuthContext) {
    return this.registrations.mine(auth);
  }

  @Get("me/managed-players")
  @RequireRole("player")
  managed(@CurrentAuth() auth: AuthContext) {
    return this.registrations.managedPlayers(auth);
  }

  @Post("me/managed-players")
  @RequireRole("player")
  createManaged(@Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.registrations.createManagedPlayer(auth, parse(ManagedPlayerInput, body));
  }

  // ---------- Organiser ----------

  @Get("tournaments/:id/enrollments")
  @Authenticated()
  list(@Param("id", ParseUUIDPipe) id: string, @Query() query: unknown, @CurrentAuth() auth: AuthContext) {
    return this.registrations.list(auth, id, parse(ListEnrollmentsQuery, query));
  }

  @Get("tournaments/:id/enrollments.csv")
  @Authenticated()
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="registrations.csv"')
  csv(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.registrations.csv(auth, id);
  }

  @Post("enrollments/:id/remove")
  @HttpCode(200)
  @Authenticated()
  remove(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.registrations.remove(auth, id, parse(ReasonInput, body ?? {}).reason ?? null);
  }

  @Post("enrollments/:id/review")
  @HttpCode(200)
  @Authenticated()
  review(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    const { action, reason } = parse(ReviewInput, body);
    return this.registrations.review(auth, id, action, reason ?? null);
  }

  @Patch("enrollments/:id/flag")
  @Authenticated()
  flag(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.registrations.setFlag(auth, id, parse(FlagInput, body).flagged);
  }
}
