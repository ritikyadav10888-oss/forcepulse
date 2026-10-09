import { activeEvents, asNumber, csv, emptyState, ruleNumber, splitSquad } from "./events";
import type {
  ActionField,
  BallTone,
  MatchState,
  ScoringAction,
  SetupStep,
  SportModule,
} from "./types";
import type { ScoreEvent } from "./types";

type Batter = { runs: number; balls: number };
type Bowler = { balls: number; runs: number; wickets: number };

type InningsSnap = {
  battingTeamId: string;
  bowlingTeamId: string;
  runs: number;
  wickets: number;
  legalBalls: number;
  extras: { wd: number; nb: number; b: number; lb: number };
  thisOver: { label: string; tone: BallTone }[];
  strikerId: string | null;
  nonStrikerId: string | null;
  bowlerId: string | null;
  batters: Record<string, Batter>;
  bowlers: Record<string, Bowler>;
  dismissed: string[];
  completed: boolean;
};

const DISMISSALS = [
  { value: "bowled", label: "Bowled" },
  { value: "caught", label: "Caught" },
  { value: "lbw", label: "LBW" },
  { value: "run_out", label: "Run out" },
  { value: "stumped", label: "Stumped" },
  { value: "hit_wicket", label: "Hit wicket" },
];

const BOWLER_WICKETS = new Set(["bowled", "caught", "lbw", "stumped", "hit_wicket"]);

function oversLabel(legalBalls: number, ballsPerOver: number) {
  const overs = Math.floor(legalBalls / ballsPerOver);
  const balls = legalBalls % ballsPerOver;
  return `${overs}.${balls}`;
}

function swapStrike(innings: InningsSnap) {
  const next = innings.strikerId;
  innings.strikerId = innings.nonStrikerId;
  innings.nonStrikerId = next;
}

function ensureBatter(innings: InningsSnap, playerId: string | null) {
  if (!playerId) return;
  innings.batters[playerId] ??= { runs: 0, balls: 0 };
}

function ensureBowler(innings: InningsSnap, playerId: string | null) {
  if (!playerId) return;
  innings.bowlers[playerId] ??= { balls: 0, runs: 0, wickets: 0 };
}

function remainingBatters(innings: InningsSnap, lineup: string[]) {
  const out = new Set(innings.dismissed);
  const on = new Set([innings.strikerId, innings.nonStrikerId].filter(Boolean));
  return lineup.filter((id) => !out.has(id) && !on.has(id));
}

function creditBowlerRuns(innings: InningsSnap, runs: number) {
  if (!innings.bowlerId) return;
  ensureBowler(innings, innings.bowlerId);
  innings.bowlers[innings.bowlerId].runs += runs;
}

function legalDelivery(innings: InningsSnap, ballsPerOver: number) {
  innings.legalBalls += 1;
  if (innings.bowlerId) {
    ensureBowler(innings, innings.bowlerId);
    innings.bowlers[innings.bowlerId].balls += 1;
  }
  if (innings.legalBalls % ballsPerOver === 0) {
    swapStrike(innings);
    innings.thisOver = [];
    innings.bowlerId = null;
  }
}

function inningsOver(innings: InningsSnap, rules: Record<string, number | string>) {
  const maxOvers = ruleNumber(rules, "overs", 20);
  const ballsPerOver = ruleNumber(rules, "ballsPerOver", 6);
  const wickets = ruleNumber(rules, "wickets", Math.max(1, ruleNumber(rules, "playersPerSide", 11) - 1));
  return (
    innings.completed ||
    innings.wickets >= wickets ||
    innings.legalBalls >= maxOvers * ballsPerOver
  );
}

function battingLineup(state: MatchState, battingTeamId: string, homeId: string) {
  return battingTeamId === homeId ? state.playerSets.home : state.playerSets.away;
}

function bowlingLineup(state: MatchState, bowlingTeamId: string, homeId: string) {
  return bowlingTeamId === homeId ? state.playerSets.home : state.playerSets.away;
}

