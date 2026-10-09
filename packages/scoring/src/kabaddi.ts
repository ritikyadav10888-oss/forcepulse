import { activeEvents, asNumber, csv, emptyState, ruleNumber, splitSquad } from "./events";
import type { MatchState, ScoringAction, SetupStep, SportModule } from "./types";
import type { ScoreEvent } from "./types";

function live(state: MatchState) {
  return state.phase === "live";
}

function kabaddiActions(): ScoringAction[] {
  return [
    {
      id: "raid",
      action: "raid",
      label: "Raid point",
      group: "raid",
      payload: { points: 1 },
      shape: "wide",
      tone: "success",
      fields: [
        { key: "playerId", label: "Raider", type: "player", from: "raiding", required: true },
        {
          key: "points",
          label: "Points",
          type: "select",
          options: [
            { value: "1", label: "1" },
            { value: "2", label: "2" },
            { value: "3", label: "Super raid (3+)" },
          ],
          required: true,
        },
      ],
      visible: live,
    },
    {
      id: "empty",
      action: "raid",
      label: "Empty raid",
      group: "raid",
      payload: { points: 0 },
      shape: "tile",
      tone: "muted",
      fields: [{ key: "playerId", label: "Raider", type: "player", from: "raiding", required: true }],
      visible: live,
    },
    {
      id: "bonus",
      action: "bonus",
      label: "Bonus",
      group: "raid",
      payload: { points: 1 },
      shape: "tile",
      tone: "boundary",
      fields: [{ key: "playerId", label: "Raider", type: "player", from: "raiding", required: true }],
      visible: live,
    },
    {
      id: "tackle",
      action: "tackle",
      label: "Tackle point",
      group: "defence",
      payload: { points: 1 },
      shape: "wide",
      fields: [
        { key: "playerId", label: "Defender", type: "player", from: "defending", required: true },
        {
          key: "points",
          label: "Points",
          type: "select",
          options: [
            { value: "1", label: "Tackle" },
            { value: "2", label: "Super tackle" },
          ],
          required: true,
        },
      ],
      visible: live,
    },
    {
      id: "all-out",
      action: "all_out",
      label: "All out",
      group: "defence",
      payload: { points: 2 },
      shape: "wide",
      tone: "danger",
      confirm: "Award all-out (2 points to the attacking side)?",
      visible: live,
    },
    {
      id: "end-period",
      action: "end_period",
      label: "End half",
      group: "period",
      confirm: "End this half?",
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
        { key: "homePlayerIds", label: "Home 7", type: "players", from: "homeSquad", required: true },
        { key: "awayPlayerIds", label: "Away 7", type: "players", from: "awaySquad", required: true },
      ],
      done: (state) => Boolean(state.flags.lineupsSet),
    },
    {
      id: "toss",
      title: "Toss & first raid",
      action: "toss",
      fields: [
        { key: "winnerTeamId", label: "Toss winner", type: "team", required: true },
        { key: "raidingTeamId", label: "First raid", type: "team", required: true },
      ],
      done: (state) => Boolean(state.flags.tossSet),
    },
  ];
}

