import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { ledgerEntries, payoutAccounts } from "@force-pulse/db";
import { loadConfig } from "../src/config";
import { bearer, readyForPaid, signIn, staffSignIn, startHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

let n = 0;
const person = () => signIn(h, `93${String(10_000_000 + ++n).slice(-8)}`);
type Session = Awaited<ReturnType<typeof person>>;
const v1 = (url: string) => `/api/v1${url}`;
const as = (s: Session) => ({
  get: (url: string) => h.http().get(v1(url)).set(bearer(s.accessToken)),
  post: (url: string, body: object = {}) => h.http().post(v1(url)).set(bearer(s.accessToken)).send(body),
  put: (url: string, body: object) => h.http().put(v1(url)).set(bearer(s.accessToken)).send(body),
});

/** Razorpay calling our webhook with a signed body. */
const webhook = (body: string, signature: string) => h.http().post(v1("/payments/webhook")).set("Content-Type", "application/json").set("X-Razorpay-Signature", signature).send(body);

async function paidTournament(o: { fee?: number; extra?: object; startsAt?: string } = {}) {
  const org = await person();
  await readyForPaid(h, org);
  const res = await as(org)
    .post("/tournaments", {
      name: "Paid Open",
      startsAt: o.startsAt ?? "2026-11-20T03:30:00Z",
      endsAt: "2026-11-21T12:30:00Z",
      status: "enrollment_open",
      events: [{ sportId: "badminton", entryType: "individual", feePaise: o.fee ?? 100_000 }],
      ...o.extra,
    })
    .expect(201);
  return { org, t: res.body as { id: string; events: { id: string }[] } };
}

async function registerAndOrder(t: { id: string; events: { id: string }[] }, p?: Session) {
  const player = p ?? (await person());
  const reg = await as(player).post(`/tournaments/${t.id}/registrations`, { entries: [{ eventId: t.events[0].id }] }).expect(201);
  const enrollmentId = reg.body.enrollments[0].id as string;
  const order = await as(player).post("/payments/orders", { enrollmentIds: [enrollmentId] }).expect(201);
  return { player, enrollmentId, order: order.body as { paymentId: string; razorpayOrderId: string; entryFeePaise: number; keyId: string } };
}

async function ledgerBalanced(paymentId: string) {
  const [row] = await h.db.db
    .select({ d: sql<number>`sum(${ledgerEntries.debitPaise})::int`, c: sql<number>`sum(${ledgerEntries.creditPaise})::int` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.paymentId, paymentId));
  return row.d === row.c;
}

describe("paying for an entry (FR-PAY-04 to 09, AC-02)", () => {
  it("₹1,000 by card: player pays ₹1,023.60; record shows ₹30 platform fee, ₹970 organiser share, ₹23.60 Razorpay charge", async () => {
    const { org, t } = await paidTournament();
    const { player, enrollmentId, order } = await registerAndOrder(t);
    expect(order).toMatchObject({ entryFeePaise: 100_000, keyId: "rzp_test_fake" });
    expect(h.gateway.orders.get(order.razorpayOrderId)?.amount).toBe(100_000);

    const { webhook: w } = h.gateway.pay(order.razorpayOrderId);
    expect((await webhook(w.body, w.signature).expect(200)).body).toEqual({ result: "captured" });

    const pay = await as(player).get(`/payments/${order.paymentId}`).expect(200);
    expect(pay.body).toMatchObject({
      status: "paid",
      entryFeePaise: 100_000,
      amountPaidPaise: 102_360,
      convenienceFeePaise: 2_360,
      gatewayFeePaise: 2_360,
      platformFeeBps: 300,
      platformFeePaise: 3_000,
      organiserSharePaise: 97_000,
    });
    expect(await ledgerBalanced(order.paymentId)).toBe(true);

    const entry = (await as(player).get("/me/enrollments")).body.find((e: { id: string }) => e.id === enrollmentId);
    expect(entry).toMatchObject({ status: "enrolled", paymentStatus: "paid" });

    const receipt = await as(player).get(`/payments/${order.paymentId}/receipt`).expect(200);
    expect(receipt.text).toContain("₹1,023.60");
    expect(receipt.text).toContain("₹23.60");

    const fin = await as(org).get(`/tournaments/${t.id}/finance`).expect(200);
    expect(fin.body).toMatchObject({ payments: 1, collectedPaise: 100_000, platformFeePaise: 3_000, organiserSharePaise: 97_000, netPayablePaise: 97_000 });
    const csv = await as(org).get(`/tournaments/${t.id}/statement.csv`).expect(200);
    expect(csv.text).toContain("1000.00,30.00,970.00");
  });

  it("ignores a replayed webhook and refuses a forged one (NFR-05)", async () => {
    const { t } = await paidTournament();
    const { order } = await registerAndOrder(t);
    const { webhook: w } = h.gateway.pay(order.razorpayOrderId);
    await webhook(w.body, w.signature).expect(200);
    const count = async () => (await h.db.db.select({ n: sql<number>`count(*)::int` }).from(ledgerEntries).where(eq(ledgerEntries.paymentId, order.paymentId)))[0].n;
    const before = await count();
    expect((await webhook(w.body, w.signature).expect(200)).body.result).toBe("duplicate");
    expect(await count()).toBe(before);

    const forged = w.body.replace('"amount":102360', '"amount":999999');
    expect((await webhook(forged, w.signature).expect(400)).body.code).toBe("PAYMENT_NOT_VERIFIED");
    await webhook(w.body, "00".repeat(32)).expect(400);
  });

  it("checkout callback counts only after the server fetches the payment from Razorpay", async () => {
    const { t } = await paidTournament();
    const { player, order } = await registerAndOrder(t);
    const { checkout } = h.gateway.pay(order.razorpayOrderId);
    await as(player).post("/payments/confirm", { ...checkout, razorpaySignature: "ab".repeat(32) }).expect(400);
    const res = await as(player).post("/payments/confirm", checkout).expect(200);
    expect(res.body.status).toBe("paid");
    // Someone else can't confirm or read it.
    await as(await person()).post("/payments/confirm", checkout).expect(404);
  });

  it("a failed payment leaves the entry unpaid, and the player can try again", async () => {
    const { t } = await paidTournament();
    const { player, enrollmentId, order } = await registerAndOrder(t);
    const failed = h.gateway.pay(order.razorpayOrderId, { status: "failed" });
    await webhook(failed.webhook.body, failed.webhook.signature).expect(200);
    expect((await as(player).get(`/payments/${order.paymentId}`)).body).toMatchObject({ status: "failed", failureReason: "Card declined" });
    expect((await as(player).get("/me/enrollments")).body[0]).toMatchObject({ status: "payment_pending", paymentStatus: "failed" });

    const retry = await as(player).post("/payments/orders", { enrollmentIds: [enrollmentId] }).expect(201);
    const ok = h.gateway.pay(retry.body.razorpayOrderId);
    await webhook(ok.webhook.body, ok.webhook.signature).expect(200);
    expect((await as(player).get("/me/enrollments")).body[0].status).toBe("enrolled");
  });

  it("with the Review add-on a paid entry waits for the organiser", async () => {
    const { t } = await paidTournament({ extra: { reviewRequired: true } });
    const { player, order } = await registerAndOrder(t);
    const { webhook: w } = h.gateway.pay(order.razorpayOrderId);
    await webhook(w.body, w.signature).expect(200);
    expect((await as(player).get("/me/enrollments")).body[0]).toMatchObject({ status: "pending_review", paymentStatus: "paid" });
  });

  it("a team fee is paid once by the captain, then team-mates can join (FR-PAY-02)", async () => {
    const org = await person();
    await readyForPaid(h, org);
    const t = (await as(org).post("/tournaments", { name: "Team Paid", startsAt: "2026-11-20T03:30:00Z", endsAt: "2026-11-21T03:30:00Z", status: "enrollment_open", events: [{ sportId: "football", entryType: "team", feePaise: 500_000 }] }).expect(201)).body;
    const captain = await person();
    const reg = await as(captain).post(`/tournaments/${t.id}/events/${t.events[0].id}/teams`, { teamName: "Payers FC" }).expect(201);
    const order = await as(captain).post("/payments/orders", { enrollmentIds: [reg.body.enrollments[0].id] }).expect(201);
    const { webhook: w } = h.gateway.pay(order.body.razorpayOrderId);
    await webhook(w.body, w.signature).expect(200);
    expect((await h.http().get(v1(`/teams/code/${reg.body.team.code}`))).body.status).toBe("confirmed");
    await as(await person()).post("/teams/join", { code: reg.body.team.code }).expect(201);
  });

  it("refuses to pay for someone else's entries", async () => {
    const { t } = await paidTournament();
    const { enrollmentId } = await registerAndOrder(t);
    await as(await person()).post("/payments/orders", { enrollmentIds: [enrollmentId] }).expect(404);
  });
});

describe("organiser bank account (FR-PAY-11, NFR-09)", () => {
  it("paid registration can't open without a verified account", async () => {
    const org = await person();
    const body = { name: "No Bank", startsAt: "2026-11-20T03:30:00Z", endsAt: "2026-11-21T03:30:00Z", status: "enrollment_open", events: [{ sportId: "badminton", entryType: "individual", feePaise: 50_000 }] };
    expect((await as(org).post("/tournaments", body).expect(409)).body.code).toBe("PAYOUT_ACCOUNT_REQUIRED");
    const draft = await as(org).post("/tournaments", { ...body, status: "draft" }).expect(201);
    await as(org).put(`/tournaments/${draft.body.id}/status`, { status: "enrollment_open" }).expect(409);
    await readyForPaid(h, org);
    await as(org).put(`/tournaments/${draft.body.id}/status`, { status: "enrollment_open" }).expect(200);
  });

  it("stores the account number encrypted and shows only the last 4 digits", async () => {
    const org = await person();
    const res = await as(org).put("/payout-accounts/me", { holderName: "Asha Rao", accountNumber: "998877665544", ifsc: "icic0001234" }).expect(200);
    expect(res.body).toEqual({ holderName: "Asha Rao", accountNumberMasked: "••••••5544", ifsc: "ICIC0001234", verified: false, verifiedAt: null });
    const [row] = await h.db.db.select().from(payoutAccounts).where(eq(payoutAccounts.userId, org.user.id));
    expect(row.accountNumberEnc).not.toContain("998877665544");
    await as(org).put("/payout-accounts/me", { holderName: "Asha", accountNumber: "12", ifsc: "BAD" }).expect(400);
  });
});

describe("configuration guard", () => {
  it("refuses live Razorpay keys outside production", () => {
    const env = { NODE_ENV: "development", JWT_SECRET: "x".repeat(40), OTP_SECRET: "y".repeat(40), RAZORPAY_KEY_ID: "rzp_live_abc", RAZORPAY_KEY_SECRET: "s", RAZORPAY_WEBHOOK_SECRET: "w" };
    expect(() => loadConfig(env)).toThrow(/Live Razorpay keys/);
    expect(() => loadConfig({ ...env, RAZORPAY_KEY_ID: "rzp_test_abc" })).not.toThrow();
    expect(() => loadConfig({ ...env, RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_WEBHOOK_SECRET: undefined })).toThrow(/all three/);
  });
});

// Moves the test clock forward, so it runs last.
describe("late payment and organiser payout by hand (FR-PAY-10, decision 10 Oct 2026)", () => {
  it("after the tournament is completed, staff pay the organiser 97% and record the bank reference", async () => {
    h.clock.set("2026-11-10T04:00:00Z");
    const { org, t } = await paidTournament({ fee: 100_000 });
    const a = await registerAndOrder(t);
    const b = await registerAndOrder(t);
    for (const o of [a, b]) {
      const { webhook: w } = h.gateway.pay(o.order.razorpayOrderId);
      await webhook(w.body, w.signature).expect(200);
    }
    // A third player pays after their 30 minutes ran out: still counted, and flagged for the organiser.
    const late = await registerAndOrder(t);
    h.clock.advance(31 * 60);
    const lw = h.gateway.pay(late.order.razorpayOrderId).webhook;
    await webhook(lw.body, lw.signature).expect(200);
    expect((await as(late.player).get("/me/enrollments")).body[0]).toMatchObject({ status: "enrolled", flagged: true });

    const admin = await staffSignIn(h);
    await as(org).put(`/tournaments/${t.id}/status`, { status: "enrollment_closed" }).expect(200);
    expect((await as(admin).post(`/admin/tournaments/${t.id}/payouts`).expect(409)).body.message).toMatch(/after the tournament is completed/);
    await as(org).post(`/admin/tournaments/${t.id}/payouts`).expect(403);

    expect((await as(admin).get("/admin/payouts/due").expect(200)).body).toEqual([]);
    for (const status of ["fixtures_published", "live", "completed"]) await as(org).put(`/tournaments/${t.id}/status`, { status }).expect(200);

    // The admin dashboard now flags this organiser as waiting to be paid.
    const due = await as(admin).get("/admin/payouts/due").expect(200);
    expect(due.body).toEqual([expect.objectContaining({ tournamentId: t.id, organiserUserId: org.user.id, owedPaise: 3 * 97_000, bankVerified: true, accountLast4: "9012" })]);
    await as(org).get("/admin/payouts/due").expect(403);

    // A failed transfer puts the money back; the next payout takes it again.
    const first = await as(admin).post(`/admin/tournaments/${t.id}/payouts`).expect(201);
    expect(first.body).toMatchObject({ sequence: 1, status: "processing", amountPaise: 3 * 97_000 });
    await as(admin).post(`/admin/payouts/${first.body.id}/mark-failed`, { reason: "Wrong IFSC" }).expect(200);
    const second = await as(admin).post(`/admin/tournaments/${t.id}/payouts`).expect(201);
    expect(second.body).toMatchObject({ sequence: 2, amountPaise: 3 * 97_000 });
    await as(admin).post(`/admin/payouts/${second.body.id}/mark-paid`, { reference: "UTR123456789" }).expect(200);

    const fin = await as(org).get(`/tournaments/${t.id}/finance`).expect(200);
    expect(fin.body).toMatchObject({ organiserSharePaise: 3 * 97_000, paidOutPaise: 3 * 97_000, netPayablePaise: 0 });
    expect((await as(admin).post(`/admin/tournaments/${t.id}/payouts`).expect(409)).body.message).toMatch(/Nothing is owed/);
    expect((await as(admin).get("/admin/payouts/due")).body).toEqual([]);

    const money = await as(admin).get("/admin/finance").expect(200);
    expect(money.body.netRevenuePaise).toBe(money.body.platformFeePaise + money.body.convenienceFeePaise - money.body.gatewayFeePaise);
  });
});
