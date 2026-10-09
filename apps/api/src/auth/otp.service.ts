import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { otpChallenges, type Db } from "@force-pulse/db";
import { ApiError } from "../common/api-error";
import { CLOCK, CONFIG, DB, OTP_SENDER, type Clock } from "../common/tokens";
import type { AppConfig } from "../config";
import type { OtpSender } from "./otp-sender";

// FR-AUTH-01: 6 digits, valid 5 minutes, at most 3 sends per number per 15 minutes.
// System Design 12.1: per-IP limit and lockout after 5 wrong codes.
export const OTP_RULES = {
  length: 6,
  validSeconds: 5 * 60,
  windowSeconds: 15 * 60,
  maxSendsPerPhone: 3,
  maxSendsPerIp: 10,
  maxFailedAttempts: 5,
  resendAfterSeconds: 30,
} as const;

export interface OtpSent {
  sent: true;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  /** Development only (console sender). */
  debugOtp?: string;
}

@Injectable()
export class OtpService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
  ) {}

  async send(phone: string, ip: string | null): Promise<OtpSent> {
    const now = this.clock.now();
    const windowStart = new Date(now.getTime() - OTP_RULES.windowSeconds * 1000);

    const [{ byPhone }] = await this.db
      .select({ byPhone: sql<number>`count(*)::int` })
      .from(otpChallenges)
      .where(and(eq(otpChallenges.phone, phone), gte(otpChallenges.createdAt, windowStart)));
    if (byPhone >= OTP_RULES.maxSendsPerPhone) {
      throw new ApiError("OTP_RATE_LIMITED", "Too many codes sent to this number. Try again in 15 minutes.");
    }
    if (ip) {
      const [{ byIp }] = await this.db
        .select({ byIp: sql<number>`count(*)::int` })
        .from(otpChallenges)
        .where(and(eq(otpChallenges.ip, ip), gte(otpChallenges.createdAt, windowStart)));
      if (byIp >= OTP_RULES.maxSendsPerIp) {
        throw new ApiError("OTP_RATE_LIMITED", "Too many codes requested from this network. Try again later.");
      }
    }

    const code = String(randomInt(0, 10 ** OTP_RULES.length)).padStart(OTP_RULES.length, "0");
    await this.db.insert(otpChallenges).values({
      phone,
      codeHash: this.hash(phone, code),
      expiresAt: new Date(now.getTime() + OTP_RULES.validSeconds * 1000),
      ip,
      createdAt: now,
    });
    await this.sender.send(phone, code);

    return {
      sent: true,
      expiresInSeconds: OTP_RULES.validSeconds,
      resendAfterSeconds: OTP_RULES.resendAfterSeconds,
      ...(this.sender.exposesCode ? { debugOtp: code } : {}),
    };
  }

  /** Checks the newest unused code for this number. Succeeds once; throws a coded ApiError otherwise. */
  async verify(phone: string, code: string): Promise<void> {
    const now = this.clock.now();
    const [challenge] = await this.db
      .select()
      .from(otpChallenges)
      .where(and(eq(otpChallenges.phone, phone), isNull(otpChallenges.consumedAt)))
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);

    if (!challenge) throw new ApiError("OTP_INVALID", "That code doesn't match. Request a new code.");
    if (challenge.failedAttempts >= OTP_RULES.maxFailedAttempts) {
      throw new ApiError("OTP_LOCKED", "Too many wrong codes. Request a new code.");
    }
    if (challenge.expiresAt.getTime() <= now.getTime()) throw new ApiError("OTP_EXPIRED", "This code has expired. Request a new one.");

    if (!this.matches(challenge.codeHash, phone, code)) {
      const [row] = await this.db
        .update(otpChallenges)
        .set({ failedAttempts: sql`${otpChallenges.failedAttempts} + 1` })
        .where(eq(otpChallenges.id, challenge.id))
        .returning({ failedAttempts: otpChallenges.failedAttempts });
      const left = OTP_RULES.maxFailedAttempts - row.failedAttempts;
      if (left <= 0) throw new ApiError("OTP_LOCKED", "Too many wrong codes. Request a new code.");
      throw new ApiError("OTP_INVALID", "That code doesn't match.", { attemptsLeft: left });
    }

    // Consume exactly once, even if two verify calls race.
    const consumed = await this.db
      .update(otpChallenges)
      .set({ consumedAt: now })
      .where(and(eq(otpChallenges.id, challenge.id), isNull(otpChallenges.consumedAt)))
      .returning({ id: otpChallenges.id });
    if (!consumed.length) throw new ApiError("OTP_INVALID", "This code was already used. Request a new code.");
  }

  private hash(phone: string, code: string): string {
    return createHmac("sha256", this.config.otpSecret).update(`${phone}:${code}`).digest("hex");
  }

  private matches(storedHex: string, phone: string, code: string): boolean {
    if (!/^\d{6}$/.test(code)) return false;
    const a = Buffer.from(storedHex, "hex");
    const b = Buffer.from(this.hash(phone, code), "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
