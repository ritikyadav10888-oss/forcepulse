import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventBus } from "../src/common/event-bus";
import { bearer, requestOtp, signIn, staffSignIn, startHarness, SUPER_ADMIN, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

// Each test uses its own number, so tests don't share rate-limit counters.
let n = 0;
const nextPhone = () => `98${String(10_000_000 + ++n).slice(-8)}`;

describe("OTP sign-in (FR-AUTH-01, FR-AUTH-02)", () => {
  it("creates a player account on first sign-in, and finds it on the next", async () => {
    const phone = nextPhone();
    const first = await signIn(h, phone);
    expect(first.isNewUser).toBe(true);
    expect(first.user.roles).toEqual(["player"]);
    expect(first.user.platformRole).toBe("player");

    const second = await signIn(h, phone);
    expect(second.isNewUser).toBe(false);
    expect(second.user.id).toBe(first.user.id);

    const me = await h.http().get("/api/v1/me/player").set(bearer(second.accessToken)).expect(200);
    expect(me.body.playerCode).toMatch(/^FP[2-9A-Z]{6}$/);
  });

  it("refuses an invalid mobile number", async () => {
    const res = await requestOtp(h, "12345").expect(400);
    expect(res.body.code).toBe("INVALID_PHONE");
  });

  it("allows 3 sends per number per 15 minutes, then refuses", async () => {
    const phone = nextPhone();
    for (let i = 0; i < 3; i++) await requestOtp(h, phone).expect(200);
    const res = await requestOtp(h, phone).expect(429);
    expect(res.body.code).toBe("OTP_RATE_LIMITED");

    h.clock.advance(15 * 60 + 1);
    await requestOtp(h, phone).expect(200);
  });

  it("allows 10 sends per network per 15 minutes", async () => {
    const ip = "203.0.113.7";
    for (let i = 0; i < 10; i++) await requestOtp(h, nextPhone(), ip).expect(200);
    const res = await requestOtp(h, nextPhone(), ip).expect(429);
    expect(res.body.code).toBe("OTP_RATE_LIMITED");
  });

  it("expires a code after 5 minutes", async () => {
    const phone = nextPhone();
    await requestOtp(h, phone).expect(200);
    const code = h.otp.last.get(`+91${phone}`)!;
    h.clock.advance(5 * 60);
    const res = await h.http().post("/api/v1/auth/verify").send({ phone, code }).expect(400);
    expect(res.body.code).toBe("OTP_EXPIRED");
  });

  it("locks the code after 5 wrong tries, even if the right code follows", async () => {
    const phone = nextPhone();
    await requestOtp(h, phone).expect(200);
    const code = h.otp.last.get(`+91${phone}`)!;
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 1; i <= 4; i++) {
      const res = await h.http().post("/api/v1/auth/verify").send({ phone, code: wrong }).expect(400);
      expect(res.body).toMatchObject({ code: "OTP_INVALID", details: { attemptsLeft: 5 - i } });
    }
    expect((await h.http().post("/api/v1/auth/verify").send({ phone, code: wrong })).body.code).toBe("OTP_LOCKED");
    expect((await h.http().post("/api/v1/auth/verify").send({ phone, code })).body.code).toBe("OTP_LOCKED");
  });

  it("accepts a code only once", async () => {
    const phone = nextPhone();
    await requestOtp(h, phone).expect(200);
    const code = h.otp.last.get(`+91${phone}`)!;
    await h.http().post("/api/v1/auth/verify").send({ phone, code }).expect(200);
    const res = await h.http().post("/api/v1/auth/verify").send({ phone, code }).expect(400);
    expect(res.body.code).toBe("OTP_INVALID");
  });

  it("never returns the code when a real sender is used", async () => {
    const res = await requestOtp(h, nextPhone()).expect(200);
    expect(res.body).toEqual({ sent: true, expiresInSeconds: 300, resendAfterSeconds: 30 });
  });
});

