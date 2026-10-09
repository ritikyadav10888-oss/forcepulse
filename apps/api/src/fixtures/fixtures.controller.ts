import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { Authenticated, CurrentAuth, Public, type AuthContext } from "../common/policy";
import { parse } from "../common/validate";
import { FixturesService } from "./fixtures.service";

const FormatInput = z
  .object({
    categoryId: z.uuid().nullable().default(null),
    type: z.enum(["league", "knockout", "league_knockout"]),
    /** Scoring rule set for these matches; checked against the sport's knobs (FR-SCR-01). */
    rules: z.record(z.string(), z.union([z.number(), z.string()])).nullable().optional(),
    config: z
      .object({
        groups: z.number().int().min(1).max(26).default(1),
        legs: z.union([z.literal(1), z.literal(2)]).default(1),
        points: z.object({ win: z.number().int().min(0).max(10), draw: z.number().int().min(0).max(10), loss: z.number().int().min(0).max(10) }).default({ win: 3, draw: 1, loss: 0 }),
        tieBreakers: z.array(z.enum(["points", "score_diff", "scored", "wins", "head_to_head"])).max(5).default(["score_diff", "scored", "head_to_head"]),
        qualifiersPerGroup: z.number().int().min(1).max(8).default(2),
        thirdPlace: z.boolean().default(false),
        seeding: z.enum(["random", "manual"]).default("random"),
        seeds: z.array(z.uuid()).max(512).default([]),
      })
      .strict()
      .prefault({}),
  })
  .strict();

const GenerateInput = z
  .object({
    startDate: z.iso.date(),
    dayStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM"),
    dayEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM"),
    matchMinutes: z.number().int().min(5).max(600),
    courts: z.array(z.string().trim().min(1).max(40)).min(1).max(50),
  })
  .strict();

const MatchPatch = z
  .object({
    scheduledAt: z.iso.datetime({ offset: true }).optional(),
    court: z.string().trim().max(40).optional(),
    scorerUserId: z.uuid().nullable().optional(),
    homeEntrantId: z.uuid().optional(),
    awayEntrantId: z.uuid().optional(),
  })
  .strict();

const Reason = z.string().trim().min(3).max(500);
const ResultInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("score"), homeScore: z.number().int().min(0).max(10_000), awayScore: z.number().int().min(0).max(10_000), winnerEntrantId: z.uuid().nullable().optional() }).strict(),
  z.object({ type: z.enum(["walkover", "forfeit"]), winnerEntrantId: z.uuid(), reason: Reason }).strict(),
  z.object({ type: z.literal("abandoned"), reason: Reason }).strict(),
]);

@Controller()
export class FixturesController {
  constructor(private readonly fixtures: FixturesService) {}

  @Put("events/:eventId/format")
  @Authenticated()
  setFormat(@Param("eventId", ParseUUIDPipe) eventId: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.fixtures.setFormat(auth, eventId, parse(FormatInput, body));
  }

  @Post("formats/:id/fixtures")
  @Authenticated()
  generate(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.fixtures.generate(auth, id, parse(GenerateInput, body));
  }

  /** Schedule and results (FR-TRN-13). */
  @Get("tournaments/:id/matches")
  @Public()
  list(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth?: AuthContext) {
    return this.fixtures.list(id, auth);
  }

  @Get("tournaments/:id/standings")
  @Public()
  standings(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth?: AuthContext) {
    return this.fixtures.standings(id, auth);
  }

  @Patch("matches/:id")
  @Authenticated()
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.fixtures.update(auth, id, parse(MatchPatch, body));
  }

  @Post("matches/:id/cancel")
  @HttpCode(200)
  @Authenticated()
  cancel(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.fixtures.cancel(auth, id, parse(z.object({ reason: Reason }).strict(), body).reason);
  }

  @Post("matches/:id/result")
  @HttpCode(200)
  @Authenticated()
  result(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.fixtures.recordResult(auth, id, parse(ResultInput, body));
  }
}
