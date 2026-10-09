// Pure fixture logic (FR-TRN-05 to 08, FR-TRN-11): round robin, groups, knockout brackets, scheduling, standings.
import type { FormatConfig, TieBreaker } from "@force-pulse/db";

/** One side of a planned match: a known entrant, a placeholder ("A1", "W:3", "L:5"), or nobody. */
export type Side = { entrantId: string } | { source: string } | null;

export interface PlannedMatch {
  stage: "group" | "knockout";
  groupName: string | null;
  round: number;
  matchNo: number;
  home: Side;
  away: Side;
}

const GROUP_NAMES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Seeds dealt into groups in a snake (A B C C B A …), so each group gets a fair mix. */
export function splitGroups(seeded: string[], groups: number): string[][] {
  const out: string[][] = Array.from({ length: groups }, () => []);
  seeded.forEach((id, i) => {
    const lap = Math.floor(i / groups);
    out[lap % 2 === 0 ? i % groups : groups - 1 - (i % groups)].push(id);
  });
  return out;
}

/** Circle method: every pair meets once per leg, nobody plays twice in a round. */
export function roundRobin(ids: string[], legs: 1 | 2): { round: number; home: string; away: string }[] {
  const list: (string | null)[] = ids.length % 2 ? [...ids, null] : [...ids];
  const n = list.length;
  const out: { round: number; home: string; away: string }[] = [];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      // Alternate home and away so nobody is always "home".
      if (a && b) out.push(r % 2 === 0 ? { round: r + 1, home: a, away: b } : { round: r + 1, home: b, away: a });
    }
    list.splice(1, 0, list.pop()!);
  }
  if (legs === 2) {
    const rounds = n - 1;
    out.push(...out.map((m) => ({ round: m.round + rounds, home: m.away, away: m.home })));
  }
  return out;
}

/** Standard bracket order: seed 1 meets the lowest seed, and seeds 1 and 2 can only meet in the final. */
export function bracketOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2;
    order = order.flatMap((s) => [s, next + 1 - s]);
  }
  return order;
}

/**
 * Knockout bracket (FR-TRN-06). Seeds are best first; missing seeds are byes, given to the top seeds,
 * and a bye is not a match: that entrant goes straight into round 2.
 */
export function knockout(seeds: Side[], opts: { thirdPlace: boolean; firstMatchNo?: number }): PlannedMatch[] {
  if (seeds.length < 2) throw new Error("A knockout needs at least two entrants");
  let size = 2;
  while (size < seeds.length) size *= 2;
  const slots = bracketOrder(size).map((s) => seeds[s - 1] ?? null);

  const out: PlannedMatch[] = [];
  let matchNo = opts.firstMatchNo ?? 1;
  // What feeds the next round: an entrant (after a bye) or the winner of a match.
  let feeds: Side[] = [];
  for (let i = 0; i < slots.length; i += 2) {
    const [a, b] = [slots[i], slots[i + 1]];
    if (a && b) {
      out.push({ stage: "knockout", groupName: null, round: 1, matchNo, home: a, away: b });
      feeds.push({ source: `W:${matchNo++}` });
    } else feeds.push(a ?? b);
  }

  let round = 2;
  const semis: number[] = [];
  while (feeds.length > 1) {
    const next: Side[] = [];
    if (feeds.length === 4) semis.length = 0;
    for (let i = 0; i < feeds.length; i += 2) {
      out.push({ stage: "knockout", groupName: null, round, matchNo, home: feeds[i], away: feeds[i + 1] });
      if (feeds.length === 4) semis.push(matchNo);
      next.push({ source: `W:${matchNo++}` });
    }
    feeds = next;
    round++;
  }
  // Semi-finals at round 1 (a 4-entrant bracket) are the round-1 matches.
  const semiMatches = size === 4 ? out.filter((m) => m.round === 1).map((m) => m.matchNo) : semis;
  if (opts.thirdPlace && semiMatches.length === 2) {
    const final = out[out.length - 1];
    out.push({ stage: "knockout", groupName: null, round: final.round, matchNo, home: { source: `L:${semiMatches[0]}` }, away: { source: `L:${semiMatches[1]}` } });
  }
  return out;
}

/** Fixtures for a whole format, from entrants already in seed order (FR-TRN-04 to 07). */
export function planFormat(type: "league" | "knockout" | "league_knockout", seeded: string[], config: FormatConfig): PlannedMatch[] {
  if (type === "knockout") return knockout(seeded.map((entrantId) => ({ entrantId })), { thirdPlace: config.thirdPlace });

  if (config.groups < 1 || config.groups > seeded.length / 2) throw new Error("Each group needs at least two entrants");
  const groups = splitGroups(seeded, config.groups);
  const out: PlannedMatch[] = [];
  let matchNo = 1;
  groups.forEach((ids, g) => {
    for (const m of roundRobin(ids, config.legs)) {
      out.push({ stage: "group", groupName: GROUP_NAMES[g], round: m.round, matchNo: matchNo++, home: { entrantId: m.home }, away: { entrantId: m.away } });
    }
  });
  if (type === "league") return out;

  // Crossover (FR-TRN-07): group winners in order, then runners-up in order, … gives A1–B2 and B1–A2.
  const q = config.qualifiersPerGroup;
  if (q < 1 || groups.some((ids) => ids.length < q)) throw new Error("Every group must have at least as many entrants as qualify from it");
  const places: Side[] = [];
  for (let p = 1; p <= q; p++) groups.forEach((_, g) => places.push({ source: `${GROUP_NAMES[g]}${p}` }));
  return [...out, ...knockout(places, { thirdPlace: config.thirdPlace, firstMatchNo: matchNo })];
}

