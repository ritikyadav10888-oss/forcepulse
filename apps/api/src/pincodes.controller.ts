import { Controller, Get, Inject, Param } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { pincodes, type Db } from "@force-pulse/db";
import { ApiError } from "./common/api-error";
import { Public } from "./common/policy";
import { DB } from "./common/tokens";

/** FR-REG-05: fills city and state from a 6-digit pincode, from the India Post table in our own database. */
@Controller("pincodes")
export class PincodesController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get(":pincode")
  @Public()
  async lookup(@Param("pincode") pincode: string) {
    if (!/^[1-9]\d{5}$/.test(pincode)) throw new ApiError("BAD_REQUEST", "A pincode has 6 digits and doesn't start with 0.");
    const [row] = await this.db.select().from(pincodes).where(eq(pincodes.pincode, pincode));
    if (!row) throw new ApiError("NOT_FOUND", "We don't know this pincode. Enter the city by hand.");
    return row;
  }
}
