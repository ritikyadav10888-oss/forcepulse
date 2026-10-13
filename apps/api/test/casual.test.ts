import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, signIn, startHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

const rules = { pointsToWin: 3, winBy: 1, cap: 0, bestOf: "1" };

describe("casual matches (FR-SCR-05)", () => {
  it("a player sets up a match by mobile numbers, scores it, and it reaches both profiles", async () => {
    const me = await signIn(h, "9400000001");
    const post = (path: string, body: object) => h.http().post(`/api/v1${path}`).set(bearer(me.accessToken)).send(body);

    const created = await post("/matches/casual", {
      sportId: "badminton",
      rules,
      home: { name: "Me", players: [{ phone: "9400000001" }] },
      // A number that has never signed in gets an account and a player id, like OTP sign-in would.
      away: { name: "Ravi", players: [{ phone: "9400000003", name: "Ravi Kumar" }] },
    }).expect(201);
    const id = created.body.matchId;

    await post(`/matches/${id}/start`, { deviceId: "casual-phone" }).expect(200);
    await post(`/matches/${id}/events`, { deviceId: "casual-phone", events: [1, 2, 3].map((seq) => ({ id: randomUUID(), seq, action: "point", payload: { side: "home" } })) }).expect(200);
    await post(`/matches/${id}/close`, {}).expect(200);

    const live = (await h.http().get(`/api/v1/matches/${id}/live`).expect(200)).body;
    expect(live).toMatchObject({ status: "completed", homeName: "Me", awayName: "Ravi", winner: "home" });

    // Creating a casual match doesn't make you an organiser; scoring it makes you a scorer.
    expect((await h.http().get("/api/v1/me/roles").set(bearer(me.accessToken))).body.label).toBe("Player / Scorer");
    expect((await h.http().get("/api/v1/me/tournaments").set(bearer(me.accessToken))).body).toEqual([]);
    expect((await h.http().get("/api/v1/me/casual-matches").set(bearer(me.accessToken))).body).toEqual([expect.objectContaining({ matchId: id, name: "Me vs Ravi", status: "completed" })]);

    // Ravi signs in later with the same number and finds the match on his profile; it isn't listed as a tournament.
    const ravi = await signIn(h, "9400000003");
    const raviPlayer = (await h.http().get("/api/v1/me/player").set(bearer(ravi.accessToken))).body;
    expect(raviPlayer.name).toBe("Ravi Kumar");
    const profile = (await h.http().get(`/api/v1/players/${raviPlayer.id}/profile`)).body;
    expect(profile.totals).toEqual({ played: 1, won: 0, winPct: 0 });
    expect(profile.history).toEqual([]);
  });

  it("refuses bad numbers, duplicates and rules the sport doesn't accept", async () => {
    const me = await signIn(h, "9400000010");
    const post = (body: object) => h.http().post("/api/v1/matches/casual").set(bearer(me.accessToken)).send(body);
    const side = (phone: string) => ({ name: "A", players: [{ phone }] });
    expect((await post({ sportId: "badminton", rules, home: side("12345"), away: side("9400000011") }).expect(400)).body.code).toBe("INVALID_PHONE");
    expect((await post({ sportId: "badminton", rules, home: side("9400000011"), away: side("9400000011") }).expect(400)).body.message).toMatch(/both sides/);
    expect((await post({ sportId: "badminton", rules: { pointsToWin: 21 }, home: side("9400000011"), away: side("9400000012") }).expect(400)).body.message).toMatch(/required/);
    expect((await post({ sportId: "golf", rules, home: side("9400000011"), away: side("9400000012") }).expect(400)).body.message).toMatch(/isn't available/);
  });
});
