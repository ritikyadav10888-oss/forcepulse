import { activeEvents, csv, emptyState, ruleNumber, splitSquad } from "./events";
import type { MatchState, ScoringAction, SetupStep, SportModule } from "./types";
import type { ScoreEvent } from "./types";

function footballActions(): ScoringAction[] {
  const live = (state: MatchState) => state.phase === "live";
  return [
    {
      id: "goal",
      action: "goal",
      label: "Goal",
      group: "score",
      shape: "wide",
      tone: "success",
      fields: [
        { key: "teamId", label: "Team", type: "team", required: true },
        { key: "playerId", label: "Scorer", type: "player", from: "scorers", required: true },
      ],
      visible: live,
    },
    {
      id: "own-goal",
      action: "own_goal",
      label: "Own goal",
      group: "score",
      shape: "tile",
      tone: "danger",
      fields: [
        { key: "teamId", label: "Team that conceded", type: "team", required: true },
        { key: "playerId", label: "Player", type: "player", from: "scorers", required: true },
      ],
      visible: live,
    },
    {
      id: "yellow",
      action: "card",
      label: "Yellow card",
      group: "discipline",
      payload: { color: "yellow" },
      shape: "tile",
      tone: "outline",
      fields: [
        { key: "teamId", label: "Team", type: "team", required: true },
        { key: "playerId", label: "Player", type: "player", from: "scorers", required: true },
      ],
      visible: live,
    },
    {
      id: "red",
      action: "card",
      label: "Red card",
      group: "discipline",
      payload: { color: "red" },
      shape: "tile",
      tone: "danger",
      fields: [
        { key: "teamId", label: "Team", type: "team", required: true },
        { key: "playerId", label: "Player", type: "player", from: "scorers", required: true },
      ],
      visible: live,
    },
    {
      id: "sub",
      action: "substitution",
      label: "Substitution",
      group: "discipline",
      shape: "tile",
      fields: [
        { key: "teamId", label: "Team", type: "team", required: true },
        { key: "outId", label: "Off", type: "player", from: "scorers", required: true },
        { key: "inId", label: "On", type: "player", from: "bench", required: true },
      ],
      visible: live,
    },
    {
      id: "end-period",
      action: "end_period",
      label: "End half",
      group: "period",
      confirm: "End this period?",
      shape: "wide",
      visible: live,
    },
    {
      id: "end-match",
      action: "end_match",
      label: "End match",
      group: "period",
      confirm: "End the match?",
      shape: "wide",
      tone: "danger",
      visible: (state) => state.phase === "live" || state.phase === "period_break",
    },
  ];
}

function setupSteps(): SetupStep[] {
  return [
    {
      id: "lineup",
      title: "Confirm lineups",
      action: "lineup",
      fields: [
        { key: "homePlayerIds", label: "Home XI", type: "players", from: "homeSquad", required: true },
        { key: "awayPlayerIds", label: "Away XI", type: "players", from: "awaySquad", required: true },
      ],
      done: (state) => Boolean(state.flags.lineupsSet),
    },
    {
      id: "kickoff",
      title: "Kickoff",
      description: "Which side kicks off?",
      action: "kickoff",
      fields: [{ key: "teamId", label: "Kicks off", type: "team", required: true }],
      done: (state) => Boolean(state.flags.kickoffSet),
    },
  ];
}

