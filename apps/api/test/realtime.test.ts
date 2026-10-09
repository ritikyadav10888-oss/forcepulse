import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { bearer, readyForPaid, signIn, startHarness, type Harness } from "./harness";

let h: Harness;
let url: string;
const sockets: Socket[] = [];
beforeAll(async () => {
  h = await startHarness();
  await h.app.listen(0);
  url = `http://127.0.0.1:${(h.app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await h.close();
});

const connect = async (token?: string) => {
  const s = io(url, { auth: token ? { token } : {}, transports: ["websocket"], forceNew: true });
  sockets.push(s);
  await new Promise<void>((ok, fail) => {
    s.once("connect", ok);
    s.once("connect_error", fail);
  });
  return s;
};
const subscribe = (s: Socket, room: string) => s.emitWithAck("subscribe", room) as Promise<{ ok: boolean; error?: string }>;
/** Resolves with the next `event`, or fails after 2 s (the NFR-03 budget for scores). */
const next = <T>(s: Socket, event: string) =>
  new Promise<T>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`no ${event} within 2 s`)), 2000);
    s.once(event, (data: T) => {
      clearTimeout(timer);
      ok(data);
    });
  });

let n = 0;
const person = () => signIn(h, `90${String(10_000_000 + ++n).slice(-8)}`);
type Session = Awaited<ReturnType<typeof person>>;
const post = (s: Session, path: string, body: object = {}) => h.http().post(`/api/v1${path}`).set(bearer(s.accessToken)).send(body);
const put = (s: Session, path: string, body: object) => h.http().put(`/api/v1${path}`).set(bearer(s.accessToken)).send(body);

async function liveMatch() {
  const org = await person();
  const t = (await post(org, "/tournaments", { name: "Live Cup", startsAt: "2026-11-20T03:30:00Z", endsAt: "2026-11-21T03:30:00Z", status: "enrollment_open", events: [{ sportId: "badminton", entryType: "individual" }] }).expect(201)).body;
  for (let i = 0; i < 2; i++) await post(await person(), `/tournaments/${t.id}/registrations`, { entries: [{ eventId: t.events[0].id }] }).expect(201);
  await put(org, `/tournaments/${t.id}/status`, { status: "enrollment_closed" }).expect(200);
  const f = await put(org, `/events/${t.events[0].id}/format`, { type: "league", rules: { pointsToWin: 11, winBy: 2, cap: 0, bestOf: "1" } }).expect(200);
  await post(org, `/formats/${f.body.id}/fixtures`, { startDate: "2026-11-20", dayStart: "09:00", dayEnd: "18:00", matchMinutes: 30, courts: ["C1"] }).expect(201);
  const [match] = (await h.http().get(`/api/v1/tournaments/${t.id}/matches`)).body;
  return { org, t, match };
}

describe("live updates (NFR-03, FR-SCR-13)", () => {
  it("viewers of a match get each score within 2 s, and the tournament page gets the table after the result", async () => {
    const { org, t, match } = await liveMatch();
    const viewer = await connect(); // public, no login
    expect(await subscribe(viewer, `match:${match.id}`)).toEqual({ ok: true });
    expect(await subscribe(viewer, `tournament:${t.id}`)).toEqual({ ok: true });

    await post(org, `/matches/${match.id}/start`, { deviceId: "live-device-1" }).expect(200);
    const update = next<{ scores: { home: number }; summary: { headline: string } }>(viewer, "score.updated");
    await post(org, `/matches/${match.id}/events`, { deviceId: "live-device-1", events: [{ id: randomUUID(), seq: 1, action: "point", payload: { side: "home" } }] }).expect(200);
    expect((await update).summary.headline).toBe("1–0");

    const points = Array.from({ length: 10 }, (_, i) => ({ id: randomUUID(), seq: i + 2, action: "point", payload: { side: "home" } }));
    await post(org, `/matches/${match.id}/events`, { deviceId: "live-device-1", events: points }).expect(200);
    const table = next<{ rows: { won: number }[] }[]>(viewer, "standings.updated");
    await post(org, `/matches/${match.id}/close`).expect(200);
    expect((await table)[0].rows.map((r) => r.won)).toEqual([1, 0]);
  });

  it("drafts and unknown rooms stay private", async () => {
    const org = await person();
    const draft = (await post(org, "/tournaments", { name: "Secret", startsAt: "2026-11-20T03:30:00Z", endsAt: "2026-11-21T03:30:00Z", events: [{ sportId: "badminton", entryType: "individual" }] }).expect(201)).body;
    const stranger = await connect();
    expect(await subscribe(stranger, `tournament:${draft.id}`)).toEqual({ ok: false, error: "Not found" });
    expect(await subscribe(stranger, "user:anyone")).toEqual({ ok: false, error: "Unknown room" });
    const owner = await connect(org.accessToken);
    expect(await subscribe(owner, `tournament:${draft.id}`)).toEqual({ ok: true });
  });

  it("a player hears about their own payment in their private room", async () => {
    const org = await person();
    await readyForPaid(h, org);
    const t = (await post(org, "/tournaments", { name: "Paid Live", startsAt: "2026-11-20T03:30:00Z", endsAt: "2026-11-21T03:30:00Z", status: "enrollment_open", events: [{ sportId: "badminton", entryType: "individual", feePaise: 50_000 }] }).expect(201)).body;
    const player = await person();
    const socket = await connect(player.accessToken);
    const reg = await post(player, `/tournaments/${t.id}/registrations`, { entries: [{ eventId: t.events[0].id }] }).expect(201);
    const order = await post(player, "/payments/orders", { enrollmentIds: [reg.body.enrollments[0].id] }).expect(201);

    const heard = next<{ status: string; entryFeePaise: number }>(socket, "payment.updated");
    const { webhook } = h.gateway.pay(order.body.razorpayOrderId);
    await h.http().post("/api/v1/payments/webhook").set("Content-Type", "application/json").set("X-Razorpay-Signature", webhook.signature).send(webhook.body).expect(200);
    expect(await heard).toMatchObject({ status: "paid", entryFeePaise: 50_000 });
  });
});