// ---------- Scheduling (FR-TRN-08) ----------

export interface ScheduleOptions {
  /** First day, India date YYYY-MM-DD. */
  startDate: string;
  /** India time "HH:MM" each day. */
  dayStart: string;
  dayEnd: string;
  matchMinutes: number;
  courts: string[];
}

export interface Busy {
  start: number;
  end: number;
  court: string | null;
  players: string[];
}

const IST_MS = 330 * 60_000;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Gives each match the earliest court and time on the organiser's grid where the court is free and none of
 * its players is playing elsewhere (other categories included, via `busy`). A knockout match starts only
 * after the matches feeding it end. Matches keep the order given.
 */
export function schedule(
  list: PlannedMatch[],
  playersOf: (side: Side) => string[],
  opts: ScheduleOptions,
  busy: Busy[] = [],
): { scheduledAt: Date; court: string }[] {
  const dayLen = minutes(opts.dayEnd) - minutes(opts.dayStart);
  const perDay = Math.floor(dayLen / opts.matchMinutes);
  if (perDay < 1 || !opts.courts.length) throw new Error("The day is shorter than one match, or no courts were given");
  const day0 = Date.parse(`${opts.startDate}T00:00:00Z`) - IST_MS + minutes(opts.dayStart) * 60_000;
  const slotStart = (s: number) => day0 + Math.floor(s / perDay) * 86_400_000 + (s % perDay) * opts.matchMinutes * 60_000;
  const dur = opts.matchMinutes * 60_000;
  const taken: Busy[] = [...busy];
  const endOf = new Map<number, number>();
  const overlaps = (a: Busy, start: number) => a.start < start + dur && start < a.end;

  return list.map((m) => {
    const players = [...playersOf(m.home), ...playersOf(m.away)];
    const after = Math.max(0, ...[m.home, m.away].map((s) => (s && "source" in s && /^[WL]:/.test(s.source) ? (endOf.get(Number(s.source.slice(2))) ?? 0) : 0)));
    for (let s = 0; s < perDay * 60; s++) {
      const start = slotStart(s);
      if (start < after) continue;
      const clashes = taken.filter((b) => overlaps(b, start));
      if (players.some((p) => clashes.some((b) => b.players.includes(p)))) continue;
      const court = opts.courts.find((c) => !clashes.some((b) => b.court === c));
      if (!court) continue;
      taken.push({ start, end: start + dur, court, players });
      endOf.set(m.matchNo, start + dur);
      return { scheduledAt: new Date(start), court };
    }
    throw new Error("The fixtures don't fit in 60 days with these courts and times");
  });
}

// ---------- Standings (FR-TRN-05, FR-TRN-11) ----------

export interface ResultRow {
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  /** Null for a draw. */
  winner: string | null;
}

export interface StandingRow {
  entrantId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  scored: number;
  conceded: number;
  scoreDiff: number;
  points: number;
}

export function standings(entrants: string[], results: ResultRow[], config: Pick<FormatConfig, "points" | "tieBreakers">): StandingRow[] {
  const rows = new Map(entrants.map((id) => [id, { entrantId: id, played: 0, won: 0, drawn: 0, lost: 0, scored: 0, conceded: 0, scoreDiff: 0, points: 0 }]));
  for (const r of results) {
    const [h, a] = [rows.get(r.home), rows.get(r.away)];
    if (!h || !a) continue;
    for (const [me, mine, theirs] of [[h, r.homeScore, r.awayScore], [a, r.awayScore, r.homeScore]] as const) {
      me.played++;
      me.scored += mine ?? 0;
      me.conceded += theirs ?? 0;
      if (r.winner === null) {
        me.drawn++;
        me.points += config.points.draw;
      } else if (r.winner === me.entrantId) {
        me.won++;
        me.points += config.points.win;
      } else {
        me.lost++;
        me.points += config.points.loss;
      }
    }
  }
  for (const row of rows.values()) row.scoreDiff = row.scored - row.conceded;

  // Points a gained against b in their own matches.
  const versus = (a: string, b: string) =>
    results
      .filter((r) => (r.home === a && r.away === b) || (r.home === b && r.away === a))
      .reduce((p, r) => p + (r.winner === null ? config.points.draw : r.winner === a ? config.points.win : config.points.loss), 0);

  const key: Record<TieBreaker, (x: StandingRow, y: StandingRow) => number> = {
    points: (x, y) => y.points - x.points,
    score_diff: (x, y) => y.scoreDiff - x.scoreDiff,
    scored: (x, y) => y.scored - x.scored,
    wins: (x, y) => y.won - x.won,
    // shortcut: head-to-head compares two entrants at a time; a three-way tie may not order consistently. Upgrade to a mini-table if organisers ask.
    head_to_head: (x, y) => versus(y.entrantId, x.entrantId) - versus(x.entrantId, y.entrantId),
  };
  const order: TieBreaker[] = ["points", ...config.tieBreakers.filter((t) => t !== "points")];
  return [...rows.values()].sort((x, y) => {
    for (const t of order) {
      const d = key[t](x, y);
      if (d) return d;
    }
    return 0;
  });
}
