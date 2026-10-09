import { Body, Controller, Get, Inject, Param, Put } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { sports, type Db } from "@force-pulse/db";
import { ApiError } from "../common/api-error";
import { AuditService } from "../common/audit.service";
import { CurrentAuth, Public, RequireRole, type AuthContext } from "../common/policy";
import { DB } from "../common/tokens";
import { parse } from "../common/validate";

const SportInput = z
  .object({
    name: z.string().trim().min(1).max(40),
    icon: z.string().trim().max(40).default(""),
    accent: z.string().trim().max(60).default(""),
    teamSize: z.number().int().min(1).max(50),
    maxSubstitutes: z.number().int().min(0).max(50).default(0),
    roles: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
    suggestedRules: z.record(z.string(), z.union([z.number(), z.string()])).default({}),
    scoringModule: z.string().trim().min(1).max(40),
    active: z.boolean().default(true),
  })
  .strict();

@Controller()
export class SportsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  @Get("sports")
  @Public()
  list() {
    return this.db.select().from(sports).where(eq(sports.active, true)).orderBy(asc(sports.name));
  }

  @Get("sports/:id")
  @Public()
  async one(@Param("id") id: string) {
    const [row] = await this.db.select().from(sports).where(eq(sports.id, id));
    if (!row) throw new ApiError("NOT_FOUND", "No such sport.");
    return row;
  }

  /** Super admin adds or edits a sport (FR-ADM-01, web app rule 12). */
  @Put("admin/sports/:id")
  @RequireRole("super_admin")
  async save(@Param("id") id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    if (!/^[a-z0-9-]{2,40}$/.test(id)) throw new ApiError("BAD_REQUEST", "Sport id: lowercase letters, digits and dashes only.");
    const input = parse(SportInput, body);
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(sports).where(eq(sports.id, id));
      const [row] = await tx.insert(sports).values({ id, ...input }).onConflictDoUpdate({ target: sports.id, set: input }).returning();
      await this.audit.record({ entity: "sport", entityId: id, action: before ? "update" : "create", before: before ?? null, after: row, userId: auth.userId }, tx);
      return row;
    });
  }
}
