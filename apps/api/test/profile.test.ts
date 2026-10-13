import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { badges } from "../src/players/profile.service";
import { bearer, signIn, startHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

let n = 0;
const person = () => signIn(h, `93${String(10_000_000 + ++n).slice(-8)}`);
type Session = Awaited<ReturnType<typeof person>>;
const as = (s: Session) => ({
  get: (url: string) => h.http().get(`/api/v1${url}`).set(bearer(s.accessToken)),
  post: (url: string, body: object = {}) => h.http().post(`/api/v1${url}`).set(bearer(s.accessToken)).send(body),
  put: (url: string, body: object) => h.http().put(`/api/v1${url}`).set(bearer(s.accessToken)).send(body),
  patch: (url: string, body: object) => h.http().patch(`/api/v1${url}`).set(bearer(s.accessToken)).send(body),
});

describe("player profile (FR-PRO-01 to 07)", () => {
  it("shows stats, history, last matches and badges from a closed match, and hides private fields from the public", async () => {
    const org = await person();
    const t = (await as(org).post("/tournaments", { name: "Profile Cup", startsAt: "2026-11-20T03:30:00Z", endsAt: "2026-11-21T03:30:00Z", status: "enrollment_open", events: [{ sportId: "badminton", entryType: "individual" }] }).expect(201)).body;
    const [a, b] = [await person(), await person()];
    await as(a).patch("/me/player", { name: "Asha Rao", dob: "2000-05-01", pincode: "400001" }).expect(200);
    await as(b).patch("/me/player", { name: "Vikram Singh" }).expect(200);
    for (const p of [a, b]) await as(p).post(`/tournaments/${t.id}/registrations`, { entries: [{ eventId: t.events[0].id }] }).expect(201);
    await as(org).put(`/tournaments/${t.id}/status`, { status: "enrollment_closed" }).expect(200);
    const f = await as(org).put(`/events/${t.events[0].id}/format`, { type: "knockout", rules: { pointsToWin: 3, winBy: 1, cap: 0, bestOf: "1" } }).expect(200);
    await as(org).post(`/formats/${f.body.id}/fixtures`, { startDate: "2026-11-20", dayStart: "09:00", dayEnd: "18:00", matchMinutes: 30, courts: ["C1"] }).expect(201);
    const [m] = (await h.http().get(`/api/v1/tournaments/${t.id}/matches`)).body;

    const aPlayer = (await as(a).get("/me/player")).body;
    const aIsHome = m.homeName === "Asha Rao";
    await as(org).post(`/matches/${m.id}/start`, { deviceId: "profile-device" }).expect(200);
    const side = aIsHome ? "home" : "away";
    const events = [1, 2, 3].map((seq) => ({ id: randomUUID(), seq, action: "point", payload: { side } }));
    await as(org).post(`/matches/${m.id}/events`, { deviceId: "profile-device", events }).expect(200);
    await as(org).post(`/matches/${m.id}/close`, { playerOfMatchId: aPlayer.id }).expect(200);

    const pub = (await h.http().get(`/api/v1/players/${aPlayer.id}/profile`).expect(200)).body;
    expect(pub.player).toMatchObject({ name: "Asha Rao", dob: null, pincode: null });
    expect(pub.totals).toEqual({ played: 1, won: 1, winPct: 100 });
    expect(pub.sports).toEqual([expect.objectContaining({ sportId: "badminton", played: 1, won: 1, lost: 0, stats: {} })]); // points weren't credited to a named player
    expect(pub.history).toEqual([expect.objectContaining({ tournamentName: "Profile Cup", sportId: "badminton", finish: "Winner" })]);
    expect(pub.lastMatches).toEqual([expect.objectContaining({ opponent: "Vikram Singh", result: "won", score: "1–0", playerOfMatch: true })]);
    expect(pub.badges.map((x: { id: string }) => x.id)).toEqual(["debut", "first-win", "potm", "champion"]);
    expect(pub.roleLabel).toBe("Player");

    const own = (await as(a).get(`/players/${aPlayer.id}/profile`).expect(200)).body;
    expect(own.player).toMatchObject({ dob: "2000-05-01", pincode: "400001" });

    const loser = (await h.http().get(`/api/v1/players/${(await as(b).get("/me/player")).body.id}/profile`)).body;
    expect(loser.totals).toEqual({ played: 1, won: 0, winPct: 0 });
    expect(loser.history[0].finish).toBe("Runner-up");

    const organiser = (await h.http().get(`/api/v1/players/${(await as(org).get("/me/player")).body.id}/profile`)).body;
    // The organiser scored the match themselves, so they are also a Scorer (FR-AUTH-04).
    expect(organiser).toMatchObject({ tournamentsOrganised: 1, matchesScored: 1, roleLabel: "Player / Organiser / Scorer" });
  });

  it("badges come from what was done", () => {
    expect(badges({ played: 0, won: 0, potm: 0, titles: 0, sports: 0, sold: false })).toEqual([]);
    expect(badges({ played: 12, won: 5, potm: 2, titles: 0, sports: 2, sold: true }).map((x) => x.label)).toEqual(["First match", "First win", "10 matches", "Player of the Match ×2", "Multi-sport", "Sold at auction"]);
  });
});