describe("staff sign-in", () => {
  it("signs a super admin in with email and password", async () => {
    const res = await h.http().post("/api/v1/auth/staff/login").send(SUPER_ADMIN).expect(200);
    expect(res.body.user.platformRole).toBe("super_admin");
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const a = await h.http().post("/api/v1/auth/staff/login").send({ ...SUPER_ADMIN, password: "nope-nope" }).expect(401);
    const b = await h.http().post("/api/v1/auth/staff/login").send({ email: "nobody@x.in", password: "nope-nope" }).expect(401);
    expect(a.body).toEqual(b.body);
  });

  it("refuses OTP for a staff member's phone", async () => {
    const phone = nextPhone();
    const player = await signIn(h, phone);
    const admin = await staffSignIn(h);
    await h.http().put(`/api/v1/admin/users/${player.user.id}/platform-role`).set(bearer(admin.accessToken)).send({ platformRole: "admin" }).expect(200);
    const res = await requestOtp(h, phone).expect(403);
    expect(res.body.code).toBe("STAFF_USE_STAFF_LOGIN");
  });
});

describe("sessions", () => {
  it("rotates refresh tokens: the old one stops working", async () => {
    const s = await signIn(h, nextPhone());
    const next = await h.http().post("/api/v1/auth/refresh").send({ refreshToken: s.refreshToken }).expect(200);
    expect(next.body.refreshToken).not.toBe(s.refreshToken);
    await h.http().post("/api/v1/auth/refresh").send({ refreshToken: s.refreshToken }).expect(401);
    await h.http().get("/api/v1/me").set(bearer(next.body.accessToken)).expect(200);
  });

  it("logout ends the session at once", async () => {
    const s = await signIn(h, nextPhone());
    await h.http().post("/api/v1/auth/logout").set(bearer(s.accessToken)).expect(204);
    await h.http().get("/api/v1/me").set(bearer(s.accessToken)).expect(401);
    await h.http().post("/api/v1/auth/refresh").send({ refreshToken: s.refreshToken }).expect(401);
  });

  it("refuses calls without a token or with a forged one", async () => {
    expect((await h.http().get("/api/v1/me").expect(401)).body.code).toBe("UNAUTHENTICATED");
    await h.http().get("/api/v1/me").set(bearer("not.a.jwt")).expect(401);
  });
});

describe("stacked roles (FR-AUTH-03 to 05, AC-06)", () => {
  it("adds Organiser and Scorer from events, once each", async () => {
    const s = await signIn(h, nextPhone());
    const events = h.app.get(EventBus);
    await events.publish({ type: "TournamentCreated", tournamentId: "t1", organiserUserId: s.user.id });
    await events.publish({ type: "TournamentCreated", tournamentId: "t2", organiserUserId: s.user.id });
    await events.publish({ type: "MatchStartedBy", matchId: "m1", userId: s.user.id });

    const res = await h.http().get("/api/v1/me/roles").set(bearer(s.accessToken)).expect(200);
    expect(res.body).toEqual({ roles: ["player", "organiser", "scorer"], suspendedRoles: [], label: "Player / Organiser / Scorer", platformRole: "player" });
  });

  it("a suspended role is refused on the next call, and restoring brings it back (FR-AUTH-07)", async () => {
    const phone = nextPhone();
    const s = await signIn(h, phone);
    const admin = await staffSignIn(h);
    const suspendUrl = `/api/v1/admin/users/${s.user.id}/roles/player`;
    await h.http().post(`${suspendUrl}/suspend`).set(bearer(admin.accessToken)).send({ reason: "test" }).expect(200);

    // Suspension signs the user out everywhere.
    await h.http().get("/api/v1/me/player").set(bearer(s.accessToken)).expect(401);

    // Signing in again works, but player-only routes say the role is suspended.
    const again = await signIn(h, phone);
    expect(again.user.roles).toEqual([]);
    const refused = await h.http().get("/api/v1/me/player").set(bearer(again.accessToken)).expect(403);
    expect(refused.body.code).toBe("ROLE_SUSPENDED");

    await h.http().post(`${suspendUrl}/restore`).set(bearer(admin.accessToken)).send({}).expect(200);
    await h.http().get("/api/v1/me/player").set(bearer(again.accessToken)).expect(200);

    const log = await h.http().get(`/api/v1/admin/audit-logs?entity=user_role&entityId=${s.user.id}:player`).set(bearer(admin.accessToken)).expect(200);
    expect(log.body.map((r: { action: string }) => r.action)).toEqual(["restore", "suspend"]);
  });

  it("a player can't reach admin routes", async () => {
    const s = await signIn(h, nextPhone());
    const res = await h.http().get("/api/v1/admin/settings/fees").set(bearer(s.accessToken)).expect(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });
});