export function computeCricketState(
  events: ScoreEvent[],
  rules: Record<string, number | string>,
): MatchState {
  const state = emptyState();
  const homeId = String(rules.homeTeamId ?? "");
  const awayId = String(rules.awayTeamId ?? "");
  const ballsPerOver = ruleNumber(rules, "ballsPerOver", 6);
  state.playerSets.homeSquad = splitSquad(rules, "homeSquad");
  state.playerSets.awaySquad = splitSquad(rules, "awaySquad");
  state.playerSets.home = [...state.playerSets.homeSquad];
  state.playerSets.away = [...state.playerSets.awaySquad];
  state.playerSets.batting = [];
  state.playerSets.bowling = [];
  state.playerSets.onStrike = [];
  state.playerSets.nextBatter = [];
  state.playerSets.nextBowler = [];

  let tossWinner: string | null = null;
  let elected: string | null = null;
  let firstBatting: string | null = null;
  const innings: InningsSnap[] = [];
  let current: InningsSnap | null = null;
  let matchOver = false;
  let winner: string | "draw" | null = null;

  const startInnings = (battingTeamId: string, bowlingTeamId: string): InningsSnap => {
    const next: InningsSnap = {
      battingTeamId,
      bowlingTeamId,
      runs: 0,
      wickets: 0,
      legalBalls: 0,
      extras: { wd: 0, nb: 0, b: 0, lb: 0 },
      thisOver: [],
      strikerId: null,
      nonStrikerId: null,
      bowlerId: null,
      batters: {},
      bowlers: {},
      dismissed: [],
      completed: false,
    };
    innings.push(next);
    return next;
  };

  for (const event of activeEvents(events)) {
    if (event.action === "lineup") {
      const homePlayers = csv(event.payload.homePlayerIds);
      const awayPlayers = csv(event.payload.awayPlayerIds);
      if (homePlayers.length) state.playerSets.home = homePlayers;
      if (awayPlayers.length) state.playerSets.away = awayPlayers;
      state.flags.lineupsSet = true;
    }
    if (event.action === "toss") {
      tossWinner = String(event.payload.winnerTeamId ?? "");
      elected = String(event.payload.elected ?? "bat");
      if (tossWinner === homeId || tossWinner === awayId) {
        const other = tossWinner === homeId ? awayId : homeId;
        firstBatting = elected === "bowl" ? other : tossWinner;
      }
      state.flags.tossSet = true;
    }
    if (event.action === "openers" && firstBatting) {
      if (!current || current.completed) {
        const batting = innings.length === 0 ? firstBatting : firstBatting === homeId ? awayId : homeId;
        const bowling = batting === homeId ? awayId : homeId;
        current = startInnings(batting, bowling);
      }
      const inn = current;
      inn.strikerId = String(event.payload.strikerId ?? "");
      inn.nonStrikerId = String(event.payload.nonStrikerId ?? "");
      inn.bowlerId = String(event.payload.bowlerId ?? "");
      ensureBatter(inn, inn.strikerId);
      ensureBatter(inn, inn.nonStrikerId);
      ensureBowler(inn, inn.bowlerId);
    }
    if (event.action === "set_bowler" && current && !current.completed) {
      current.bowlerId = String(event.payload.playerId ?? "");
      ensureBowler(current, current.bowlerId);
    }
    if (event.action === "run" && current && !current.completed && current.bowlerId) {
      const runs = asNumber(event.payload.runs);
      current.runs += runs;
      if (current.strikerId) {
        ensureBatter(current, current.strikerId);
        current.batters[current.strikerId].runs += runs;
        current.batters[current.strikerId].balls += 1;
      }
      creditBowlerRuns(current, runs);
      const tone: BallTone = runs === 4 ? "four" : runs === 6 ? "six" : runs === 0 ? "dot" : "run";
      current.thisOver.push({ label: String(runs), tone });
      if (runs % 2 === 1) swapStrike(current);
      legalDelivery(current, ballsPerOver);
    }
    if (event.action === "extra" && current && !current.completed && current.bowlerId) {
      const kind = String(event.payload.kind ?? "wide");
      const extraRuns = asNumber(event.payload.runs);
      if (kind === "wide") {
        const total = 1 + extraRuns;
        current.runs += total;
        current.extras.wd += total;
        creditBowlerRuns(current, total);
        current.thisOver.push({ label: extraRuns ? `Wd+${extraRuns}` : "Wd", tone: "extra" });
        if (extraRuns % 2 === 1) swapStrike(current);
      } else if (kind === "noball") {
        const total = 1 + extraRuns;
        current.runs += total;
        current.extras.nb += 1;
        if (current.strikerId) {
          ensureBatter(current, current.strikerId);
          current.batters[current.strikerId].runs += extraRuns;
        }
        creditBowlerRuns(current, total);
        current.thisOver.push({ label: extraRuns ? `Nb+${extraRuns}` : "Nb", tone: "extra" });
        if (extraRuns % 2 === 1) swapStrike(current);
      } else {
        const total = Math.max(1, extraRuns);
        current.runs += total;
        if (kind === "bye") current.extras.b += total;
        else current.extras.lb += total;
        if (current.strikerId) {
          ensureBatter(current, current.strikerId);
          current.batters[current.strikerId].balls += 1;
        }
        current.thisOver.push({ label: kind === "bye" ? `B${total}` : `Lb${total}`, tone: "extra" });
        if (total % 2 === 1) swapStrike(current);
        legalDelivery(current, ballsPerOver);
      }
    }
    if (event.action === "wicket" && current && !current.completed && current.bowlerId) {
      const dismissed = String(event.payload.playerId ?? current.strikerId ?? "");
      const kind = String(event.payload.kind ?? "bowled");
      const newbie = String(event.payload.newBatsmanId ?? "");
      current.wickets += 1;
      current.dismissed.push(dismissed);
      if (current.strikerId) {
        ensureBatter(current, current.strikerId);
        current.batters[current.strikerId].balls += 1;
      }
      if (BOWLER_WICKETS.has(kind) && current.bowlerId) {
        ensureBowler(current, current.bowlerId);
        current.bowlers[current.bowlerId].wickets += 1;
      }
      current.thisOver.push({ label: "W", tone: "wicket" });
      if (dismissed === current.strikerId) current.strikerId = newbie || null;
      else if (dismissed === current.nonStrikerId) current.nonStrikerId = newbie || null;
      if (newbie) ensureBatter(current, newbie);
      legalDelivery(current, ballsPerOver);
    }
    if (event.action === "end_innings" && current) {
      current.completed = true;
      current = null;
    }
    if (event.action === "end_match") {
      matchOver = true;
      if (current) current.completed = true;
    }

    if (current && !current.completed && inningsOver(current, rules)) {
      current.completed = true;
      if (innings.length === 2) matchOver = true;
    }
    if (innings.length === 2 && current && !current.completed) {
      const target = innings[0].runs + 1;
      if (current.runs >= target) {
        matchOver = true;
        current.completed = true;
        winner = current.battingTeamId;
      }
    }
  }

  const live = innings.find((row) => !row.completed) ?? null;
  const first = innings[0] ?? null;
  const second = innings[1] ?? null;

  if (first) {
    if (first.battingTeamId === homeId) state.scores.home = first.runs;
    else state.scores.away = first.runs;
  }
  if (second) {
    if (second.battingTeamId === homeId) state.scores.home = second.runs;
    else state.scores.away = second.runs;
  }

  state.flags.lineupsSet = Boolean(state.flags.lineupsSet);
  state.flags.tossSet = Boolean(tossWinner);
  state.flags.openersSet = Boolean(first?.strikerId);
  state.flags.matchOver = matchOver;
  state.flags.tossWinner = tossWinner;
  state.flags.elected = elected;
  state.flags.firstBatting = firstBatting;
  state.flags.needsBowler = Boolean(live && !live.completed && !live.bowlerId && live.strikerId);
  state.flags.needsOpeners = Boolean(
    firstBatting && (!first || (first.completed && !second) || (live && !live.strikerId)),
  );

  if (live) {
    state.playerSets.batting = battingLineup(state, live.battingTeamId, homeId);
    state.playerSets.bowling = bowlingLineup(state, live.bowlingTeamId, homeId);
    state.playerSets.onStrike = [live.strikerId, live.nonStrikerId].filter((id): id is string => Boolean(id));
    state.playerSets.nextBatter = remainingBatters(live, state.playerSets.batting);
    state.playerSets.nextBowler = state.playerSets.bowling.filter((id) => id !== live.bowlerId);
    state.periodLabel = `Inn ${innings.length} · ${oversLabel(live.legalBalls, ballsPerOver)} ov`;
  }

  if (matchOver) state.phase = "complete";
  else if (live?.strikerId && live.bowlerId) state.phase = "live";
  else if (live && !live.bowlerId && live.strikerId) state.phase = "live";
  else if (first?.completed && !second) state.phase = "period_break";
  else if (state.flags.lineupsSet && state.flags.tossSet && state.flags.openersSet) state.phase = "live";
  else state.phase = "setup";

  if (state.flags.needsBowler && live && state.phase !== "complete") {
    state.pending = {
      title: "New bowler",
      description: "Over complete. Choose who bowls the next over.",
      action: "set_bowler",
      fields: [{ key: "playerId", label: "Bowler", type: "player", from: "nextBowler", required: true }],
    };
  } else if (first?.completed && !second && !matchOver) {
    state.pending = {
      title: "Second innings",
      description: "Set openers and the opening bowler.",
      action: "openers",
      fields: openerFields(),
    };
    state.playerSets.batting = battingLineup(state, first.bowlingTeamId, homeId);
    state.playerSets.bowling = bowlingLineup(state, first.battingTeamId, homeId);
  } else if (state.flags.tossSet && !state.flags.openersSet) {
    if (firstBatting) {
      state.playerSets.batting = battingLineup(state, firstBatting, homeId);
      state.playerSets.bowling = bowlingLineup(state, firstBatting === homeId ? awayId : homeId, homeId);
    }
  }

  if (matchOver && !winner) {
    if (state.scores.home === state.scores.away) winner = "draw";
    else winner = state.scores.home > state.scores.away ? homeId : awayId;
  }
  state.flags.winner = winner;

  state.data = {
    innings,
    live,
    homeId,
    awayId,
    ballsPerOver,
    homeName: String(rules.homeName ?? "Home"),
    awayName: String(rules.awayName ?? "Away"),
  };
  return state;
}

