import { describe, expect, it } from "vitest";
import { checkRules, getScoringModule, type ScoreEvent } from "./index";

let seq = 0;
const ev = (action: string, payload: ScoreEvent["payload"] = {}): ScoreEvent => ({ id: `e${++seq}`, matchId: "m", seq, action, payload, createdAt: "" });
const points = (side: "home" | "away", n: number) => Array.from({ length: n }, () => ev("point", { side }));
const run = (sport: string, events: ScoreEvent[], rules: Record<string, number | string>) => {
  const m = getScoringModule(sport)!;
  const state = m.computeState(events, rules);
  return { state, winner: m.getWinner(state), summary: m.summarise(state) };
};

describe("sets engine: badminton, volleyball, table tennis (FR-SCR-01, FR-SCR-10)", () => {
  const ac07 = { pointsToWin: 15, winBy: 2, cap: 0, bestOf: "3" };

  it("AC-07: badminton to 15, win by 2, best of 3 — game ends at 15, match after 2 games", () => {
    let r = run("badminton", [...points("home", 14), ...points("away", 14), ev("point", { side: "home" })], ac07);
    expect(r.state.scores).toEqual({ home: 0, away: 0 }); // 15–14: not two clear
    r = run("badminton", [...points("home", 14), ...points("away", 14), ...points("home", 2)], ac07);
    expect(r.state.scores).toEqual({ home: 1, away: 0 }); // 16–14
    r = run("badminton", [...points("home", 15), ...points("home", 15)], ac07);
    expect(r).toMatchObject({ winner: "home", state: { phase: "complete", scores: { home: 2, away: 0 } } });
    expect(r.summary.headline).toBe("15–0  15–0");
  });

  it("the cap ends a game outright (badminton 30)", () => {
    const deuce = [...points("home", 20), ...points("away", 20)];
    const alternate = Array.from({ length: 9 }, () => [ev("point", { side: "home" }), ev("point", { side: "away" })]).flat();
    const r = run("badminton", [...deuce, ...alternate, ev("point", { side: "away" })], { pointsToWin: 21, winBy: 2, cap: 30, bestOf: "3" });
    expect(r.state.scores).toEqual({ home: 0, away: 1 }); // 29–30
  });

  it("the deciding set can use its own target (volleyball 5th set to 15)", () => {
    const set = (side: "home" | "away") => points(side, 25);
    const r = run("volleyball", [...set("home"), ...set("away"), ...set("home"), ...set("away"), ...points("away", 15)], { pointsToWin: 25, winBy: 2, cap: 0, bestOf: "5", decidingGamePoints: 15 });
    expect(r).toMatchObject({ winner: "away", state: { scores: { home: 2, away: 3 } } });
  });

  it("points after the match is decided don't count; undo removes the last point", () => {
    const r = run("table-tennis", [...points("home", 11), ...points("home", 11), ...points("home", 11), ...points("away", 5)], { pointsToWin: 11, winBy: 2, cap: 0, bestOf: "5" });
    expect(r.state.scores).toEqual({ home: 3, away: 0 });
    const u = run("table-tennis", [...points("home", 3), ev("undo")], { pointsToWin: 11, winBy: 2, cap: 0, bestOf: "5" });
    expect(u.state.meta).toMatchObject({ pointsHome: 2 });
  });
});

describe("tennis engine (FR-SCR-16)", () => {
  const rules = { setsBestOf: "3", gamesPerSet: 6, tieBreakAt: 6, tieBreakPoints: 7, deuce: "advantage" };
  const game = (side: "home" | "away") => points(side, 4);

  it("deuce needs two clear points; golden point does not", () => {
    const deuce = [...points("home", 3), ...points("away", 3), ev("point", { side: "home" })];
    expect(run("tennis", deuce, rules).summary.subline).toBe("Set 1 · Adv home");
    expect(run("tennis", [...deuce, ev("point", { side: "home" })], rules).state.data).toMatchObject({ games: { home: 1, away: 0 } });
    expect(run("tennis", deuce, { ...rules, deuce: "golden_point" }).state.data).toMatchObject({ games: { home: 1, away: 0 } });
  });

  it("6–6 goes to a tie-break that needs 7 and two clear; best of 3 sets", () => {
    const sixAll = Array.from({ length: 6 }, () => [...game("home"), ...game("away")]).flat();
    let r = run("tennis", sixAll, rules);
    expect(r.state.periodLabel).toBe("Tie-break");
    r = run("tennis", [...sixAll, ...points("home", 7)], rules);
    expect(r.summary.lines[0].value).toBe("7–6");
    const setTwo = Array.from({ length: 6 }, () => game("home")).flat();
    r = run("tennis", [...sixAll, ...points("home", 7), ...setTwo], rules);
    expect(r).toMatchObject({ winner: "home", state: { phase: "complete", scores: { home: 2, away: 0 } } });
  });

  it("no tie-break: a set goes on until two games clear", () => {
    const sixAll = Array.from({ length: 6 }, () => [...game("home"), ...game("away")]).flat();
    const r = run("tennis", [...sixAll, ...game("home")], { ...rules, tieBreakAt: 0 });
    expect(r.state.data).toMatchObject({ games: { home: 7, away: 6 }, sets: [] });
  });
});

describe("timed engine: basketball, hockey, kho-kho, wrestling (FR-SCR-11, FR-SCR-21)", () => {
  it("basketball adds 1, 2 and 3 and ends after the last period", () => {
    const r = run("basketball", [ev("score", { side: "home", points: 3, playerId: "p1" }), ev("score", { side: "away", points: 2 }), ...Array.from({ length: 4 }, () => ev("end_period"))], { periods: 4, periodMinutes: 10 });
    expect(r).toMatchObject({ winner: "home", state: { phase: "complete", scores: { home: 3, away: 2 } } });
    expect(getScoringModule("basketball")!.playerStats([ev("score", { side: "home", points: 3, playerId: "p1" })])).toEqual({ p1: { points: 3 } });
  });

  it("hockey can end level", () => {
    const r = run("hockey", [ev("score", { side: "home", points: 1 }), ev("score", { side: "away", points: 1 }), ev("end_match")], { periods: 4, periodMinutes: 15 });
    expect(r.winner).toBe("draw");
  });

  it("wrestling ends on technical superiority or a fall", () => {
    const tech = run("wrestling", [ev("score", { side: "away", points: 5 }), ev("score", { side: "away", points: 5 })], { periods: 2, periodMinutes: 3, technicalSuperiority: 10 });
    expect(tech).toMatchObject({ winner: "away", summary: { subline: "Full time · technical superiority" } });
    const fall = run("wrestling", [ev("score", { side: "away", points: 4 }), ev("decision", { side: "home", method: "fall" })], { periods: 2, periodMinutes: 3, technicalSuperiority: 0 });
    expect(fall.winner).toBe("home");
  });
});

describe("rule sets (FR-SCR-01)", () => {
  it("accepts a complete rule set and lists every problem in a bad one", () => {
    expect(checkRules("badminton", { pointsToWin: 15, winBy: 2, cap: 0, bestOf: "3" })).toEqual([]);
    expect(checkRules("badminton", { pointsToWin: 0, bestOf: "4", serve: "x" })).toEqual([
      "serve isn't a setting for Badminton",
      "Points to win a game must be a whole number from 1 to 99",
      "Win by (margin) is required",
      "Cap: first to this wins outright (0 = no cap) is required",
      "Best of (games) must be one of 1, 3, 5, 7",
    ]);
    expect(checkRules("golf", {})).toEqual(["No scoring rules for golf yet"]);
  });
});
