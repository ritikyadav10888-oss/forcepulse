// Timed sports scored by points within periods (basketball, hockey, kho-kho, wrestling): System Design 6.2 "timed points".
// The clock runs on the scorer's device; periods end when the scorer says so (FR-SCR-11).
import { createSportModule } from "./create-module";
import { activeEvents, asNumber, csv, emptyState, ruleNumber, splitSquad } from "./events";
import type { MatchState, RuleKnob, ScoringAction, Sport } from "./types";

export const TIMED_KNOBS: RuleKnob[] = [
  { key: "periods", label: "Number of periods", type: "number", min: 1, max: 8, required: true },
  { key: "periodMinutes", label: "Minutes per period", type: "number", min: 1, max: 90, required: true },
];

export const WRESTLING_KNOBS: RuleKnob[] = [
  ...TIMED_KNOBS,
  { key: "technicalSuperiority", label: "Points lead that ends the bout (0 = off)", type: "number", min: 0, max: 30, required: true },
];

type Side = "home" | "away";

export interface TimedData {
  period: number;
  byPeriod: { home: number; away: number }[];
  winner: Side | "draw" | null;
  method: string | null;
}

function computeTimed(events: Parameters<typeof activeEvents>[0], rules: Record<string, number | string>): MatchState {
  const state = emptyState();
  const periods = ruleNumber(rules, "periods", ruleNumber(rules, "quarters", ruleNumber(rules, "halves", 2)));
  const superiority = ruleNumber(rules, "technicalSuperiority", 0);
  state.playerSets.homeSquad = splitSquad(rules, "homeSquad");
  state.playerSets.awaySquad = splitSquad(rules, "awaySquad");

  const score = { home: 0, away: 0 };
  const d: TimedData = { period: 1, byPeriod: [{ home: 0, away: 0 }], winner: null, method: null };
  let started = false;
  const finish = (w: Side | "draw", method: string) => {
    d.winner = w;
    d.method = method;
  };

  for (const e of activeEvents(events)) {
    if (d.winner) break;
    const side: Side = e.payload.side === "away" ? "away" : "home";
    switch (e.action) {
      case "lineup":
        started = true;
        state.flags.lineupsSet = true;
        state.playerSets.home = csv(e.payload.homePlayerIds);
        state.playerSets.away = csv(e.payload.awayPlayerIds);
        break;
      case "point":
      case "score": {
        started = true;
        const pts = e.action === "point" ? 1 : Math.max(0, Math.min(10, asNumber(e.payload.points, 1)));
        score[side] += pts;
        d.byPeriod[d.period - 1][side] += pts;
        if (superiority > 0 && score[side] - score[side === "home" ? "away" : "home"] >= superiority) finish(side, "technical_superiority");
        break;
      }
      case "end_period":
        if (d.period >= periods) finish(score.home === score.away ? "draw" : score.home > score.away ? "home" : "away", "time");
        else {
          d.period++;
          d.byPeriod.push({ home: 0, away: 0 });
        }
        break;
      case "decision":
        // Fall, disqualification, injury: the bout ends for the named side (FR-SCR-21).
        finish(side, String(e.payload.method ?? "decision"));
        break;
      case "end_match":
        finish(score.home === score.away ? "draw" : score.home > score.away ? "home" : "away", "ended");
        break;
    }
  }

  state.scores = score;
  state.data = d as unknown as Record<string, unknown>;
  state.periodLabel = d.winner ? "Full time" : `Period ${d.period} of ${periods}`;
  state.phase = d.winner ? "complete" : started ? "live" : "setup";
  return state;
}

const scoreActions = (values: number[], label: (v: number) => string): ScoringAction[] =>
  (["home", "away"] as const).flatMap((side) =>
    values.map((v) => ({
      id: `${side}-${v}`,
      action: "score",
      label: `${side === "home" ? "Home" : "Away"} ${label(v)}`,
      group: "score",
      payload: { side, points: v },
      fields: [{ key: "playerId", label: "Player", type: "player" as const, from: side, required: false }],
      shape: "tile" as const,
      visible: (s: MatchState) => s.phase === "live",
    })),
  );

const periodActions: ScoringAction[] = [
  { id: "end-period", action: "end_period", label: "End period", group: "period", confirm: "End this period?", shape: "wide", visible: (s) => s.phase === "live" },
];

export function timedModule(sport: Sport, values: number[], label: (v: number) => string, extra: ScoringAction[] = []) {
  return createSportModule({
    sport,
    statLabels: { matches: "Matches", wins: "Wins", losses: "Losses", points: "Points" },
    actions: [...scoreActions(values, label), ...extra, ...periodActions],
    computeState: computeTimed,
    getWinner: (s) => {
      const w = (s.data as unknown as TimedData).winner;
      return w === "draw" ? "draw" : w;
    },
    summarise: (s) => {
      const d = s.data as unknown as TimedData;
      return {
        home: s.scores.home,
        away: s.scores.away,
        headline: `${s.scores.home} – ${s.scores.away}`,
        subline: d.method && d.method !== "time" ? `${s.periodLabel} · ${d.method.replace(/_/g, " ")}` : s.periodLabel,
        lines: d.byPeriod.map((p, i) => ({ id: `p${i + 1}`, label: `Period ${i + 1}`, value: `${p.home}–${p.away}` })),
      };
    },
    playerStats: (events) => {
      const stats: Record<string, Record<string, number>> = {};
      for (const e of activeEvents(events)) {
        const id = e.payload.playerId;
        if ((e.action === "score" || e.action === "point") && typeof id === "string" && id) {
          stats[id] ??= {};
          stats[id].points = (stats[id].points ?? 0) + (e.action === "point" ? 1 : asNumber(e.payload.points, 1));
        }
      }
      return stats;
    },
  });
}

export const wrestlingDecisions: ScoringAction[] = (["home", "away"] as const).map((side) => ({
  id: `${side}-decision`,
  action: "decision",
  label: `${side === "home" ? "Home" : "Away"} wins by…`,
  group: "result",
  payload: { side },
  fields: [{ key: "method", label: "How", type: "select" as const, options: ["fall", "disqualification", "injury"].map((v) => ({ value: v, label: v })), required: true }],
  confirm: "End the bout?",
  shape: "wide",
  tone: "danger",
  visible: (s) => s.phase === "live",
}));
