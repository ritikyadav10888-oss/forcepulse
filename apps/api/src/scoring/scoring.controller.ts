import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { z } from "zod";
import { Authenticated, CurrentAuth, Public, RequireRole, type AuthContext } from "../common/policy";
import { parse } from "../common/validate";
import { ScoringService } from "./scoring.service";

const Device = z.string().trim().min(8).max(100);
const Value = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);
const SyncInput = z
  .object({
    deviceId: Device,
    events: z
      .array(
        z
          .object({
            id: z.uuid(),
            seq: z.number().int().min(1),
            action: z.string().regex(/^[a-z_]{1,40}$/),
            payload: z.record(z.string().max(40), Value).refine((p) => Object.keys(p).length <= 30, "Too many fields").default({}),
            deviceTs: z.iso.datetime({ offset: true }).optional(),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
const RuleSetInput = z
  .object({ sportId: z.string().max(40), name: z.string().trim().min(1).max(80), config: z.record(z.string(), z.union([z.number(), z.string()])) })
  .strict();
const CloseInput = z.object({ playerOfMatchId: z.uuid().nullable().optional(), winnerEntrantId: z.uuid().nullable().optional() }).strict();

@Controller()
export class ScoringController {
  constructor(private readonly scoring: ScoringService) {}

  /** The settings an organiser chooses for a sport, with typical values as suggestions only (FR-SCR-01/02). */
  @Get("sports/:id/rules")
  @Public()
  rules(@Param("id") id: string) {
    return this.scoring.sportRules(id);
  }

  @Get("rule-sets")
  @Authenticated()
  myRuleSets(@CurrentAuth() auth: AuthContext) {
    return this.scoring.myRuleSets(auth);
  }

  @Post("rule-sets")
  @RequireRole("player")
  saveRuleSet(@Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.scoring.saveRuleSet(auth, parse(RuleSetInput, body));
  }

  @Post("matches/:id/start")
  @HttpCode(200)
  @Authenticated()
  start(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.scoring.start(auth, id, parse(z.object({ deviceId: Device }).strict(), body).deviceId);
  }

  @Post("matches/:id/events")
  @HttpCode(200)
  @Authenticated()
  sync(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    const { deviceId, events } = parse(SyncInput, body);
    return this.scoring.sync(auth, id, deviceId, events);
  }

  @Get("matches/:id/events")
  @Authenticated()
  events(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.scoring.eventList(auth, id);
  }

  /** Live score for public pages; poll every 2 s until live updates arrive (FR-SCR-13). */
  @Get("matches/:id/live")
  @Public()
  live(@Param("id", ParseUUIDPipe) id: string) {
    return this.scoring.live(id);
  }

  @Post("matches/:id/release-device")
  @HttpCode(204)
  @Authenticated()
  async release(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    await this.scoring.releaseLease(auth, id);
  }

  @Post("matches/:id/close")
  @HttpCode(200)
  @Authenticated()
  close(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.scoring.close(auth, id, parse(CloseInput, body ?? {}));
  }
}
