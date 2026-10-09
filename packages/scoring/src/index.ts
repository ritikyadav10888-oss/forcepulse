// Scoring engines by sport. Pure functions over an append-only event list (System Design 6): the API replays
// events through these to get the score, and the web app can run the same code offline.
import { cricketModule } from "./cricket";
import { footballModule } from "./football";
import { kabaddiModule } from "./kabaddi";
import { SET_KNOBS, setSport, setsModule } from "./sets";
import { TENNIS_KNOBS, tennisModule } from "./tennis";
import { TIMED_KNOBS, timedModule, WRESTLING_KNOBS, wrestlingDecisions } from "./timed";
import type { RuleKnob, SportModule } from "./types";

export * from "./types";
export { activeEvents, UNDO_ACTION } from "./events";

const plus = (v: number) => `+${v}`;
const withKnobs = (m: SportModule, ruleKnobs: RuleKnob[]): SportModule => ({ ...m, ruleKnobs });

const halves: RuleKnob[] = [
  { key: "halves", label: "Number of halves", type: "number", min: 1, max: 4, required: true },
  { key: "halfMinutes", label: "Minutes per half", type: "number", min: 1, max: 60, required: true },
];

/** The 11 sports with scoring screens in the web app. Suggestions in defaultRules are never applied automatically. */
export const SCORING_MODULES: Record<string, SportModule> = {
  cricket: withKnobs(cricketModule, [
    { key: "overs", label: "Overs per innings", type: "number", min: 1, max: 50, required: true },
    { key: "ballsPerOver", label: "Balls per over", type: "number", min: 4, max: 8, required: true },
    { key: "playersPerSide", label: "Players per side", type: "number", min: 2, max: 11, required: true },
    { key: "wickets", label: "Wickets per innings", type: "number", min: 1, max: 10, required: false },
  ]),
  football: withKnobs(footballModule, halves),
  kabaddi: withKnobs(kabaddiModule, halves),
  badminton: withKnobs(setsModule(setSport("badminton", "Badminton", 2, ["Singles", "Doubles"], { pointsToWin: 21, winBy: 2, cap: 30, bestOf: 3 })), SET_KNOBS),
  "table-tennis": withKnobs(setsModule(setSport("table-tennis", "Table tennis", 1, ["Singles", "Doubles"], { pointsToWin: 11, winBy: 2, cap: 0, bestOf: 5 })), SET_KNOBS),
  volleyball: withKnobs(
    setsModule({ ...setSport("volleyball", "Volleyball", 6, ["Setter", "Outside hitter", "Middle blocker", "Opposite", "Libero"], { pointsToWin: 25, winBy: 2, cap: 0, bestOf: 5, decidingGamePoints: 15 }), maxSubstitutes: 6 }),
    SET_KNOBS,
  ),
  tennis: withKnobs(
    tennisModule(setSport("tennis", "Tennis", 1, ["Singles", "Doubles"], { setsBestOf: 3, gamesPerSet: 6, tieBreakAt: 6, tieBreakPoints: 7 })),
    TENNIS_KNOBS,
  ),
  basketball: withKnobs(
    timedModule({ ...setSport("basketball", "Basketball", 5, ["Point guard", "Shooting guard", "Small forward", "Power forward", "Centre"], { periods: 4, periodMinutes: 10 }), maxSubstitutes: 7 }, [1, 2, 3], plus),
    TIMED_KNOBS,
  ),
  hockey: withKnobs(
    timedModule({ ...setSport("hockey", "Hockey", 11, ["Goalkeeper", "Defender", "Midfielder", "Forward"], { periods: 4, periodMinutes: 15 }), maxSubstitutes: 5 }, [1], () => "goal"),
    TIMED_KNOBS,
  ),
  "kho-kho": withKnobs(
    timedModule({ ...setSport("kho-kho", "Kho-kho", 9, ["Chaser", "Runner", "All-rounder"], { periods: 4, periodMinutes: 7 }), maxSubstitutes: 3 }, [1, 2], plus),
    TIMED_KNOBS,
  ),
  wrestling: withKnobs(
    timedModule(setSport("wrestling", "Wrestling", 1, ["Freestyle", "Greco-Roman", "Pehlwani"], { periods: 2, periodMinutes: 3, technicalSuperiority: 10 }), [1, 2, 4, 5], plus, wrestlingDecisions),
    WRESTLING_KNOBS,
  ),
};

export function getScoringModule(sportId: string): SportModule | undefined {
  return SCORING_MODULES[sportId];
}

/** Checks an organiser's rule set against the sport's knobs (FR-SCR-01). Returns problems; empty = valid. */
export function checkRules(sportId: string, rules: Record<string, unknown>): string[] {
  const m = SCORING_MODULES[sportId];
  if (!m?.ruleKnobs) return [`No scoring rules for ${sportId} yet`];
  const problems: string[] = [];
  for (const key of Object.keys(rules)) if (!m.ruleKnobs.some((k) => k.key === key)) problems.push(`${key} isn't a setting for ${m.sport.name}`);
  for (const k of m.ruleKnobs) {
    const v = rules[k.key];
    if (v === undefined || v === null || v === "") {
      if (k.required) problems.push(`${k.label} is required`);
      continue;
    }
    if (k.type === "number" && (typeof v !== "number" || !Number.isInteger(v) || (k.min !== undefined && v < k.min) || (k.max !== undefined && v > k.max))) {
      problems.push(`${k.label} must be a whole number from ${k.min} to ${k.max}`);
    }
    if (k.type === "select" && !k.options!.includes(String(v))) problems.push(`${k.label} must be one of ${k.options!.join(", ")}`);
    if (k.type === "boolean" && typeof v !== "boolean") problems.push(`${k.label} must be yes or no`);
  }
  return problems;
}
