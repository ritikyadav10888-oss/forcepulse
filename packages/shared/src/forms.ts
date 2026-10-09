// Registration form builder (SRS v2 FR-REG-03/04/05/06, System Design 4.2).
// Shared by the API (authoritative check) and the web app (instant feedback), so both say the same thing.
// Adapted from sports-reg's lib/fields.ts, with photo, file, yes/no and pincode fields added.

export const FIELD_TYPES = [
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "date",
  "select",
  "radio",
  "checkbox",
  "yesno",
  "consent",
  "photo",
  "file",
  "pincode",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Player-profile fields a form answer may fill in when the profile has no value yet. */
export const PROFILE_KEYS = ["name", "gender", "dob", "pincode", "photoUrl"] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];

export interface FieldDef {
  /** Answer key: lowercase letters, digits and underscores. Unique within a form. */
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** select / radio / checkbox */
  options?: string[];
  /** number: value range; text / textarea: length range */
  min?: number | null;
  max?: number | null;
  helpText?: string;
  /** When set, the answer also fills this player-profile field if it is empty. */
  profileKey?: ProfileKey | null;
}

export type AnswerValue = string | number | boolean | string[] | null;
export type Answers = Record<string, AnswerValue>;

/** Upload keys returned by POST /uploads, e.g. "upl_k3j9x2m1q8w7e5r4". */
export const UPLOAD_KEY = /^upl_[a-z0-9]{16,40}$/;

const KEY = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Suggested starting form (FR-REG-04). The organiser keeps, edits or removes any field.
 * Nothing is pre-filled for the player (FR-REG-02).
 */
export function suggestedFields(): FieldDef[] {
  return [
    { key: "full_name", label: "Full name", type: "text", required: true, min: 2, max: 80, profileKey: "name" },
    { key: "photo", label: "Photo", type: "photo", required: false, profileKey: "photoUrl" },
    { key: "gender", label: "Gender", type: "radio", required: true, options: ["Male", "Female"], profileKey: "gender" },
    { key: "dob", label: "Date of birth", type: "date", required: true, profileKey: "dob" },
    { key: "mobile", label: "Mobile number", type: "phone", required: true },
    { key: "email", label: "Email", type: "email", required: false },
    { key: "pincode", label: "Pincode", type: "pincode", required: true, profileKey: "pincode" },
    { key: "playing_role", label: "Playing role", type: "text", required: false, max: 60 },
    { key: "skill_grade", label: "Skill grade", type: "select", required: false, options: ["Beginner", "Intermediate", "Advanced", "Professional"] },
    { key: "jersey_size", label: "Jersey size", type: "select", required: false, options: ["XS", "S", "M", "L", "XL", "XXL"] },
    { key: "jersey_number", label: "Jersey number", type: "number", required: false, min: 0, max: 99 },
    { key: "auction_opt_in", label: "Put me in the player auction", type: "yesno", required: false },
  ];
}

