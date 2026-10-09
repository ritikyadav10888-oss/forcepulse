import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, signIn, startHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

let n = 0;
const person = () => signIn(h, `94${String(10_000_000 + ++n).slice(-8)}`);
type Session = Awaited<ReturnType<typeof person>>;
const as = (s: Session | null) => ({
  get: (url: string) => (s ? h.http().get(`/api/v1${url}`).set(bearer(s.accessToken)) : h.http().get(`/api/v1${url}`)),
  post: (url: string, body: object = {}) => h.http().post(`/api/v1${url}`).set(bearer(s!.accessToken)).send(body),
  put: (url: string, body: object) => h.http().put(`/api/v1${url}`).set(bearer(s!.accessToken)).send(body),
  patch: (url: string, body: object) => h.http().patch(`/api/v1${url}`).set(bearer(s!.accessToken)).send(body),
});

const day = { startDate: "2026-11-20", dayStart: "09:00", dayEnd: "18:00", matchMinutes: 30, courts: ["Court 1", "Court 2"] };
type Match = { id: string; stage: string; groupName: string | null; round: number; matchNo: number; homeEntrantId: string | null; awayEntrantId: string | null; homeName: string | null; status: string; court: string; scheduledAt: string };

/** A closed tournament with `count` enrolled players in each sport; returns entry ids in registration order. */
async function closedTournament(count: number, sports = ["badminton"]) {
  const org = await person();
  const t = (
    await as(org)
      .post("/tournaments", { name: "Fixture Cup", startsAt: "2026-11-20T03:30:00Z", endsAt: "2026-11-22T12:30:00Z", status: "enrollment_open", events: sports.map((sportId) => ({ sportId, entryType: "individual" })) })
      .expect(201)
  ).body;
  const people: Session[] = [];
  const entries: string[][] = sports.map(() => []);
  for (let i = 0; i < count; i++) {
    const p = await person();
    await as(p).patch("/me/player", { name: `Player ${i + 1}` }).expect(200);
    people.push(p);
    const reg = await as(p).post(`/tournaments/${t.id}/registrations`, { entries: t.events.map((e: { id: string }) => ({ eventId: e.id })) }).expect(201);
    reg.body.enrollments.forEach((e: { id: string }, k: number) => entries[k].push(e.id));
  }
  await as(org).put(`/tournaments/${t.id}/status`, { status: "enrollment_closed" }).expect(200);
  return { org, t, people, entries };
}

const matchesOf = async (tid: string): Promise<Match[]> => (await as(null).get(`/tournaments/${tid}/matches`).expect(200)).body;
const score = (org: Session, id: string, homeScore: number, awayScore: number, extra: object = {}) =>
  as(org).post(`/matches/${id}/result`, { type: "score", homeScore, awayScore, ...extra });

describe("knockout (FR-TRN-06, FR-TRN-11)", () => {
  it("6 players, seeded: byes for the top 2, winners and semi-final losers move on by themselves", async () => {
    const { org, t, entries } = await closedTournament(6);
    const seeds = entries[0];
    const fmt = await as(org).put(`/events/${t.events[0].id}/format`, { type: "knockout", config: { thirdPlace: true, seeding: "manual", seeds } }).expect(200);
    expect(fmt.body.config).toMatchObject({ groups: 1, points: { win: 3, draw: 1, loss: 0 }, thirdPlace: true });
    await as(org).post(`/formats/${fmt.body.id}/fixtures`, day).expect(201);

    let ms = await matchesOf(t.id);
    expect(ms).toHaveLength(6); // 2 first-round, 2 semis, final, third place
    const byNo = (no: number) => ms.find((m) => m.matchNo === no)!;
    expect([byNo(1).homeEntrantId, byNo(1).awayEntrantId]).toEqual([seeds[3], seeds[4]]);
    expect(byNo(3).homeEntrantId).toBe(seeds[0]); // seed 1 had a bye
    expect(byNo(3).homeName).toBe("Player 1");

    await score(org, byNo(1).id, 21, 15).expect(200);
    await score(org, byNo(2).id, 10, 21).expect(200);
    ms = await matchesOf(t.id);
    expect([byNo(3).awayEntrantId, byNo(4).awayEntrantId]).toEqual([seeds[3], seeds[5]]);

    await score(org, byNo(3).id, 21, 19).expect(200);
    await score(org, byNo(4).id, 18, 21).expect(200);
    ms = await matchesOf(t.id);
    expect([byNo(5).homeEntrantId, byNo(5).awayEntrantId]).toEqual([seeds[0], seeds[5]]); // final
    expect([byNo(6).homeEntrantId, byNo(6).awayEntrantId]).toEqual([seeds[3], seeds[1]]); // third place

    // A knockout match needs a winner; a level score needs a named winner.
    expect((await score(org, byNo(5).id, 20, 20).expect(400)).body.message).toMatch(/needs a winner/);
    await score(org, byNo(5).id, 20, 20, { winnerEntrantId: seeds[5] }).expect(200);
    // Once the final is played, the semi-final result is locked.
    expect((await score(org, byNo(3).id, 0, 21).expect(409)).body.message).toMatch(/next round has started/);
  });
});

