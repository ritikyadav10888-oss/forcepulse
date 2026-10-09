import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, signIn, startHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

let n = 0;
const person = () => signIn(h, `91${String(10_000_000 + ++n).slice(-8)}`);
type Session = Awaited<ReturnType<typeof person>>;
const as = (s: Session | null) => ({
  get: (url: string) => (s ? h.http().get(`/api/v1${url}`).set(bearer(s.accessToken)) : h.http().get(`/api/v1${url}`)),
  post: (url: string, body: object = {}) => h.http().post(`/api/v1${url}`).set(bearer(s!.accessToken)).send(body),
  put: (url: string, body: object) => h.http().put(`/api/v1${url}`).set(bearer(s!.accessToken)).send(body),
  patch: (url: string, body: object) => h.http().patch(`/api/v1${url}`).set(bearer(s!.accessToken)).send(body),
});
const day = { startDate: "2026-11-20", dayStart: "09:00", dayEnd: "18:00", matchMinutes: 30, courts: ["Court 1"] };

/** A closed tournament, its format set with `rules`, fixtures generated; returns the first match. */
async function readyMatch(sportId: string, type: "knockout" | "league", players: number, rules: object | null) {
  const org = await person();
  const t = (
    await as(org)
      .post("/tournaments", { name: "Score Cup", startsAt: "2026-11-20T03:30:00Z", endsAt: "2026-11-21T03:30:00Z", status: "enrollment_open", events: [{ sportId, entryType: "individual" }] })
      .expect(201)
  ).body;
  const people: Session[] = [];
  for (let i = 0; i < players; i++) {
    const p = await person();
    people.push(p);
    await as(p).post(`/tournaments/${t.id}/registrations`, { entries: [{ eventId: t.events[0].id }] }).expect(201);
  }
  await as(org).put(`/tournaments/${t.id}/status`, { status: "enrollment_closed" }).expect(200);
  const f = await as(org).put(`/events/${t.events[0].id}/format`, { type, rules }).expect(200);
  await as(org).post(`/formats/${f.body.id}/fixtures`, day).expect(201);
  const [match] = (await as(null).get(`/tournaments/${t.id}/matches`)).body;
  return { org, t, people, match, formatId: f.body.id as string };
}

/** Scoring events as a device would queue them. */
function queue(from: number, actions: [string, Record<string, string | number>][]) {
  return actions.map(([action, payload], i) => ({ id: randomUUID(), seq: from + i, action, payload }));
}
const points = (side: "home" | "away", count: number): [string, Record<string, string>][] => Array.from({ length: count }, () => ["point", { side }]);

