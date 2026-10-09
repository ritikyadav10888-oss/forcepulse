import { describe, expect, it } from "vitest";
import type { FormatConfig } from "@force-pulse/db";
import { bracketOrder, knockout, planFormat, roundRobin, schedule, splitGroups, standings, type PlannedMatch } from "../src/fixtures/plan";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `e${i + 1}`);
const config: FormatConfig = { groups: 2, legs: 1, points: { win: 3, draw: 1, loss: 0 }, tieBreakers: ["score_diff", "scored"], qualifiersPerGroup: 2, thirdPlace: true, seeding: "random", seeds: [] };

describe("round robin (FR-TRN-05)", () => {
  for (const n of [2, 3, 4, 5, 8]) {
    it(`${n} entrants: every pair once, nobody twice in a round`, () => {
      const games = roundRobin(ids(n), 1);
      expect(games).toHaveLength((n * (n - 1)) / 2);
      const pairs = new Set(games.map((g) => [g.home, g.away].sort().join("-")));
      expect(pairs.size).toBe(games.length);
      for (const r of new Set(games.map((g) => g.round))) {
        const inRound = games.filter((g) => g.round === r).flatMap((g) => [g.home, g.away]);
        expect(new Set(inRound).size).toBe(inRound.length);
      }
    });
  }

  it("double round robin plays each pair twice, home and away swapped", () => {
    const games = roundRobin(ids(4), 2);
    expect(games).toHaveLength(12);
    expect(games.filter((g) => g.home === "e1" && g.away === "e2").length + games.filter((g) => g.home === "e2" && g.away === "e1").length).toBe(2);
    expect(Math.max(...games.map((g) => g.round))).toBe(6);
  });

  it("deals seeds into groups in a snake", () => {
    expect(splitGroups(ids(8), 2)).toEqual([["e1", "e4", "e5", "e8"], ["e2", "e3", "e6", "e7"]]);
  });
});

describe("knockout (FR-TRN-06)", () => {
  it("seeds 1 and 2 meet only in the final", () => {
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it("6 entrants: top 2 seeds get byes, 2 first-round matches, third-place match from the semis", () => {
    const b = knockout(ids(6).map((entrantId) => ({ entrantId })), { thirdPlace: true });
    const r1 = b.filter((m) => m.round === 1);
    expect(r1.map((m) => [m.home, m.away])).toEqual([
      [{ entrantId: "e4" }, { entrantId: "e5" }],
      [{ entrantId: "e3" }, { entrantId: "e6" }],
    ]);
    const semis = b.filter((m) => m.round === 2);
    expect(semis.map((m) => [m.home, m.away])).toEqual([
      [{ entrantId: "e1" }, { source: "W:1" }],
      [{ entrantId: "e2" }, { source: "W:2" }],
    ]);
    expect(b.filter((m) => m.round === 3).map((m) => [m.home, m.away])).toEqual([
      [{ source: "W:3" }, { source: "W:4" }],
      [{ source: "L:3" }, { source: "L:4" }],
    ]);
  });

  it("4 entrants: semis are round 1", () => {
    const b = knockout(ids(4).map((entrantId) => ({ entrantId })), { thirdPlace: true });
    expect(b.map((m) => `${m.round}:${m.matchNo}`)).toEqual(["1:1", "1:2", "2:3", "2:4"]);
    expect(b[3]).toMatchObject({ home: { source: "L:1" }, away: { source: "L:2" } });
  });

  it("league + knockout crossover avoids same-group first-round ties (FR-TRN-07)", () => {
    const plan = planFormat("league_knockout", ids(8), config);
    expect(plan.filter((m) => m.stage === "group")).toHaveLength(12);
    expect(plan.filter((m) => m.stage === "knockout" && m.round === 1).map((m) => [m.home, m.away])).toEqual([
      [{ source: "A1" }, { source: "B2" }],
      [{ source: "B1" }, { source: "A2" }],
    ]);
  });
});

describe("scheduling (FR-TRN-08)", () => {
  const opts = { startDate: "2026-11-20", dayStart: "09:00", dayEnd: "11:00", matchMinutes: 30, courts: ["C1", "C2"] };
  const players = (s: PlannedMatch["home"]) => (s && "entrantId" in s ? [s.entrantId] : []);

  it("never puts a player or a court in two places, and rolls over to the next day", () => {
    const plan = planFormat("league", ids(6), { ...config, groups: 1 });
    const slots = schedule(plan, players, opts);
    const seen = new Set<string>();
    plan.forEach((m, i) => {
      const t = slots[i].scheduledAt.toISOString();
      for (const k of [`${t}|${slots[i].court}`, ...players(m.home).concat(players(m.away)).map((p) => `${t}|${p}`)]) {
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    });
    expect(slots[0].scheduledAt.toISOString()).toBe("2026-11-20T03:30:00.000Z"); // 09:00 IST
    expect(slots.some((s) => s.scheduledAt.toISOString().startsWith("2026-11-21"))).toBe(true);
  });

  it("knockout rounds start after the matches feeding them", () => {
    const plan = knockout(ids(4).map((entrantId) => ({ entrantId })), { thirdPlace: false });
    const slots = schedule(plan, players, { ...opts, courts: ["C1", "C2", "C3"] });
    expect(slots[2].scheduledAt.getTime()).toBeGreaterThanOrEqual(slots[0].scheduledAt.getTime() + 30 * 60_000);
  });

  it("respects players already busy in another category", () => {
    const plan = knockout([{ entrantId: "e1" }, { entrantId: "e2" }], { thirdPlace: false });
    const nine = Date.parse("2026-11-20T03:30:00Z");
    const [slot] = schedule(plan, players, opts, [{ start: nine, end: nine + 30 * 60_000, court: "C9", players: ["e1"] }]);
    expect(slot.scheduledAt.toISOString()).toBe("2026-11-20T04:00:00.000Z");
  });
});

describe("standings (FR-TRN-05, FR-TRN-11)", () => {
  it("points first, then the organiser's tie-breakers in order", () => {
    const rows = standings(
      ["a", "b", "c"],
      [
        { home: "a", away: "b", homeScore: 2, awayScore: 0, winner: "a" },
        { home: "b", away: "c", homeScore: 5, awayScore: 0, winner: "b" },
        { home: "c", away: "a", homeScore: 1, awayScore: 0, winner: "c" },
      ],
      config,
    );
    // All on 3 points; b has the best score difference (+3), then a (+1), then c (-4).
    expect(rows.map((r) => [r.entrantId, r.points, r.scoreDiff])).toEqual([["b", 3, 3], ["a", 3, 1], ["c", 3, -4]]);
  });

  it("draws give the draw points; head-to-head breaks a two-way tie", () => {
    const rows = standings(
      ["a", "b"],
      [
        { home: "a", away: "b", homeScore: 1, awayScore: 1, winner: null },
        { home: "b", away: "a", homeScore: 0, awayScore: 1, winner: "a" },
      ],
      { points: config.points, tieBreakers: ["head_to_head"] },
    );
    expect(rows.map((r) => [r.entrantId, r.points, r.drawn])).toEqual([["a", 4, 1], ["b", 1, 1]]);
  });
});