describe("league + knockout (FR-TRN-05, FR-TRN-07)", () => {
  it("group tables decide who meets whom in the knockout", async () => {
    const { org, t, entries } = await closedTournament(8);
    const fmt = await as(org)
      .put(`/events/${t.events[0].id}/format`, { type: "league_knockout", config: { groups: 2, qualifiersPerGroup: 2, seeding: "manual", seeds: entries[0] } })
      .expect(200);
    await as(org).post(`/formats/${fmt.body.id}/fixtures`, day).expect(201);
    let ms = await matchesOf(t.id);
    const group = ms.filter((m) => m.stage === "group");
    expect(group).toHaveLength(12);

    // In every group match the higher seed wins, except one draw.
    const rank = (id: string) => entries[0].indexOf(id);
    for (const [i, m] of group.entries()) {
      const homeBetter = rank(m.homeEntrantId!) < rank(m.awayEntrantId!);
      await score(org, m.id, i === 0 ? 1 : homeBetter ? 2 : 0, i === 0 ? 1 : homeBetter ? 0 : 2).expect(200);
    }

    const tables = (await as(null).get(`/tournaments/${t.id}/standings`).expect(200)).body;
    expect(tables.map((g: { group: string }) => g.group)).toEqual(["A", "B"]);
    expect(tables[0].rows[0]).toMatchObject({ position: 1, played: 3, name: expect.stringMatching(/^Player/) });

    ms = await matchesOf(t.id);
    const ko = ms.filter((m) => m.stage === "knockout" && m.round === 1);
    const place = (g: number, p: number) => tables[g].rows[p - 1].entrantId;
    expect(ko.map((m) => [m.homeEntrantId, m.awayEntrantId])).toEqual([
      [place(0, 1), place(1, 2)],
      [place(1, 1), place(0, 2)],
    ]);
  });
});

describe("scheduling and edits (FR-TRN-08 to 10, FR-TRN-12)", () => {
  it("two sports share courts and players without clashes", async () => {
    const { org, t } = await closedTournament(4, ["badminton", "table-tennis"]);
    for (const ev of t.events) {
      const f = await as(org).put(`/events/${ev.id}/format`, { type: "league" }).expect(200);
      await as(org).post(`/formats/${f.body.id}/fixtures`, day).expect(201);
    }
    const ms = await matchesOf(t.id);
    expect(ms).toHaveLength(12);
    const courtSlots = ms.map((m) => `${m.scheduledAt}|${m.court}`);
    expect(new Set(courtSlots).size).toBe(courtSlots.length);
    // Each player is in both sports; their two entries must never start at the same time.
    const enrollmentsPlayer = new Map<string, string>();
    const list = (await as(org).get(`/tournaments/${t.id}/enrollments`)).body as { id: string; playerId: string }[];
    list.forEach((e) => enrollmentsPlayer.set(e.id, e.playerId));
    const seen = new Set<string>();
    for (const m of ms) {
      for (const e of [m.homeEntrantId!, m.awayEntrantId!]) {
        const key = `${m.scheduledAt}|${enrollmentsPlayer.get(e)}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it("organiser reschedules (with a clash warning), assigns a scorer, records draws, walkovers and cancellations", async () => {
    const { org, t, people } = await closedTournament(4);
    const f = await as(org).put(`/events/${t.events[0].id}/format`, { type: "league" }).expect(200);
    await as(org).post(`/formats/${f.body.id}/fixtures`, day).expect(201);
    const [m1, m2, m3, m4] = await matchesOf(t.id);

    const moved = await as(org).patch(`/matches/${m2.id}`, { scheduledAt: m1.scheduledAt, court: m1.court }).expect(200);
    expect(moved.body.warnings).toContain(`Court ${m1.court} already has a match at this time.`);

    // Any player can score; the Scorer role is added (FR-AUTH-04, FR-TRN-10).
    const scorer = people[0];
    await as(org).patch(`/matches/${m1.id}`, { scorerUserId: scorer.user.id }).expect(200);
    expect((await as(scorer).get("/me/roles")).body.roles).toContain("scorer");
    await score(scorer, m1.id, 15, 15).expect(200); // league draw
    await score(people[1], m2.id, 1, 0).expect(403); // not this match's scorer

    await as(org).post(`/matches/${m3.id}/result`, { type: "walkover", winnerEntrantId: m3.homeEntrantId, reason: "Opponent absent" }).expect(200);
    await as(org).post(`/matches/${m4.id}/cancel`, { reason: "Rain" }).expect(200);
    const after = await matchesOf(t.id);
    expect(after.find((m) => m.id === m1.id)).toMatchObject({ status: "completed", homeScore: 15, awayScore: 15, winnerEntrantId: null });
    expect(after.find((m) => m.id === m3.id)).toMatchObject({ status: "walkover", resultNote: "Opponent absent" });
    expect(after.find((m) => m.id === m4.id)?.status).toBe("cancelled");

    // Played matches lock the fixtures.
    await as(org).post(`/formats/${f.body.id}/fixtures`, day).expect(409);
  });

  it("refuses while registration is open, and to anyone but the organiser", async () => {
    const org = await person();
    const t = (await as(org).post("/tournaments", { name: "Open", startsAt: "2026-11-20T03:30:00Z", endsAt: "2026-11-21T03:30:00Z", status: "enrollment_open", events: [{ sportId: "badminton", entryType: "individual" }] }).expect(201)).body;
    await as(await person()).put(`/events/${t.events[0].id}/format`, { type: "league" }).expect(403);
    const f = await as(org).put(`/events/${t.events[0].id}/format`, { type: "league" }).expect(200);
    expect((await as(org).post(`/formats/${f.body.id}/fixtures`, day).expect(409)).body.message).toMatch(/Close registration/);
  });
});