export function computeKabaddiState(
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

  let home = 0;
  let away = 0;
  let period = 1;
  let complete = false;
  let raiding = homeId;
  const raidPoints: Record<string, number> = {};
  const tacklePoints: Record<string, number> = {};

  const add = (teamId: string, n: number) => {
    if (teamId === awayId) away += n;
    else home += n;
  };

  for (const event of activeEvents(events)) {
    if (event.action === "lineup") {
      state.playerSets.home = csv(event.payload.homePlayerIds);
      state.playerSets.away = csv(event.payload.awayPlayerIds);
      state.flags.lineupsSet = true;
    }
    if (event.action === "toss") {
      state.flags.tossSet = true;
      raiding = String(event.payload.raidingTeamId ?? event.payload.winnerTeamId ?? homeId);
    }
    if (event.action === "raid") {
      const points = asNumber(event.payload.points);
      add(raiding, points);
      const playerId = String(event.payload.playerId ?? "");
      if (playerId) raidPoints[playerId] = (raidPoints[playerId] ?? 0) + points;
      if (points === 0 || points > 0) raiding = raiding === homeId ? awayId : homeId;
    }
    if (event.action === "bonus") {
      add(raiding, 1);
      const playerId = String(event.payload.playerId ?? "");
      if (playerId) raidPoints[playerId] = (raidPoints[playerId] ?? 0) + 1;
    }
    if (event.action === "tackle") {
      const points = asNumber(event.payload.points, 1);
      const defending = raiding === homeId ? awayId : homeId;
      add(defending, points);
      const playerId = String(event.payload.playerId ?? "");
      if (playerId) tacklePoints[playerId] = (tacklePoints[playerId] ?? 0) + points;
      raiding = defending === homeId ? awayId : homeId;
    }
    if (event.action === "all_out") {
      add(raiding, 2);
    }
    if (event.action === "end_period") {
      if (period >= halves) complete = true;
      else {
        period += 1;
        raiding = raiding === homeId ? awayId : homeId;
      }
    }
    if (event.action === "end_match") complete = true;
  }

  state.playerSets.raiding = raiding === homeId ? state.playerSets.home : state.playerSets.away;
  state.playerSets.defending = raiding === homeId ? state.playerSets.away : state.playerSets.home;
  state.scores = { home, away };
  state.periodLabel = complete ? "FT" : `H${period}`;
  state.flags.raidingTeamId = raiding;
  state.flags.matchOver = complete;
  if (complete) state.phase = "complete";
  else if (state.flags.tossSet || home + away > 0) state.phase = "live";
  else state.phase = "setup";
  state.data = {
    homeId,
    awayId,
    raidPoints,
    tacklePoints,
    homeName: String(rules.homeName ?? "Home"),
    awayName: String(rules.awayName ?? "Away"),
  };
  return state;
}

export const kabaddiModule: SportModule = {
  sportId: "kabaddi",
  sport: {
    id: "kabaddi",
    name: "Kabaddi",
    icon: "kabaddi",
    accent: "var(--sport-kabaddi)",
    teamSize: 7,
    maxSubstitutes: 5,
    roles: ["Raider", "Defender", "All-rounder"],
    defaultRules: {
      halfMinutes: 20,
      halves: 2,
      playersPerSide: 7,
    },
    scoringModule: "kabaddi",
  },
  layout: { scoreboard: "split", actions: "tiles" },
  actions: kabaddiActions(),
  setupSteps: setupSteps(),
  computeState: computeKabaddiState,
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
    chips: [
      { id: "raid", label: "Raiding", tone: "live" },
    ],
    lines: [],
  }),
  playerStats: (events) => {
    const state = computeKabaddiState(events, {});
    const data = state.data as {
      raidPoints: Record<string, number>;
      tacklePoints: Record<string, number>;
    };
    const ids = new Set([...Object.keys(data.raidPoints), ...Object.keys(data.tacklePoints)]);
    const stats: Record<string, Record<string, number>> = {};
    for (const id of ids) {
      stats[id] = {
        raidPoints: data.raidPoints[id] ?? 0,
        tacklePoints: data.tacklePoints[id] ?? 0,
        superRaids: 0,
      };
    }
    return stats;
  },
  statLabels: {
    matches: "Matches",
    raidPoints: "Raid points",
    tacklePoints: "Tackle points",
    superRaids: "Super raids",
  },
  formatEvent: (event) => {
    if (event.action === "raid") {
      const pts = asNumber(event.payload.points);
      if (pts === 0) return "Empty raid";
      if (pts >= 3) return "Super raid";
      return `Raid +${pts}`;
    }
    if (event.action === "tackle") return asNumber(event.payload.points) >= 2 ? "Super tackle" : "Tackle";
    if (event.action === "all_out") return "All out";
    if (event.action === "bonus") return "Bonus";
    if (event.action === "undo") return "Undo";
    return event.action.replaceAll("_", " ");
  },
};