export function computeFootballState(
  events: ScoreEvent[],
  rules: Record<string, number | string>,
): MatchState {
  const state = emptyState();
  const homeId = String(rules.homeTeamId ?? "");
  const awayId = String(rules.awayTeamId ?? "");
  const halves = ruleNumber(rules, "halves", 2);
  state.playerSets.homeSquad = splitSquad(rules, "homeSquad");
  state.playerSets.awaySquad = splitSquad(rules, "awaySquad");
  state.playerSets.home = [...state.playerSets.homeSquad];
  state.playerSets.away = [...state.playerSets.awaySquad];
  state.playerSets.scorers = [...state.playerSets.home, ...state.playerSets.away];
  state.playerSets.bench = [];

  let home = 0;
  let away = 0;
  let period = 1;
  let complete = false;
  let kickoff = false;
  let goals = 0;

  for (const event of activeEvents(events)) {
    if (event.action === "lineup") {
      state.playerSets.home = csv(event.payload.homePlayerIds);
      state.playerSets.away = csv(event.payload.awayPlayerIds);
      state.flags.lineupsSet = true;
    }
    if (event.action === "kickoff") {
      kickoff = true;
      state.flags.kickoffSet = true;
      state.flags.kickoffTeamId = String(event.payload.teamId ?? "");
    }
    if (event.action === "goal") {
      goals += 1;
      if (event.payload.teamId === awayId) away += 1;
      else home += 1;
    }
    if (event.action === "own_goal") {
      goals += 1;
      if (event.payload.teamId === homeId) away += 1;
      else home += 1;
    }
    if (event.action === "end_period") {
      if (period >= halves) complete = true;
      else period += 1;
    }
    if (event.action === "end_match") complete = true;
  }

  state.playerSets.scorers = [...state.playerSets.home, ...state.playerSets.away];
  const selected = new Set(state.playerSets.scorers);
  state.playerSets.bench = [...state.playerSets.homeSquad, ...state.playerSets.awaySquad].filter(
    (id) => !selected.has(id),
  );

  state.scores = { home, away };
  state.periodLabel = complete ? "FT" : `H${period}`;
  state.flags.period = period;
  state.flags.matchOver = complete;
  if (complete) state.phase = "complete";
  else if (kickoff || goals > 0 || Boolean(state.flags.lineupsSet)) state.phase = "live";
  else state.phase = "setup";

  state.data = {
    homeId,
    awayId,
    homeName: String(rules.homeName ?? "Home"),
    awayName: String(rules.awayName ?? "Away"),
  };
  return state;
}

export const footballModule: SportModule = {
  sportId: "football",
  sport: {
    id: "football",
    name: "Football",
    icon: "football",
    accent: "var(--sport-football)",
    teamSize: 11,
    maxSubstitutes: 5,
    roles: ["Goalkeeper", "Defender", "Midfielder", "Forward"],
    defaultRules: {
      halfMinutes: 45,
      halves: 2,
      playersPerSide: 11,
    },
    scoringModule: "football",
  },
  layout: { scoreboard: "split", actions: "tiles" },
  actions: footballActions(),
  setupSteps: setupSteps(),
  computeState: computeFootballState,
  isMatchOver: (state) => state.phase === "complete",
  getWinner: (state) => {
    if (state.phase !== "complete") return null;
    if (state.scores.home === state.scores.away) return "draw";
    const data = state.data as { homeId: string; awayId: string };
    return state.scores.home > state.scores.away ? data.homeId : data.awayId;
  },
  summarise: (state) => ({
    home: state.scores.home,
    away: state.scores.away,
    headline: `${state.scores.home} – ${state.scores.away}`,
    subline: state.periodLabel,
    chips: [{ id: "p", label: String(state.periodLabel ?? ""), tone: "live" }],
    lines: [],
  }),
  playerStats: (events) => {
    const stats: Record<string, Record<string, number>> = {};
    for (const event of activeEvents(events)) {
      const playerId = event.payload.playerId;
      if (typeof playerId !== "string") continue;
      stats[playerId] ??= { goals: 0, cards: 0 };
      if (event.action === "goal") stats[playerId].goals += 1;
      if (event.action === "card") stats[playerId].cards += 1;
    }
    return stats;
  },
  statLabels: {
    matches: "Matches",
    goals: "Goals",
    assists: "Assists",
    cleanSheets: "Clean sheets",
    cards: "Cards",
  },
  formatEvent: (event) => {
    if (event.action === "goal") return "Goal";
    if (event.action === "own_goal") return "Own goal";
    if (event.action === "card") return `${event.payload.color === "red" ? "Red" : "Yellow"} card`;
    if (event.action === "substitution") return "Substitution";
    if (event.action === "undo") return "Undo";
    return event.action.replaceAll("_", " ");
  },
};
