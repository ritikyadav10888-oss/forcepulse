// Rally sports played in games or sets (badminton, volleyball, table tennis): System Design 6.2 "rally / point sets".
// Every point scores; a game ends at the organiser's target with the winning margin, or at the cap (FR-SCR-01, FR-SCR-10).
import { createSportModule } from "./create-module";
import { activeEvents, csv, emptyState, ruleNumber, splitSquad } from "./events";
import type { MatchState, RuleKnob, Sport } from "./types";

export const SET_KNOBS: RuleKnob[] = [
  { key: "pointsToWin", label: "Points to win a game", type: "number", min: 1, max: 99, required: true },
  { key: "winBy", label: "Win by (margin)", type: "number", min: 1, max: 5, required: true },
  { key: "cap", label: "Cap: first to this wins outright (0 = no cap)", type: "number", min: 0, max: 99, required: true },
  { key: "bestOf", label: "Best of (games)", type: "select", options: ["1", "3", "5", "7"], required: true },
  { key: "decidingGamePoints", label: "Points to win the deciding game (0 = same)", type: "number", min: 0, max: 99, required: false },
];

type Score = { home: number; away: number };
type Side = "home" | "away";

export interface SetsData {
  games: Score[];
  current: Score;
  won: Score;
  winner: Side | null;
}

/** Game over? Target reached with the margin, or the cap reached. */
export function gameWinner(p: Score, target: number, winBy: number, cap: number): Side | null {
  for (const [me, them] of [["home", "away"], ["away", "home"]] as const) {
    if (cap > 0 && p[me] >= cap) return me;
    if (p[me] >= target && p[me] - p[them] >= winBy) return me;
  }
  return null;
}

function computeSets(events: Parameters<typeof activeEvents>[0], rules: Record<string, number | string>): MatchState {
  const state = emptyState();
  const target = ruleNumber(rules, "pointsToWin", ruleNumber(rules, "pointsPerGame", ruleNumber(rules, "pointsPerSet", 21)));
  const winBy = ruleNumber(rules, "winBy", 2);
  const cap = ruleNumber(rules, "cap", 0);
  const bestOf = ruleNumber(rules, "bestOf", ruleNumber(rules, "gamesBestOf", ruleNumber(rules, "setsBestOf", 3)));
  const deciding = ruleNumber(rules, "decidingGamePoints", 0);
  const needed = Math.floor(bestOf / 2) + 1;

  state.playerSets.homeSquad = splitSquad(rules, "homeSquad");
  state.playerSets.awaySquad = splitSquad(rules, "awaySquad");
  const data: SetsData = { games: [], current: { home: 0, away: 0 }, won: { home: 0, away: 0 }, winner: null };
  let started = false;

  for (const e of activeEvents(events)) {
    if (data.winner) break; // nothing after the match is decided counts
    if (e.action === "lineup") {
      started = true;
      state.flags.lineupsSet = true;
      state.playerSets.home = csv(e.payload.homePlayerIds);
      state.playerSets.away = csv(e.payload.awayPlayerIds);
    } else if (e.action === "point") {
      started = true;
      const side: Side = e.payload.side === "away" ? "away" : "home";
      data.current[side]++;
      const isDeciding = data.won.home === needed - 1 && data.won.away === needed - 1;
      const g = gameWinner(data.current, isDeciding && deciding > 0 ? deciding : target, winBy, cap);
      if (g) {
        data.games.push(data.current);
        data.won[g]++;
        data.current = { home: 0, away: 0 };
        if (data.won[g] === needed) data.winner = g;
      }
    } else if (e.action === "end_match") {
      // Retirement or walk-off: the scorer names the winner.
      data.winner = e.payload.winner === "away" ? "away" : e.payload.winner === "home" ? "home" : null;
      if (!data.winner) data.winner = data.won.home >= data.won.away ? "home" : "away";
      if (data.current.home || data.current.away) data.games.push(data.current);
    }
  }

  state.scores = { ...data.won };
  state.data = data as unknown as Record<string, unknown>;
  state.periodLabel = `Game ${data.games.length + (data.winner ? 0 : 1)}`;
  state.meta = { pointsHome: data.current.home, pointsAway: data.current.away };
  state.phase = data.winner ? "complete" : started ? "live" : "setup";
  return state;
}

export function setsModule(sport: Sport) {
  return createSportModule({
    sport,
    statLabels: { matches: "Matches", wins: "Wins", losses: "Losses", points: "Points" },
    computeState: computeSets,
    getWinner: (s) => ((s.data as unknown as SetsData).winner ?? null),
    summarise: (s) => {
      const d = s.data as unknown as SetsData;
      const games = d.games.map((g) => `${g.home}–${g.away}`);
      const live = s.phase === "complete" ? [] : [`${d.current.home}–${d.current.away}`];
      return {
        home: s.scores.home,
        away: s.scores.away,
        headline: [...games, ...live].join("  ") || "0–0",
        subline: s.phase === "complete" ? "Match over" : s.periodLabel,
        lines: d.games.map((g, i) => ({ id: `g${i + 1}`, label: `Game ${i + 1}`, value: `${g.home}–${g.away}` })),
      };
    },
  });
}

export const setSport = (id: string, name: string, teamSize: number, roles: string[], defaultRules: Record<string, number>): Sport => ({
  id,
  name,
  icon: id,
  accent: `var(--sport-${id})`,
  teamSize,
  maxSubstitutes: 0,
  roles,
  defaultRules,
  scoringModule: id,
});
