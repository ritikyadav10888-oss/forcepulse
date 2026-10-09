import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { suggestedFields, type FieldDef } from "@force-pulse/shared";
import { Authenticated, CurrentAuth, Public, RequireRole, type AuthContext } from "../common/policy";
import { parse } from "../common/validate";
import {
  CreateTournamentInput,
  FormInput,
  InviteInput,
  InviteLinkInput,
  ListQuery,
  ReplaceEventsInput,
  StatusInput,
  UpdateTournamentInput,
} from "./tournament.schemas";
import { TournamentsService } from "./tournaments.service";

@Controller()
export class TournamentsController {
  constructor(private readonly tournaments: TournamentsService) {}

  // ---------- Public ----------

  @Get("tournaments")
  @Public()
  list(@Query() query: unknown) {
    return this.tournaments.list(parse(ListQuery, query));
  }

  /** By id or slug. */
  @Get("tournaments/:idOrSlug")
  @Public()
  get(@Param("idOrSlug") idOrSlug: string, @CurrentAuth() auth?: AuthContext) {
    return this.tournaments.get(idOrSlug, auth);
  }

  /** The registration page behind a tournament link or QR code (FR-REG-01/02). */
  @Get("t/:slug")
  @Public()
  registrationPage(@Param("slug") slug: string, @CurrentAuth() auth?: AuthContext) {
    return this.tournaments.registrationPage(slug, auth);
  }

  /** Starting fields for the form builder (FR-REG-04). */
  @Get("forms/suggested-fields")
  @Public()
  suggested(): FieldDef[] {
    return suggestedFields();
  }

  // ---------- Organiser ----------

  @Post("tournaments")
  @RequireRole("player")
  create(@Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.tournaments.create(auth, parse(CreateTournamentInput, body));
  }

  @Get("me/tournaments")
  @Authenticated()
  mine(@CurrentAuth() auth: AuthContext) {
    return this.tournaments.mine(auth.userId);
  }

  @Patch("tournaments/:id")
  @Authenticated()
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    const sent = body && typeof body === "object" ? Object.keys(body) : [];
    return this.tournaments.update(auth, id, parse(UpdateTournamentInput, body), sent);
  }

  @Put("tournaments/:id/events")
  @Authenticated()
  replaceEvents(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.tournaments.replaceEvents(auth, id, parse(ReplaceEventsInput, body).events);
  }

  @Put("tournaments/:id/status")
  @Authenticated()
  setStatus(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.tournaments.setStatus(auth, id, parse(StatusInput, body).status);
  }

  @Get("tournaments/:id/form")
  @Authenticated()
  form(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.tournaments.form(auth, id);
  }

  @Put("tournaments/:id/form")
  @Authenticated()
  saveForm(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.tournaments.saveForm(auth, id, parse(FormInput, body).fields as FieldDef[]);
  }

  @Post("tournaments/:id/form/publish")
  @HttpCode(200)
  @Authenticated()
  publishForm(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.tournaments.publishForm(auth, id);
  }

  @Get("tournaments/:id/invites")
  @Authenticated()
  invites(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.tournaments.invites(auth, id);
  }

  @Post("tournaments/:id/invites")
  @Authenticated()
  addInvite(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    const { phone, name } = parse(InviteInput, body);
    return this.tournaments.addInvite(auth, id, phone, name);
  }

  @Delete("tournaments/:id/invites/:phone")
  @HttpCode(204)
  @Authenticated()
  async removeInvite(@Param("id", ParseUUIDPipe) id: string, @Param("phone") phone: string, @CurrentAuth() auth: AuthContext) {
    await this.tournaments.removeInvite(auth, id, phone);
  }

  @Get("tournaments/:id/invite-link")
  @Authenticated()
  inviteLink(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.tournaments.inviteLink(auth, id);
  }

  @Patch("tournaments/:id/invite-link")
  @Authenticated()
  updateInviteLink(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.tournaments.updateInviteLink(auth, id, parse(InviteLinkInput, body), false);
  }

  /** New code; the old link stops working. */
  @Post("tournaments/:id/invite-link/reset")
  @HttpCode(200)
  @Authenticated()
  resetInviteLink(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.tournaments.updateInviteLink(auth, id, {}, true);
  }
}
