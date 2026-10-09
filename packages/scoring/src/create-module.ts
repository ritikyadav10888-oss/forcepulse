import { activeEvents, asNumber, csv, emptyState, splitSquad } from "./events";
import type {
  MatchState,
  ScoringAction,
  SetupStep,
  SportLayout,
  SportModule,
} from "./types";
import type { ScoreEvent, Sport } from "./types";

export function createSportModule(input: {
  sport: Sport;
  statLabels: Record<string, string>;
  actions?: ScoringAction[];
  setupSteps?: SetupStep[];
  layout?: SportLayout;
  computeState?: SportModule["computeState"];
  isMatchOver?: SportModule["isMatchOver"];
  getWinner?: SportModule["getWinner"];
  summarise?: SportModule["summarise"];
  playerStats?: SportModule["playerStats"];
  formatEvent?: SportModule["formatEvent"];
}): SportModule {
  const sportId = input.sport.id;
  return {
    sportId,
    sport: input.sport,
    statLabels: input.statLabels,
    layout: input.layout ?? { scoreboard: "split", actions: "tiles" },
    actions: input.actions ?? defaultPointActions(),
    setupSteps: input.setupSteps ?? defaultSetup(),
    computeState: input.computeState ?? defaultCompute,
    isMatchOver: input.isMatchOver ?? ((state) => state.phase === "complete"),
    getWinner: input.getWinner ?? defaultWinner,
    summarise: input.summarise ?? defaultSummarise,
    playerStats: input.playerStats ?? defaultPlayerStats,
    formatEvent: input.formatEvent ?? defaultFormat,
  };
}

function defaultSetup(): SetupStep[] {
  return [
    {
      id: "lineup",
      title: "Confirm lineups",
      description: "Select who is playing for each side.",
      action: "lineup",
      fields: [
        { key: "homePlayerIds", label: "Home lineup", type: "players", from: "homeSquad", required: true },
        { key: "awayPlayerIds", label: "Away lineup", type: "players", from: "awaySquad", required: true },
      ],
      done: (state) => Boolean(state.flags.lineupsSet),
    },
  ];
}

function defaultPointActions(): ScoringAction[] {
  return [
    {
      id: "home-point",
      action: "point",
      label: "Home +1",
      group: "score",
      payload: { side: "home" },
      shape: "tile",
      tone: "success",
      visible: (state) => state.phase === "live",
    },
    {
      id: "away-point",
      action: "point",
      label: "Away +1",
      group: "score",
      payload: { side: "away" },
      shape: "tile",
      visible: (state) => state.phase === "live",
    },
    {
      id: "end-match",
      action: "end_match",
      label: "End match",
      group: "period",
      confirm: "End this match?",
      shape: "wide",
      tone: "danger",
      visible: (state) => state.phase === "live",
    },
  ];
}

function defaultCompute(
  events: ScoreEvent[],
  rules: Record<string, number | string>,
): MatchState {
  const state = emptyState();
  const homeId = String(rules.homeTeamId ?? "home");
  const awayId = String(rules.awayTeamId ?? "away");
  state.playerSets.homeSquad = splitSquad(rules, "homeSquad");
  state.playerSets.awaySquad = splitSquad(rules, "awaySquad");
  state.playerSets.home = [];
  state.playerSets.away = [];

  let home = 0;
  let away = 0;
  let lineups = false;
  let complete = false;

  for (const event of activeEvents(events)) {
    if (event.action === "lineup") {
      lineups = true;
      state.playerSets.home = csv(event.payload.homePlayerIds);
      state.playerSets.away = csv(event.payload.awayPlayerIds);
    }
    if (event.action === "point") {
      if (event.payload.side === "away" || event.payload.teamId === awayId) away += 1;
      else home += 1;
    }
    if (event.action === "goal") {
      if (event.payload.teamId === awayId) away += 1;
      else if (event.payload.teamId === homeId) home += 1;
    }
    if (event.action === "game") {
      const h = asNumber(event.payload.home);
      const a = asNumber(event.payload.away);
      if (h > a) home += 1;
      else if (a > h) away += 1;
    }
    if (event.action === "end_match") complete = true;
  }

  state.scores = { home, away };
  state.flags.lineupsSet = lineups;
  if (complete) state.phase = "complete";
  else if (home + away > 0 || lineups) state.phase = "live";
  else state.phase = "setup";
  return state;
}

function defaultWinner(state: MatchState): string | "draw" | null {
  if (state.phase !== "complete") return null;
  if (state.scores.home === state.scores.away) return "draw";
  return state.scores.home > state.scores.away ? "home" : "away";
}

function defaultSummarise(state: MatchState) {
  return {
    home: state.scores.home,
    away: state.scores.away,
    headline: `${state.scores.home} – ${state.scores.away}`,
    subline: state.periodLabel,
    lines: [],
  };
}

function defaultPlayerStats(events: ScoreEvent[]) {
  const stats: Record<string, Record<string, number>> = {};
  for (const event of activeEvents(events)) {
    const playerId = event.payload.playerId;
    if (typeof playerId !== "string" || !playerId) continue;
    stats[playerId] ??= {};
    if (event.action === "goal" || event.action === "point") {
      stats[playerId].points = (stats[playerId].points ?? 0) + 1;
    }
  }
  return stats;
}

function defaultFormat(event: ScoreEvent) {
  if (event.action === UNDO_LABEL) return "Undo";
  return event.action.replaceAll("_", " ");
}

const UNDO_LABEL = "undo";
