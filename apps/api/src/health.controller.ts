import { Controller, Get, Inject } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "@force-pulse/db";
import { Public } from "./common/policy";
import { DB } from "./common/tokens";

@Controller("health")
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  @Public()
  async health() {
    await this.db.execute(sql`select 1`);
    return { status: "ok" };
  }
}
