import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { payoutAccounts, type Db } from "@force-pulse/db";
import { ApiError } from "../common/api-error";
import { AuditService } from "../common/audit.service";
import { encrypt } from "../common/crypto";
import { CLOCK, CONFIG, DB, type Clock } from "../common/tokens";
import type { AppConfig } from "../config";

/**
 * Organiser bank details (FR-PAY-11). The account number is encrypted and only its last 4 digits
 * are ever shown (NFR-09). Verification is by penny drop once RazorpayX is set up; until then
 * a super admin marks an account verified after checking it.
 */
@Injectable()
export class PayoutAccountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  async mine(userId: string) {
    const [row] = await this.db.select().from(payoutAccounts).where(eq(payoutAccounts.userId, userId));
    return row ? this.view(row) : null;
  }

  /** Saving new details always clears verification: the new account must be checked again. */
  async save(userId: string, input: { holderName: string; accountNumber: string; ifsc: string }) {
    if (!this.config.payoutEncryptionKey) throw new ApiError("PAYMENTS_UNAVAILABLE", "Bank details can't be saved on this server yet.");
    const value = {
      holderName: input.holderName,
      accountNumberEnc: encrypt(this.config.payoutEncryptionKey, input.accountNumber),
      accountLast4: input.accountNumber.slice(-4),
      ifsc: input.ifsc.toUpperCase(),
      verified: false,
      verifiedAt: null,
      updatedAt: this.clock.now(),
    };
    const [row] = await this.db.insert(payoutAccounts).values({ userId, ...value }).onConflictDoUpdate({ target: payoutAccounts.userId, set: value }).returning();
    await this.audit.record({ entity: "payout_account", entityId: userId, action: "save", after: { ifsc: value.ifsc, last4: value.accountLast4 }, userId }, this.db);
    return this.view(row);
  }

  async setVerified(actorId: string, userId: string) {
    const [row] = await this.db.update(payoutAccounts).set({ verified: true, verifiedAt: this.clock.now() }).where(eq(payoutAccounts.userId, userId)).returning();
    if (!row) throw new ApiError("NOT_FOUND", "This organiser hasn't added bank details.");
    await this.audit.record({ entity: "payout_account", entityId: userId, action: "verify", userId: actorId }, this.db);
    return this.view(row);
  }

  /** Paid registration can open only with a verified account (FR-PAY-11). */
  async assertReady(tx: Db, userId: string) {
    const [row] = await tx.select({ verified: payoutAccounts.verified }).from(payoutAccounts).where(eq(payoutAccounts.userId, userId));
    if (!row?.verified) {
      throw new ApiError("PAYOUT_ACCOUNT_REQUIRED", "Add and verify your bank account (Payouts) before opening paid registration.");
    }
  }

  private view(row: typeof payoutAccounts.$inferSelect) {
    return {
      holderName: row.holderName,
      accountNumberMasked: `••••••${row.accountLast4}`,
      ifsc: row.ifsc,
      verified: row.verified,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
    };
  }
}
