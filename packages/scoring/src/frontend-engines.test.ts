import { cricketModule } from "./cricket";
import { footballModule } from "./football";
import { kabaddiModule } from "./kabaddi";
import { UNDO_ACTION } from "./events";
import type { ScoreEvent } from "./types";
import { describe, expect, it } from "vitest";

function ev(seq: number, action: string, payload: ScoreEvent["payload"] = {}): ScoreEvent {
  return {
    id: `e-${seq}`,
    matchId: "m",
    seq,
    action,
    payload,
    createdAt: "2026-09-21T10:00:00+05:30",
  };
}

const cricketRules = {
  overs: 2,
  ballsPerOver: 6,
  wickets: 10,
  playersPerSide: 3,
  homeTeamId: "H",
  awayTeamId: "A",
  homeSquad: "b1,b2,b3",
  awaySquad: "o1,o2,o3",
};

function cricketSetup(...extra: ScoreEvent[]) {
  return [
    ev(1, "lineup", { homePlayerIds: "b1,b2,b3", awayPlayerIds: "o1,o2,o3" }),
    ev(2, "toss", { winnerTeamId: "H", elected: "bat" }),
    ev(3, "openers", { strikerId: "b1", nonStrikerId: "b2", bowlerId: "o1" }),
    ...extra,
  ];
}

function liveInnings(state: ReturnType<typeof cricketModule.computeState>) {
  return state.data.live as {
    runs: number;
    wickets: number;
    legalBalls: number;
    strikerId: string | null;
    bowlerId: string | null;
  } | null;
}

describe("cricket computeState", () => {
  it("adds legal runs and rotates strike on odd totals", () => {
    const state = cricketModule.computeState(
      cricketSetup(ev(4, "run", { runs: 1 }), ev(5, "run", { runs: 4 })),
      cricketRules,
    );
    const live = liveInnings(state);
    expect(live?.runs).toBe(5);
    expect(live?.legalBalls).toBe(2);
    expect(live?.strikerId).toBe("b2");
    expect(cricketModule.summarise(state).headline).toContain("5/0");
  });

  it("does not count a wide as a legal ball", () => {
    const state = cricketModule.computeState(
      cricketSetup(ev(4, "extra", { kind: "wide", runs: 0 })),
      cricketRules,
    );
    const live = liveInnings(state);
    expect(live?.runs).toBe(1);
    expect(live?.legalBalls).toBe(0);
  });

  it("asks for a new bowler after six legal balls", () => {
    const balls = [4, 5, 6, 7, 8, 9].map((seq) => ev(seq, "run", { runs: 0 }));
    const state = cricketModule.computeState(cricketSetup(...balls), cricketRules);
    expect(state.pending?.action).toBe("set_bowler");
    expect(liveInnings(state)?.bowlerId).toBeNull();
    expect(liveInnings(state)?.legalBalls).toBe(6);
  });

  it("records a wicket and brings in a new batter", () => {
    const state = cricketModule.computeState(
      cricketSetup(
        ev(4, "wicket", { kind: "bowled", playerId: "b1", newBatsmanId: "b3" }),
      ),
      cricketRules,
    );
    const live = liveInnings(state);
    expect(live?.wickets).toBe(1);
    expect(live?.strikerId).toBe("b3");
    expect(live?.legalBalls).toBe(1);
  });

  it("undo pops the last scoring event without deleting history", () => {
    const events = cricketSetup(
      ev(4, "run", { runs: 6 }),
      ev(5, UNDO_ACTION, {}),
    );
    const state = cricketModule.computeState(events, cricketRules);
    expect(liveInnings(state)?.runs).toBe(0);
    expect(events).toHaveLength(5);
  });

  it("chases a target and names the winner", () => {
    const events = cricketSetup(
      ev(4, "run", { runs: 4 }),
      ev(5, "end_innings", {}),
      ev(6, "openers", { strikerId: "o1", nonStrikerId: "o2", bowlerId: "b1" }),
      ev(7, "run", { runs: 6 }),
    );
    const state = cricketModule.computeState(events, cricketRules);
    expect(cricketModule.isMatchOver(state, cricketRules)).toBe(true);
    expect(cricketModule.getWinner(state)).toBe("A");
  });
});

describe("football computeState", () => {
  const rules = {
    halves: 2,
    homeTeamId: "H",
    awayTeamId: "A",
    homeSquad: "p1,p2",
    awaySquad: "p3,p4",
  };

  it("counts goals and own goals for the conceding side", () => {
    const state = footballModule.computeState(
      [
        ev(1, "kickoff", { teamId: "H" }),
        ev(2, "goal", { teamId: "H", playerId: "p1" }),
        ev(3, "own_goal", { teamId: "H", playerId: "p2" }),
      ],
      rules,
    );
    expect(state.scores).toEqual({ home: 1, away: 1 });
  });

  it("undo reverses the latest goal", () => {
    const state = footballModule.computeState(
      [
        ev(1, "kickoff", { teamId: "H" }),
        ev(2, "goal", { teamId: "H", playerId: "p1" }),
        ev(3, UNDO_ACTION, {}),
      ],
      rules,
    );
    expect(state.scores.home).toBe(0);
  });

  it("ends the match after end_match", () => {
    const state = footballModule.computeState(
      [ev(1, "kickoff", { teamId: "H" }), ev(2, "end_match", {})],
      rules,
    );
    expect(footballModule.isMatchOver(state, rules)).toBe(true);
    expect(footballModule.getWinner(state)).toBe("draw");
  });
});

describe("kabaddi computeState", () => {
  const rules = {
    halves: 2,
    homeTeamId: "H",
    awayTeamId: "A",
    homeSquad: "r1,r2",
    awaySquad: "d1,d2",
  };

  it("awards raid, bonus, tackle and all-out points", () => {
    const state = kabaddiModule.computeState(
      [
        ev(1, "toss", { winnerTeamId: "H", raidingTeamId: "H" }),
        ev(2, "raid", { playerId: "r1", points: 2 }),
        ev(3, "bonus", { playerId: "r1" }),
        ev(4, "tackle", { playerId: "d1", points: 1 }),
        ev(5, "all_out", {}),
      ],
      rules,
    );
    expect(state.scores.home).toBeGreaterThan(0);
    expect(state.scores.away).toBeGreaterThan(0);
  });

  it("undoes the last raid", () => {
    const state = kabaddiModule.computeState(
      [
        ev(1, "toss", { winnerTeamId: "H", raidingTeamId: "H" }),
        ev(2, "raid", { playerId: "r1", points: 3 }),
        ev(3, UNDO_ACTION, {}),
      ],
      rules,
    );
    expect(state.scores.home).toBe(0);
  });
});
