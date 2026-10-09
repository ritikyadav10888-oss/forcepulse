import { randomInt } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { players, userRoles, users, type Db } from "@force-pulse/db";
import { combinedRoleLabel, platformRoleOf, STAFF_ROLES, toE164Mobile, type PlatformRole, type Role } from "@force-pulse/shared";
import { ApiError } from "../common/api-error";
import { CLOCK, DB, type Clock } from "../common/tokens";
import { RolesService } from "../roles/roles.service";
import { OtpService, type OtpSent } from "./otp.service";
import { TokensService, type TokenPair } from "./tokens.service";

/** The web app's User, plus the stacked roles behind it. */
export interface UserView {
  id: string;
  phone: string | null;
  email: string | null;
  platformRole: PlatformRole;
  roles: Role[];
  roleLabel: string;
}

export interface SignedIn extends TokenPair {
  user: UserView;
  isNewUser: boolean;
}

// Same work for unknown emails as for known ones, so response time doesn't reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync("force-pulse-timing-guard", 12);
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly otp: OtpService,
    private readonly tokens: TokensService,
    private readonly roles: RolesService,
  ) {}

  async sendOtp(rawPhone: string, ip: string | null): Promise<OtpSent> {
    const phone = this.phoneOrThrow(rawPhone);
    await this.refuseStaffPhone(phone);
    return this.otp.send(phone, ip);
  }

  /** OTP sign-in. A new number becomes a new account with the Player role and a player record (FR-AUTH-02). */
  async verifyOtp(rawPhone: string, code: string, userAgent: string | null): Promise<SignedIn> {
    const phone = this.phoneOrThrow(rawPhone);
    await this.refuseStaffPhone(phone);
    await this.otp.verify(phone, code);

    return this.db.transaction(async (tx) => {
      let [user] = await tx.select().from(users).where(eq(users.phone, phone));
      const isNewUser = !user;
      if (!user) [user] = await tx.insert(users).values({ phone, createdAt: this.clock.now() }).returning();
      if (user.status !== "active") throw new ApiError("ACCOUNT_SUSPENDED", "This account is suspended.");

      const [player] = await tx.select({ id: players.id }).from(players).where(eq(players.userId, user.id));
      if (!player) await tx.insert(players).values({ userId: user.id, playerCode: await this.newPlayerCode(tx) });
      await this.roles.grant(user.id, "player", "signup", tx);

      const state = await this.roles.state(user.id, tx);
      const pair = await this.tokens.startSession(user.id, state.roles, userAgent, tx);
      return { ...pair, isNewUser, user: toView(user, state.roles) };
    });
  }

  /** Staff sign-in by email and password. Only accounts holding an active admin or super_admin role. */
  async staffLogin(email: string, password: string, userAgent: string | null): Promise<SignedIn> {
    const normalised = email.trim().toLowerCase();
    const [user] = await this.db.select().from(users).where(sql`lower(${users.email}) = ${normalised}`);
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !ok) throw new ApiError("INVALID_CREDENTIALS", "Wrong email or password.");
    if (user.status !== "active") throw new ApiError("ACCOUNT_SUSPENDED", "This account is suspended.");

    const state = await this.roles.state(user.id);
    if (!state.roles.some((r) => STAFF_ROLES.includes(r))) throw new ApiError("INVALID_CREDENTIALS", "Wrong email or password.");
    const pair = await this.tokens.startSession(user.id, state.roles, userAgent);
    return { ...pair, isNewUser: false, user: toView(user, state.roles) };
  }

  refresh(refreshToken: string) {
    return this.tokens.refresh(refreshToken, async (userId) => (await this.roles.state(userId)).roles);
  }

  logout(sessionId: string) {
    return this.tokens.revoke(sessionId);
  }

  async userView(userId: string): Promise<UserView> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new ApiError("NOT_FOUND", "No such user.");
    return toView(user, (await this.roles.state(userId)).roles);
  }

  private phoneOrThrow(raw: string): string {
    const phone = toE164Mobile(raw ?? "");
    if (!phone) throw new ApiError("INVALID_PHONE", "Enter a valid 10-digit Indian mobile number.");
    return phone;
  }

  /** Staff accounts must use the staff login, never OTP (web app rule: SERVER_MUST_ENFORCE, Auth). */
  private async refuseStaffPhone(phone: string) {
    const staff = await this.db
      .select({ role: userRoles.role })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .where(and(eq(users.phone, phone), inArray(userRoles.role, [...STAFF_ROLES])))
      .limit(1);
    if (staff.length) throw new ApiError("STAFF_USE_STAFF_LOGIN", "Staff accounts sign in with email and password.");
  }

  /** "FP" + 6 characters without look-alikes (0/O, 1/I/L). About 730 million combinations. */
  private async newPlayerCode(tx: Db): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const code = "FP" + Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
      const taken = await tx.select({ id: players.id }).from(players).where(eq(players.playerCode, code));
      if (!taken.length) return code;
    }
    throw new ApiError("INTERNAL", "Could not create a player id. Please try again.");
  }
}

function toView(user: typeof users.$inferSelect, roles: Role[]): UserView {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    platformRole: platformRoleOf(roles),
    roles,
    roleLabel: combinedRoleLabel(roles),
  };
}
