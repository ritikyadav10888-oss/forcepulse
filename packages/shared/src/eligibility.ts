// Category eligibility (SRS v2 FR-REG-09). Same rules as the web app's src/lib/eligibility.ts,
// plus sports-reg's custom-field rules (e.g. "Company is one of Acme, Globex").
import type { Answers } from "./forms";

export type CategoryGender = "any" | "male" | "female";

export type FieldRule = {
  field: string;
  op: "eq" | "neq" | "in" | "gte" | "lte" | "contains";
  value: string;
  message?: string;
};

export interface CategoryRules {
  name: string;
  /** Youngest allowed age in completed years (inclusive). */
  minAge: number | null;
  /** Must be younger than this: U12 is underAge 12. */
  underAge: number | null;
  /** YYYY-MM-DD ages are counted on; null = tournament start date. */
  ageOn: string | null;
  gender: CategoryGender;
  /** Lets players younger than minAge enter. */
  allowPlayingUp: boolean;
  fieldRules: FieldRule[];
}

export type Eligibility = { ok: true } | { ok: false; reason: string };

const parts = (value: string): [number, number, number] | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/** Age in completed years on a date. Both YYYY-MM-DD (a time part is ignored). Null if unreadable or before birth. */
export function ageOn(dob: string, on: string): number | null {
  const born = parts(dob);
  const at = parts(on);
  if (!born || !at) return null;
  const hadBirthday = at[1] > born[1] || (at[1] === born[1] && at[2] >= born[2]);
  const age = at[0] - born[0] - (hadBirthday ? 0 : 1);
  return age < 0 ? null : age;
}

/** Under 18 on that date: registration then needs a parent or guardian's consent. */
export function isMinor(dob: string, on: string): boolean {
  const age = ageOn(dob, on);
  return age !== null && age < 18;
}

const OPS: Record<FieldRule["op"], string> = {
  eq: "must be",
  neq: "must not be",
  in: "must be one of",
  gte: "must be at least",
  lte: "must be at most",
  contains: "must include",
};

function fieldRuleHolds(rule: FieldRule, answers: Answers): boolean {
  const raw = answers[rule.field];
  const target = rule.value.trim().toLowerCase();
  const text = Array.isArray(raw) ? "" : String(raw ?? "").trim().toLowerCase();
  switch (rule.op) {
    case "eq":
      return text === target;
    case "neq":
      return text !== target;
    case "in":
      return target.split(",").map((x) => x.trim()).includes(text);
    case "gte":
      return raw !== null && raw !== undefined && raw !== "" && Number(raw) >= Number(rule.value);
    case "lte":
      return raw !== null && raw !== undefined && raw !== "" && Number(raw) <= Number(rule.value);
    case "contains":
      return Array.isArray(raw) ? raw.map((x) => x.toLowerCase()).includes(target) : text.includes(target);
  }
}

/** Can this player enter this category? `startsAt` is the tournament start (ISO). */
export function checkCategoryEligibility(
  player: { dob: string | null; gender: "male" | "female" | null },
  category: CategoryRules,
  startsAt: string,
  answers: Answers = {},
): Eligibility {
  if (category.minAge !== null || category.underAge !== null) {
    const cutoff = category.ageOn ?? startsAt.slice(0, 10);
    const age = player.dob ? ageOn(player.dob, cutoff) : null;
    if (age === null) return { ok: false, reason: "Add a date of birth to check eligibility" };
    if (category.underAge !== null && age >= category.underAge) return { ok: false, reason: `Under ${category.underAge} only (age on ${cutoff})` };
    if (category.minAge !== null && age < category.minAge && !category.allowPlayingUp) {
      return { ok: false, reason: `Minimum age ${category.minAge} (age on ${cutoff})` };
    }
  }
  if (category.gender !== "any") {
    if (!player.gender) return { ok: false, reason: "Add gender to check eligibility" };
    if (player.gender !== category.gender) return { ok: false, reason: category.gender === "male" ? "Boys / men only" : "Girls / women only" };
  }
  for (const rule of category.fieldRules) {
    if (!fieldRuleHolds(rule, answers)) return { ok: false, reason: rule.message || `${rule.field} ${OPS[rule.op]} ${rule.value}` };
  }
  return { ok: true };
}
