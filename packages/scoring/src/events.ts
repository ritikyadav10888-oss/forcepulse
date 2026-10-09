import type { ScoreEvent } from "./types";

export const UNDO_ACTION = "undo";

export function sortEvents(events: ScoreEvent[]): ScoreEvent[] {
  return [...events].sort((a, b) => a.seq - b.seq);
}

/** Undo pops the last scoring event from the compute stack. Events are never deleted. */
export function activeEvents(events: ScoreEvent[]): ScoreEvent[] {
  const stack: ScoreEvent[] = [];
  for (const event of sortEvents(events)) {
    if (event.action === UNDO_ACTION) {
      stack.pop();
      continue;
    }
    stack.push(event);
  }
  return stack;
}

export function nextSeq(events: ScoreEvent[]): number {
  if (events.length === 0) return 1;
  return Math.max(...events.map((event) => event.seq)) + 1;
}

export function csv(value: string | number | boolean | null | undefined): string[] {
  if (value == null || value === "") return [];
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function asNumber(value: string | number | boolean | null | undefined, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function ruleNumber(
  rules: Record<string, number | string>,
  key: string,
  fallback: number,
): number {
  return asNumber(rules[key], fallback);
}

export function splitSquad(rules: Record<string, number | string>, key: string): string[] {
  return csv(rules[key]);
}

export function emptyState(): import("./types").MatchState {
  return {
    phase: "setup",
    scores: { home: 0, away: 0 },
    flags: {},
    playerSets: {},
    pending: null,
    meta: {},
    data: {},
  };
}
