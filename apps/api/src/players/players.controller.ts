import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Put } from "@nestjs/common";
import { z } from "zod";
import { CurrentAuth, Public, RequireRole, type AuthContext } from "../common/policy";
import { parse } from "../common/validate";
import { PlayersService } from "./players.service";

const ProfilePatch = z
  .object({
    name: z.string().trim().min(1).max(80),
    photoUrl: z.union([z.url(), z.literal("")]),
    gender: z.enum(["male", "female"]).nullable(),
    dob: z.iso.date().nullable(),
    pincode: z.string().regex(/^[1-9]\d{5}$/, "must be a 6-digit Indian pincode").nullable(),
    city: z.string().trim().max(80),
    state: z.string().trim().max(80),
  })
  .partial()
  .strict();

const SportProfile = z.object({
  playingRole: z.string().trim().max(60).default(""),
  skillLevel: z.string().trim().max(40).default(""),
});

@Controller()
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  @Get("me/player")
  @RequireRole("player")
  mine(@CurrentAuth() auth: AuthContext) {
    return this.players.mine(auth.userId);
  }

  @Patch("me/player")
  @RequireRole("player")
  updateMine(@CurrentAuth() auth: AuthContext, @Body() body: unknown) {
    return this.players.updateMine(auth.userId, parse(ProfilePatch, body));
  }

  @Put("me/player/sports/:sportId")
  @RequireRole("player")
  saveSport(@CurrentAuth() auth: AuthContext, @Param("sportId") sportId: string, @Body() body: unknown) {
    const { playingRole, skillLevel } = parse(SportProfile, body);
    return this.players.saveMySport(auth.userId, sportId, playingRole, skillLevel);
  }

  @Delete("me/player/sports/:sportId")
  @HttpCode(204)
  @RequireRole("player")
  async removeSport(@CurrentAuth() auth: AuthContext, @Param("sportId") sportId: string) {
    await this.players.removeMySport(auth.userId, sportId);
  }

  /** Public profile (FR-PRO-07 hides private fields from everyone but the player and staff). */
  @Get("players/:id")
  @Public()
  byId(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth?: AuthContext) {
    return this.players.byId(id, auth);
  }

  @Get("players/:id/sports")
  @Public()
  sports(@Param("id", ParseUUIDPipe) id: string) {
    return this.players.sportsOf(id);
  }
}
