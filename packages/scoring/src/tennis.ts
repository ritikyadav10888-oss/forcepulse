// Tennis-style scoring (tennis; padel later): points 0-15-30-40, deuce or golden point, games, sets, tie-break (FR-SCR-16).
import { createSportModule } from "./create-module";
import { activeEvents, csv, emptyState, ruleNumber, splitSquad } from "./events";
import type { MatchState, RuleKnob, Sport } from "./types";

export const TENNIS_KNOBS: RuleKnob[] = [
  { key: "setsBestOf", label: "Best of (sets)", type: "select", options: ["1", "3", "5"], required: true },
  { key: "gamesPerSet", label: "Games to win a set", type: "number", min: 1, max: 12, required: true },
  { key: "tieBreakAt", label: "Tie-break at games-all (0 = none, win by 2 games)", type: "number", min: 0, max: 12, required: true },
  { key: "tieBreakPoints", label: "Tie-break points to win", type: "number", min: 5, max: 15, required: true },
  { key: "deuce", label: "At 40–40", type: "select", options: ["advantage", "golden_point"], required: true },
];

type Side = "home" | "away";
type Score = { home: number; away: number };
const other = (s: Side): Side => (s === "home" ? "away" : "home");

export interface TennisData {
  sets: Score[];
  games: Score;
  points: Score;
  tieBreak: boolean;
  won: Score;
  winner: Side | null;
}

function computeTennis(events: Parameters<typeof activeEvents>[0], rules: Record<string, number | string>): MatchState {
  const state = emptyState();
  const needed = Math.floor(ruleNumber(rules, "setsBestOf", 3) / 2) + 1;
  const perSet = ruleNumber(rules, "gamesPerSet", 6);
  const tbAt = ruleNumber(rules, "tieBreakAt", perSet);
  const tbPoints = ruleNumber(rules, "tieBreakPoints", 7);
  const golden = rules.deuce === "golden_point";

  state.playerSets.homeSquad = splitSquad(rules, "homeSquad");
  state.playerSets.awaySquad = splitSquad(rules, "awaySquad");
  const d: TennisData = { sets: [], games: { home: 0, away: 0 }, points: { home: 0, away: 0 }, tieBreak: false, won: { home: 0, away: 0 }, winner: null };
  let started = false;

  const winSet = (s: Side) => {
    d.sets.push(d.games);
    d.won[s]++;
    d.games = { home: 0, away: 0 };
    d.tieBreak = false;
    if (d.won[s] === needed) d.winner = s;
  };
  const winGame = (s: Side) => {
    d.games[s]++;
    d.points = { home: 0, away: 0 };
    const [g, o] = [d.games[s], d.games[other(s)]];
    if (g >= perSet && g - o >= 2) winSet(s);
    else if (tbAt > 0 && d.games.home === tbAt && d.games.away === tbAt) d.tieBreak = true;
  };

  for (const e of activeEvents(events)) {
    if (d.winner) break;
    if (e.action === "lineup") {
      started = true;
      state.flags.lineupsSet = true;
      state.playerSets.home = csv(e.payload.homePlayerIds);
      state.playerSets.away = csv(e.payload.awayPlayerIds);
    } else if (e.action === "point") {
      started = true;
      const s: Side = e.payload.side === "away" ? "away" : "home";
      d.points[s]++;
      const [p, o] = [d.points[s], d.points[other(s)]];
      if (d.tieBreak) {
        if (p >= tbPoints && p - o >= 2) {
          d.games[s]++;
          d.points = { home: 0, away: 0 };
          winSet(s);
        }
      } else if (golden ? p >= 4 && (o < 3 || p > o) : p >= 4 && p - o >= 2) {
        winGame(s);
      }
    } else if (e.action === "end_match") {
      d.winner = e.payload.winner === "away" ? "away" : "home";
    }
  }

  state.scores = { ...d.won };
  state.data = d as unknown as Record<string, unknown>;
  state.periodLabel = d.tieBreak ? "Tie-break" : `Set ${d.sets.length + 1}`;
  state.phase = d.winner ? "complete" : started ? "live" : "setup";
  return state;
}

const CALL = ["0", "15", "30", "40"];

/** "30–15", "Deuce", "Adv home", or tie-break points. */
export function pointCall(d: TennisData, golden: boolean): string {
  const { home: h, away: a } = d.points;
  if (d.tieBreak) return `${h}–${a}`;
  if (h >= 3 && a >= 3) {
    if (h === a) return golden ? "Deciding point" : "Deuce";
    return `Adv ${h > a ? "home" : "away"}`;
  }
  return `${CALL[h]}–${CALL[a]}`;
}

export function tennisModule(sport: Sport) {
  return createSportModule({
    sport,
    statLabels: { matches: "Matches", wins: "Wins", losses: "Losses", points: "Points" },
    computeState: computeTennis,
    getWinner: (s) => ((s.data as unknown as TennisData).winner ?? null),
    summarise: (s) => {
      const d = s.data as unknown as TennisData;
      const sets = [...d.sets, ...(s.phase === "complete" ? [] : [d.games])].map((g) => `${g.home}–${g.away}`);
      return {
        home: s.scores.home,
        away: s.scores.away,
        headline: sets.join("  "),
        subline: s.phase === "complete" ? "Match over" : `${s.periodLabel} · ${pointCall(d, false)}`,
        lines: d.sets.map((g, i) => ({ id: `s${i + 1}`, label: `Set ${i + 1}`, value: `${g.home}–${g.away}` })),
      };
    },
  });
}
