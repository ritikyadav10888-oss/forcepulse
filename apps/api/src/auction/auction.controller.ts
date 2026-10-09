import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { Authenticated, CurrentAuth, Public, RequireRole, type AuthContext } from "../common/policy";
import { parse } from "../common/validate";
import { PaymentsService } from "../payments/payments.service";
import { AuctionService } from "./auction.service";

const Points = z.number().int().min(0).max(100_000_000);
const CreateInput = z.object({ eventId: z.uuid(), categoryId: z.uuid().nullable().default(null) }).strict();
const ConfigInput = z
  .object({
    purse: Points.min(1),
    minSquad: z.number().int().min(1).max(50),
    maxSquad: z.number().int().min(1).max(50),
    timerSeconds: z.number().int().min(5).max(300).default(30),
    lotOrder: z.enum(["category", "random", "manual"]).default("category"),
    slabs: z.array(z.object({ from: Points, raise: Points.min(1) }).strict()).min(1).max(20),
    categories: z.array(z.object({ name: z.string().trim().min(1).max(40), basePoints: Points.min(1), quotaPerTeam: z.number().int().min(1).max(50).nullable().default(null) }).strict()).min(1).max(20),
  })
  .strict();
const TeamInput = z.object({ name: z.string().trim().min(1).max(60), logoUrl: z.string().max(500).default(""), ownerPhone: z.string().max(20).nullable().default(null) }).strict();
const LotsInput = z.object({ lots: z.array(z.object({ playerId: z.uuid(), categoryId: z.uuid() }).strict()).max(1000) }).strict();
const PlanInput = z.object({ planId: z.enum(["starter", "standard", "pro", "premium"]) }).strict();

@Controller()
export class AuctionController {
  constructor(
    private readonly auctions: AuctionService,
    private readonly payments: PaymentsService,
  ) {}

  @Get("auction-plans")
  @Public()
  plans() {
    return this.auctions.plans();
  }

  @Put("admin/auction-plans/:id")
  @RequireRole("super_admin")
  setPrice(@Param("id") id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.auctions.setPlanPrice(auth.userId, id, parse(z.object({ pricePaise: z.number().int().min(0).max(10_000_000_00) }).strict(), body).pricePaise);
  }

  /** Staff unlock an auction without payment (complimentary plans, while prices are being decided). */
  @Post("admin/auctions/:id/plan")
  @HttpCode(200)
  @RequireRole("super_admin")
  grant(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.auctions.grantPlan(auth.userId, id, parse(PlanInput, body).planId);
  }

  @Post("tournaments/:id/auctions")
  @Authenticated()
  create(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.auctions.create(auth, id, parse(CreateInput, body));
  }

  @Get("tournaments/:id/auctions")
  @Public()
  forTournament(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth?: AuthContext) {
    return this.auctions.forTournament(id, auth);
  }

  /** Bidder screens, projector and public view (FR-AUC-10, 17, 18). */
  @Get("auctions/:id")
  @Public()
  get(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth?: AuthContext) {
    return this.auctions.get(id, auth);
  }

  /** Buy or upgrade a plan: a Razorpay order for the price, or the difference (FR-AUC-21, 23, 24). */
  @Post("auctions/:id/plan")
  @Authenticated()
  buyPlan(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.payments.createPlanOrder(auth, id, parse(PlanInput, body).planId);
  }

  @Put("auctions/:id/config")
  @Authenticated()
  configure(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.auctions.configure(auth, id, parse(ConfigInput, body));
  }

  @Post("auctions/:id/teams")
  @Authenticated()
  addTeam(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.auctions.addTeam(auth, id, parse(TeamInput, body));
  }

  @Get("auctions/:id/pool")
  @Authenticated()
  pool(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.auctions.pool(auth, id);
  }

  @Put("auctions/:id/lots")
  @Authenticated()
  setLots(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.auctions.setLots(auth, id, parse(LotsInput, body).lots);
  }

  @Post("auctions/:id/start")
  @HttpCode(200)
  @Authenticated()
  start(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.auctions.start(auth, id);
  }

  @Post("auctions/:id/next")
  @HttpCode(200)
  @Authenticated()
  next(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.auctions.next(auth, id, parse(z.object({ lotId: z.uuid().nullable().default(null) }).strict(), body ?? {}).lotId);
  }

  /** Clients send only "bid for team X"; the server sets the amount (System Design 7.3). */
  @Post("auctions/:id/bid")
  @HttpCode(200)
  @Authenticated()
  bid(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    const { teamId, floor } = parse(z.object({ teamId: z.uuid(), floor: z.boolean().default(false) }).strict(), body);
    return this.auctions.bid(auth, id, teamId, floor);
  }

  @Post("auctions/:id/pause")
  @HttpCode(200)
  @Authenticated()
  pause(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.auctions.pause(auth, id);
  }

  @Post("auctions/:id/resume")
  @HttpCode(200)
  @Authenticated()
  resume(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.auctions.resume(auth, id);
  }

  @Post("auctions/:id/undo")
  @HttpCode(200)
  @Authenticated()
  undo(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.auctions.undoLastSale(auth, id, parse(z.object({ reason: z.string().trim().min(3).max(300) }).strict(), body).reason);
  }

  @Post("auctions/:id/reauction")
  @HttpCode(200)
  @Authenticated()
  reauction(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.auctions.reauction(auth, id);
  }

  @Post("auctions/:id/close")
  @HttpCode(200)
  @Authenticated()
  close(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.auctions.close(auth, id);
  }

  @Get("auctions/:id/export.csv")
  @Authenticated()
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="auction.csv"')
  export(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.auctions.exportCsv(auth, id);
  }
}