function openerFields(): ActionField[] {
  return [
    { key: "strikerId", label: "Striker", type: "player", from: "batting", required: true },
    { key: "nonStrikerId", label: "Non-striker", type: "player", from: "batting", required: true },
    { key: "bowlerId", label: "Opening bowler", type: "player", from: "bowling", required: true },
  ];
}

function cricketActions(): ScoringAction[] {
  const run = (n: number, tone: ScoringAction["tone"] = "default"): ScoringAction => ({
    id: `run-${n}`,
    action: "run",
    label: String(n),
    group: "runs",
    payload: { runs: n },
    shape: "circle",
    tone,
    visible: (state) => state.phase === "live" && !state.pending && !state.flags.matchOver,
  });

  return [
    run(0, "muted"),
    run(1),
    run(2),
    run(3),
    run(4, "boundary"),
    run(6, "six"),
    {
      id: "wide",
      action: "extra",
      label: "Wide",
      group: "extras",
      payload: { kind: "wide", runs: 0 },
      shape: "tile",
      tone: "outline",
      visible: liveNoPending,
    },
    {
      id: "noball",
      action: "extra",
      label: "No ball",
      group: "extras",
      payload: { kind: "noball", runs: 0 },
      shape: "tile",
      tone: "outline",
      visible: liveNoPending,
    },
    {
      id: "bye",
      action: "extra",
      label: "Bye",
      group: "extras",
      payload: { kind: "bye", runs: 1 },
      shape: "tile",
      tone: "outline",
      visible: liveNoPending,
    },
    {
      id: "legbye",
      action: "extra",
      label: "Leg bye",
      group: "extras",
      payload: { kind: "legbye", runs: 1 },
      shape: "tile",
      tone: "outline",
      visible: liveNoPending,
    },
    {
      id: "wicket",
      action: "wicket",
      label: "Wicket",
      group: "wicket",
      shape: "wide",
      tone: "danger",
      fields: [
        { key: "kind", label: "Dismissal", type: "select", options: DISMISSALS, required: true },
        { key: "playerId", label: "Batter out", type: "player", from: "onStrike", required: true },
        { key: "newBatsmanId", label: "New batter", type: "player", from: "nextBatter", required: true },
      ],
      visible: liveNoPending,
    },
    {
      id: "end-innings",
      action: "end_innings",
      label: "End innings",
      group: "period",
      confirm: "End this innings?",
      shape: "wide",
      visible: (state) => state.phase === "live" && !state.pending,
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

function liveNoPending(state: MatchState) {
  return state.phase === "live" && !state.pending && !state.flags.matchOver;
}

function setupSteps(): SetupStep[] {
  return [
    {
      id: "lineup",
      title: "Playing XIs",
      description: "Confirm who is in the match for both sides.",
      action: "lineup",
      fields: [
        { key: "homePlayerIds", label: "Home XI", type: "players", from: "homeSquad", required: true },
        { key: "awayPlayerIds", label: "Away XI", type: "players", from: "awaySquad", required: true },
      ],
      done: (state) => Boolean(state.flags.lineupsSet),
    },
    {
      id: "toss",
      title: "Toss",
      description: "Who won the toss, and what did they elect?",
      action: "toss",
      fields: [
        {
          key: "winnerTeamId",
          label: "Toss winner",
          type: "team",
          required: true,
        },
        {
          key: "elected",
          label: "Elected to",
          type: "select",
          options: [
            { value: "bat", label: "Bat" },
            { value: "bowl", label: "Bowl" },
          ],
          required: true,
        },
      ],
      done: (state) => Boolean(state.flags.tossSet),
    },
    {
      id: "openers",
      title: "Openers",
      description: "Striker, non-striker, and opening bowler — CricHeroes style.",
      action: "openers",
      fields: openerFields(),
      done: (state) => Boolean(state.flags.openersSet),
    },
  ];
}

function summariseCricket(state: MatchState) {
  const data = state.data as {
    innings: InningsSnap[];
    live: InningsSnap | null;
    homeId: string;
    awayId: string;
    ballsPerOver: number;
    homeName: string;
    awayName: string;
  };
  const live = data.live;
  const first = data.innings[0];
  const teamName = (id: string) => (id === data.homeId ? data.homeName : data.awayName);
  const fmt = (inn: InningsSnap | undefined) =>
    inn ? `${inn.runs}/${inn.wickets}` : "Yet to bat";

  const homeInn = data.innings.find((row) => row.battingTeamId === data.homeId);
  const awayInn = data.innings.find((row) => row.battingTeamId === data.awayId);

  const striker = live?.strikerId ? live.batters[live.strikerId] : null;
  const non = live?.nonStrikerId ? live.batters[live.nonStrikerId] : null;
  const bowler = live?.bowlerId ? live.bowlers[live.bowlerId] : null;
  const crr =
    live && live.legalBalls > 0 ? ((live.runs * data.ballsPerOver) / live.legalBalls).toFixed(2) : "—";

  const groups = [];
  if (live) {
    groups.push({
      title: "Batters",
      lines: [
        {
          id: "striker",
          label: live.strikerId ?? "Striker",
          value: striker ? `${striker.runs} (${striker.balls})` : "—",
          hint: "on strike",
          emphasize: true,
        },
        {
          id: "non",
          label: live.nonStrikerId ?? "Non-striker",
          value: non ? `${non.runs} (${non.balls})` : "—",
        },
      ],
    });
    groups.push({
      title: "Bowler",
      lines: [
        {
          id: "bowler",
          label: live.bowlerId ?? "Bowler",
          value: bowler
            ? `${bowler.wickets}/${bowler.runs} (${oversLabel(bowler.balls, data.ballsPerOver)})`
            : "—",
        },
      ],
    });
  }

  return {
    home: fmt(homeInn),
    away: fmt(awayInn),
    headline: live
      ? `${teamName(live.battingTeamId)} ${live.runs}/${live.wickets}`
      : first
        ? `${teamName(first.battingTeamId)} ${first.runs}/${first.wickets}`
        : "Cricket",
    subline: live
      ? `${oversLabel(live.legalBalls, data.ballsPerOver)} ov · CRR ${crr}`
      : first
        ? "Innings break"
        : "Toss upcoming",
    status: state.phase === "complete" ? "Match over" : undefined,
    chips: live
      ? [
          { id: "inn", label: `INN ${data.innings.length}`, tone: "live" as const },
          { id: "ex", label: `Ex ${live.extras.wd + live.extras.nb + live.extras.b + live.extras.lb}` },
        ]
      : [],
    lines: [],
    groups,
    balls: live?.thisOver ?? [],
  };
}

function cricketPlayerStats(events: ScoreEvent[]) {
  const state = computeCricketState(events, {});
  const innings = (state.data as { innings: InningsSnap[] }).innings ?? [];
  const stats: Record<string, Record<string, number>> = {};
  for (const inn of innings) {
    for (const [id, row] of Object.entries(inn.batters)) {
      stats[id] ??= { runs: 0, balls: 0, wickets: 0 };
      stats[id].runs += row.runs;
      stats[id].balls += row.balls;
    }
    for (const [id, row] of Object.entries(inn.bowlers)) {
      stats[id] ??= { runs: 0, balls: 0, wickets: 0 };
      stats[id].wickets += row.wickets;
    }
  }
  return stats;
}

function formatCricketEvent(event: ScoreEvent) {
  if (event.action === "run") return `${event.payload.runs} run${event.payload.runs === 1 ? "" : "s"}`;
  if (event.action === "extra") return String(event.payload.kind ?? "extra");
  if (event.action === "wicket") return `Wicket · ${String(event.payload.kind ?? "").replaceAll("_", " ")}`;
  if (event.action === "undo") return "Undo";
  return event.action.replaceAll("_", " ");
}

export const cricketModule: SportModule = {
  sportId: "cricket",
  sport: {
    id: "cricket",
    name: "Cricket",
    icon: "cricket",
    accent: "var(--sport-cricket)",
    teamSize: 11,
    maxSubstitutes: 4,
    roles: ["Batsman", "Bowler", "All-rounder", "Wicket-keeper"],
    defaultRules: {
      overs: 20,
      playersPerSide: 11,
      ballsPerOver: 6,
      wickets: 10,
    },
    scoringModule: "cricket",
  },
  layout: { scoreboard: "hero", actions: "circles" },
  actions: cricketActions(),
  setupSteps: setupSteps(),
  computeState: computeCricketState,
  isMatchOver: (state) => state.phase === "complete" || Boolean(state.flags.matchOver),
  getWinner: (state) => {
    const winner = state.flags.winner;
    if (winner === "draw") return "draw";
    if (typeof winner === "string" && winner) return winner;
    return null;
  },
  summarise: summariseCricket,
  playerStats: cricketPlayerStats,
  statLabels: {
    matches: "Matches",
    runs: "Runs",
    balls: "Balls",
    wickets: "Wickets",
    average: "Average",
  },
  formatEvent: formatCricketEvent,
};
