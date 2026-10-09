import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { ensureSuperAdmin, migrateDb, openDb, seedReferenceData, type DbHandle } from "@force-pulse/db";
import type { OtpSender } from "../src/auth/otp-sender";
import { MemoryFileStore } from "../src/uploads/file-store";
import { FakeGateway } from "./fake-gateway";
import type { Clock } from "../src/common/tokens";
import { loadConfig } from "../src/config";
import { createApp } from "../src/create-app";

/** Time that only moves when a test moves it. */
export class TestClock implements Clock {
  private t = Date.parse("2026-10-09T10:00:00Z");
  now() {
    return new Date(this.t);
  }
  advance(seconds: number) {
    this.t += seconds * 1000;
  }
  /** Jump forward to a moment (never back). */
  set(iso: string) {
    const t = Date.parse(iso);
    if (t < this.t) throw new Error("TestClock only moves forward");
    this.t = t;
  }
}

/** Remembers the last code sent to each number instead of texting it. */
export class CapturingOtpSender implements OtpSender {
  readonly exposesCode = false;
  readonly last = new Map<string, string>();
  async send(phone: string, code: string) {
    this.last.set(phone, code);
  }
}

export const SUPER_ADMIN = { email: "root@forcepulse.test", password: "root-password-123" };

export interface Harness {
  app: INestApplication;
  db: DbHandle;
  clock: TestClock;
  otp: CapturingOtpSender;
  gateway: FakeGateway;
  http: () => ReturnType<typeof request>;
  /** Another API server on the same database, as in a multi-server deployment. */
  extraApp(): Promise<INestApplication>;
  close(): Promise<void>;
}

export async function startHarness(opts: { redisUrl?: string } = {}): Promise<Harness> {
  const db = await openDb("pglite:memory");
  await migrateDb(db);
  await seedReferenceData(db.db);
  await ensureSuperAdmin(db.db, SUPER_ADMIN.email, SUPER_ADMIN.password);

  const clock = new TestClock();
  const otp = new CapturingOtpSender();
  const config = loadConfig({
    NODE_ENV: "test",
    JWT_SECRET: "test-jwt-secret-0123456789-0123456789",
    OTP_SECRET: "test-otp-secret-0123456789-0123456789",
    PAYOUT_ENCRYPTION_KEY: "11".repeat(32),
    REDIS_URL: opts.redisUrl,
  });
  const gateway = new FakeGateway();
  const fileStore = new MemoryFileStore();
  const extra: INestApplication[] = [];
  const app = await createApp({ config, db, clock, otpSender: otp, fileStore, gateway });
  await app.init();
  return {
    app,
    db,
    clock,
    otp,
    gateway,
    http: () => request(app.getHttpServer()),
    async extraApp() {
      const more = await createApp({ config, db, clock, otpSender: otp, fileStore, gateway });
      await more.init();
      extra.push(more);
      return more;
    },
    async close() {
      for (const more of extra) await more.close();
      await app.close();
      await db.close();
    },
  };
}

/** A made-up caller address per number, so tests don't trip the per-IP OTP limit on each other. */
export const ipFor = (phone: string) => `10.${Number(phone.slice(-6, -4))}.${Number(phone.slice(-4, -2))}.${Number(phone.slice(-2))}`;

/** POST /auth/otp as if from that number's own device. */
export const requestOtp = (h: Harness, phone: string, ip = ipFor(phone)) =>
  h.http().post("/api/v1/auth/otp").set("X-Forwarded-For", ip).send({ phone });

/** Signs a number in through the full OTP flow and returns the API response body. */
export async function signIn(h: Harness, phone: string) {
  await requestOtp(h, phone).expect(200);
  const code = h.otp.last.get(`+91${phone.slice(-10)}`)!;
  const res = await h.http().post("/api/v1/auth/verify").send({ phone, code }).expect(200);
  return res.body as { accessToken: string; refreshToken: string; isNewUser: boolean; user: { id: string; phone: string; roles: string[]; roleLabel: string; platformRole: string } };
}

export async function staffSignIn(h: Harness) {
  const res = await h.http().post("/api/v1/auth/staff/login").send(SUPER_ADMIN).expect(200);
  return res.body as { accessToken: string; user: { id: string } };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Organiser adds bank details and staff verify them, so paid registration can open (FR-PAY-11). */
export async function readyForPaid(h: Harness, organiser: { accessToken: string; user: { id: string } }) {
  await h.http().put("/api/v1/payout-accounts/me").set(bearer(organiser.accessToken)).send({ holderName: "Org Name", accountNumber: "123456789012", ifsc: "HDFC0001234" }).expect(200);
  const admin = await staffSignIn(h);
  await h.http().post(`/api/v1/admin/payout-accounts/${organiser.user.id}/verify`).set(bearer(admin.accessToken)).expect(200);
}