/** Problems with a form definition itself (what the organiser built). Empty = fine. */
export function checkFormDefinition(fields: FieldDef[]): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  const profileKeys = new Set<string>();
  if (fields.length > 60) problems.push("A form can have at most 60 fields");
  fields.forEach((f, i) => {
    const where = `Field ${i + 1} (${f.label || f.key || "unnamed"})`;
    if (!KEY.test(f.key)) problems.push(`${where}: key must start with a letter and use only a-z, 0-9 and _`);
    if (keys.has(f.key)) problems.push(`${where}: key "${f.key}" is used twice`);
    keys.add(f.key);
    if (!f.label?.trim()) problems.push(`${where}: needs a label`);
    if (!FIELD_TYPES.includes(f.type)) problems.push(`${where}: unknown type "${f.type}"`);
    if (["select", "radio", "checkbox"].includes(f.type) && !(f.options && f.options.length >= 1)) {
      problems.push(`${where}: add at least one option`);
    }
    if (f.options && new Set(f.options).size !== f.options.length) problems.push(`${where}: options repeat`);
    if (f.min != null && f.max != null && f.min > f.max) problems.push(`${where}: min is above max`);
    if (f.profileKey) {
      if (profileKeys.has(f.profileKey)) problems.push(`${where}: another field already fills ${f.profileKey}`);
      profileKeys.add(f.profileKey);
    }
  });
  return problems;
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** Error message for one answer, or null when it is fine. */
export function validateAnswer(f: FieldDef, v: unknown): string | null {
  if (f.type === "consent") return v === true ? null : f.required ? `${f.label}: please agree to continue` : null;
  if (isEmpty(v)) return f.required ? `${f.label} is required` : null;
  const s = typeof v === "string" ? v.trim() : String(v);
  switch (f.type) {
    case "email":
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `${f.label} must be a valid email`;
      break;
    case "phone":
      if (!/^[6-9]\d{9}$/.test(s.replace(/^(\+91|91|0)/, "").replace(/[\s-]/g, ""))) return `${f.label} must be a valid 10-digit mobile number`;
      break;
    case "number": {
      const n = typeof v === "number" ? v : Number(s);
      if (!Number.isFinite(n)) return `${f.label} must be a number`;
      if (f.min != null && n < f.min) return `${f.label} must be at least ${f.min}`;
      if (f.max != null && n > f.max) return `${f.label} must be at most ${f.max}`;
      break;
    }
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) return `${f.label} must be a date (YYYY-MM-DD)`;
      break;
    case "select":
    case "radio":
      if (typeof v !== "string" || !f.options?.includes(s)) return `${f.label}: choose one of the options`;
      break;
    case "checkbox":
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !f.options?.includes(x))) return `${f.label}: choose from the options`;
      break;
    case "yesno":
      if (typeof v !== "boolean") return `${f.label}: answer yes or no`;
      break;
    case "photo":
    case "file":
      if (typeof v !== "string" || !UPLOAD_KEY.test(v)) return `${f.label}: upload a file`;
      break;
    case "pincode":
      if (!/^[1-9]\d{5}$/.test(s)) return `${f.label} must be a 6-digit Indian pincode`;
      break;
    case "text":
    case "textarea":
      if (typeof v !== "string") return `${f.label} must be text`;
      if (f.min != null && s.length < f.min) return `${f.label} must be at least ${f.min} characters`;
      if (f.max != null && s.length > f.max) return `${f.label} must be at most ${f.max} characters`;
      if (s.length > (f.type === "text" ? 200 : 2000)) return `${f.label} is too long`;
      break;
  }
  return null;
}

/**
 * Checks answers against a form. Returns errors by field key (empty = valid) and the cleaned answers:
 * trimmed text, numbers as numbers, and nothing that isn't on the form.
 */
export function validateAnswers(fields: FieldDef[], raw: Record<string, unknown>): { errors: Record<string, string>; answers: Answers } {
  const errors: Record<string, string> = {};
  const answers: Answers = {};
  for (const f of fields) {
    const v = raw?.[f.key];
    const e = validateAnswer(f, v);
    if (e) {
      errors[f.key] = e;
      continue;
    }
    if (isEmpty(v)) continue;
    if (f.type === "number") answers[f.key] = typeof v === "number" ? v : Number(String(v).trim());
    else if (typeof v === "string") answers[f.key] = v.trim();
    else answers[f.key] = v as AnswerValue;
  }
  return { errors, answers };
}

/** Profile values carried by a form's answers, for the fields bound to the profile. */
export function profileValuesFrom(fields: FieldDef[], answers: Answers): Partial<Record<ProfileKey, string>> {
  const out: Partial<Record<ProfileKey, string>> = {};
  for (const f of fields) {
    if (!f.profileKey) continue;
    const v = answers[f.key];
    if (typeof v !== "string" || !v) continue;
    out[f.profileKey] = f.profileKey === "gender" ? v.toLowerCase() : v;
  }
  return out;
}
