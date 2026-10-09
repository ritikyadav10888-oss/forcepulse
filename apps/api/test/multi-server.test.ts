import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { bearer, signIn, startHarness, type Harness } from "./harness";

// Needs a Redis server: REDIS_URL=redis://127.0.0.1:6379 npm test
const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!REDIS_URL)("live updates across API servers (Redis adapter)", () => {
  let h: Harness;
  let serverB: INestApplication;
  let viewer: Socket;

  beforeAll(async () => {
    h = await startHarness({ redisUrl: REDIS_URL });
    await h.app.listen(0);
    serverB = await h.extraApp();
    await serverB.listen(0);
  });
  afterAll(async () => {
    viewer?.disconnect();
    await h?.close();
  });

  it("a point entered on server A reaches a viewer connected to server B", async () => {
    const post = (s: { accessToken: string }, path: string, body: object = {}) => h.http().post(`/api/v1${path}`).set(bearer(s.accessToken)).send(body);
    const org = await signIn(h, "8800000001");
    const t = (await post(org, "/tournaments", { name: "Two Servers", startsAt: "2026-11-20T03:30:00Z", endsAt: "2026-11-21T03:30:00Z", status: "enrollment_open", events: [{ sportId: "badminton", entryType: "individual" }] }).expect(201)).body;
    for (const phone of ["8800000002", "8800000003"]) await post(await signIn(h, phone), `/tournaments/${t.id}/registrations`, { entries: [{ eventId: t.events[0].id }] }).expect(201);
    await h.http().put(`/api/v1/tournaments/${t.id}/status`).set(bearer(org.accessToken)).send({ status: "enrollment_closed" }).expect(200);
    const f = await h.http().put(`/api/v1/events/${t.events[0].id}/format`).set(bearer(org.accessToken)).send({ type: "league", rules: { pointsToWin: 11, winBy: 2, cap: 0, bestOf: "1" } }).expect(200);
    await post(org, `/formats/${f.body.id}/fixtures`, { startDate: "2026-11-20", dayStart: "09:00", dayEnd: "18:00", matchMinutes: 30, courts: ["C1"] }).expect(201);
    const [match] = (await h.http().get(`/api/v1/tournaments/${t.id}/matches`)).body;
    await post(org, `/matches/${match.id}/start`, { deviceId: "server-a-device" }).expect(200);

    const portB = (serverB.getHttpServer().address() as AddressInfo).port;
    viewer = io(`http://127.0.0.1:${portB}`, { transports: ["websocket"], forceNew: true });
    await new Promise<void>((ok, fail) => (viewer.once("connect", ok), viewer.once("connect_error", fail)));
    expect(await viewer.emitWithAck("subscribe", `match:${match.id}`)).toEqual({ ok: true });

    const heard = new Promise<{ summary: { headline: string } }>((ok, fail) => {
      const timer = setTimeout(() => fail(new Error("no update on server B within 2 s")), 2000);
      viewer.once("score.updated", (s) => (clearTimeout(timer), ok(s)));
    });
    await post(org, `/matches/${match.id}/events`, { deviceId: "server-a-device", events: [{ id: randomUUID(), seq: 1, action: "point", payload: { side: "home" } }] }).expect(200);
    expect((await heard).summary.headline).toBe("1–0");
  });
});