describe("live scoring end to end (FR-SCR-04 to 14, AC-07)", () => {
  it("badminton to 15, win by 2, best of 3: synced from a phone, safe to resend, closed into the bracket", async () => {
    const { org, t, people, match } = await readyMatch("badminton", "knockout", 2, { pointsToWin: 15, winBy: 2, cap: 0, bestOf: "3" });
    const scorer = people[0];
    await as(org).patch(`/matches/${match.id}`, { scorerUserId: scorer.user.id }).expect(200);

    const phone = "device-phone-001";
    const start = await as(scorer).post(`/matches/${match.id}/start`, { deviceId: phone }).expect(200);
    expect(start.body).toMatchObject({ status: "live", lastSeq: 0, phase: "setup" });

    // Game 1: 14–14, then home wins 16–14.
    const game1 = queue(1, [...points("home", 14), ...points("away", 14), ...points("home", 2)]);
    let live = (await as(scorer).post(`/matches/${match.id}/events`, { deviceId: phone, events: game1 }).expect(200)).body;
    expect(live).toMatchObject({ lastSeq: 30, scores: { home: 1, away: 0 } });

    // The phone lost signal and resends the same batch: nothing changes.
    live = (await as(scorer).post(`/matches/${match.id}/events`, { deviceId: phone, events: game1 }).expect(200)).body;
    expect(live.lastSeq).toBe(30);

    // A second phone can't take over while the first holds the match.
    const other = await as(scorer).post(`/matches/${match.id}/events`, { deviceId: "device-phone-002", events: queue(31, points("home", 1)) }).expect(409);
    expect(other.body.details).toEqual({ reason: "lease_held" });

    // An event from the future is refused with the last stored number.
    const gap = await as(scorer).post(`/matches/${match.id}/events`, { deviceId: phone, events: queue(40, points("home", 1)) }).expect(409);
    expect(gap.body.details).toEqual({ reason: "out_of_order", lastSeq: 30 });

    await as(scorer).post(`/matches/${match.id}/close`, {}).expect(409); // not over yet

    // Game 2 with an undo along the way: 14 points, undo one, then 2 more = 15.
    await as(scorer).post(`/matches/${match.id}/events`, { deviceId: phone, events: queue(31, [...points("home", 14), ["undo", {}], ...points("home", 2)]) }).expect(200);
    live = (await as(null).get(`/matches/${match.id}/live`).expect(200)).body; // public
    expect(live).toMatchObject({ phase: "complete", scores: { home: 2, away: 0 }, winner: "home", summary: { headline: "16–14  15–0" } });

    const potm = match.homeEntrantId; // an entry id is not a player id
    await as(scorer).post(`/matches/${match.id}/close`, { playerOfMatchId: potm }).expect(400);
    const closed = await as(scorer).post(`/matches/${match.id}/close`, {}).expect(200);
    expect(closed.body.status).toBe("completed");
    const [result] = (await as(null).get(`/tournaments/${t.id}/matches`)).body;
    expect(result).toMatchObject({ status: "completed", homeScore: 2, awayScore: 0, winnerEntrantId: match.homeEntrantId });
    const stored = (await as(org).get(`/matches/${match.id}/events`).expect(200)).body;
    expect(stored).toHaveLength(47);

    expect((await as(scorer).get("/me/roles")).body.roles).toContain("scorer");
  });

  it("the organiser can hand scoring to another device", async () => {
    const { org, match } = await readyMatch("table-tennis", "knockout", 2, { pointsToWin: 11, winBy: 2, cap: 0, bestOf: "1" });
    await as(org).post(`/matches/${match.id}/start`, { deviceId: "tablet-court-1" }).expect(200);
    await as(org).post(`/matches/${match.id}/events`, { deviceId: "tablet-court-2", events: queue(1, points("home", 1)) }).expect(409);
    await as(org).post(`/matches/${match.id}/release-device`).expect(204);
    await as(org).post(`/matches/${match.id}/events`, { deviceId: "tablet-court-2", events: queue(1, points("home", 1)) }).expect(200);
  });

  it("a league match can end level and counts as a draw in the table", async () => {
    const { org, t, match } = await readyMatch("hockey", "league", 2, { periods: 4, periodMinutes: 15 });
    await as(org).post(`/matches/${match.id}/start`, { deviceId: "hockey-tablet" }).expect(200);
    await as(org)
      .post(`/matches/${match.id}/events`, { deviceId: "hockey-tablet", events: queue(1, [["score", { side: "home", points: 1 }], ["score", { side: "away", points: 1 }], ["end_match", {}]]) })
      .expect(200);
    await as(org).post(`/matches/${match.id}/close`, {}).expect(200);
    const [table] = (await as(null).get(`/tournaments/${t.id}/standings`)).body;
    expect(table.rows.map((r: { drawn: number; points: number }) => [r.drawn, r.points])).toEqual([[1, 1], [1, 1]]);
  });

  it("rules: required before kick-off, checked against the sport's settings, and reusable", async () => {
    const { org, match, t } = await readyMatch("badminton", "knockout", 2, null);
    expect((await as(org).post(`/matches/${match.id}/start`, { deviceId: "phone-xyz-1" }).expect(409)).body.message).toMatch(/scoring rules/);
    const bad = await as(org).put(`/events/${t.events[0].id}/format`, { type: "knockout", rules: { pointsToWin: 15 } }).expect(400);
    expect(bad.body.message).toMatch(/Win by \(margin\) is required/);

    const knobs = (await as(null).get("/sports/badminton/rules").expect(200)).body;
    expect(knobs.knobs.map((k: { key: string }) => k.key)).toEqual(["pointsToWin", "winBy", "cap", "bestOf", "decidingGamePoints"]);
    await as(org).post("/rule-sets", { sportId: "badminton", name: "Club 15s", config: { pointsToWin: 15, winBy: 2, cap: 21, bestOf: "3" } }).expect(201);
    expect((await as(org).get("/rule-sets")).body.map((r: { name: string }) => r.name)).toEqual(["Club 15s"]);
  });

  it("only the scorer or organiser can score", async () => {
    const { org, people, match } = await readyMatch("badminton", "knockout", 2, { pointsToWin: 21, winBy: 2, cap: 30, bestOf: "3" });
    await as(people[1]).post(`/matches/${match.id}/start`, { deviceId: "intruder-phone" }).expect(403);
    await as(org).post(`/matches/${match.id}/start`, { deviceId: "org-phone-01" }).expect(200);
    await as(people[1]).post(`/matches/${match.id}/events`, { deviceId: "intruder-phone", events: queue(1, points("home", 1)) }).expect(403);
  });
});
