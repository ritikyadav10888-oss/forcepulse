import { describe, expect, it } from "vitest";
import { checkCategoryEligibility, checkFormDefinition, profileValuesFrom, suggestedFields, validateAnswers, type CategoryRules, type FieldDef } from "./index";

const u12Boys: CategoryRules = { name: "U12 Boys", minAge: null, underAge: 12, ageOn: "2026-12-31", gender: "male", allowPlayingUp: false, fieldRules: [] };

describe("form definition", () => {
  it("the suggested form is valid and has nothing pre-filled (FR-REG-02, FR-REG-04)", () => {
    const fields = suggestedFields();
    expect(checkFormDefinition(fields)).toEqual([]);
    expect(fields.some((f) => "default" in f || "value" in f)).toBe(false);
    expect(fields.map((f) => f.type)).toEqual(expect.arrayContaining(["photo", "pincode", "yesno", "date"]));
  });

  it("catches duplicate keys, missing options and bad ranges", () => {
    const problems = checkFormDefinition([
      { key: "a", label: "A", type: "text", required: false },
      { key: "a", label: "A again", type: "select", required: false },
      { key: "Bad Key", label: "", type: "number", required: false, min: 5, max: 1 },
    ]);
    expect(problems.join("\n")).toMatch(/used twice/);
    expect(problems.join("\n")).toMatch(/at least one option/);
    expect(problems.join("\n")).toMatch(/key must start/);
    expect(problems.join("\n")).toMatch(/needs a label/);
    expect(problems.join("\n")).toMatch(/min is above max/);
  });
});

describe("answers", () => {
  const fields: FieldDef[] = [
    { key: "name", label: "Name", type: "text", required: true, min: 2, profileKey: "name" },
    { key: "pin", label: "Pincode", type: "pincode", required: true, profileKey: "pincode" },
    { key: "jersey", label: "Jersey", type: "number", required: false, min: 0, max: 99 },
    { key: "photo", label: "Photo", type: "photo", required: false },
    { key: "auction", label: "Auction", type: "yesno", required: false },
    { key: "agree", label: "Rules", type: "consent", required: true },
  ];

  it("cleans valid answers and drops keys that aren't on the form", () => {
    const { errors, answers } = validateAnswers(fields, { name: "  Asha ", pin: "400001", jersey: "7", auction: true, agree: true, extra: "x" });
    expect(errors).toEqual({});
    expect(answers).toEqual({ name: "Asha", pin: "400001", jersey: 7, auction: true, agree: true });
    expect(profileValuesFrom(fields, answers)).toEqual({ name: "Asha", pincode: "400001" });
  });

  it("reports each bad field", () => {
    const { errors } = validateAnswers(fields, { name: "A", pin: "012345", jersey: 120, photo: "../../etc/passwd", auction: "yes" });
    expect(Object.keys(errors).sort()).toEqual(["agree", "auction", "jersey", "name", "photo", "pin"]);
  });
});

describe("category eligibility (FR-REG-09)", () => {
  it("counts age on the category's cut-off date", () => {
    expect(checkCategoryEligibility({ dob: "2015-01-01", gender: "male" }, u12Boys, "2026-11-01T09:00:00Z")).toEqual({ ok: true });
    expect(checkCategoryEligibility({ dob: "2014-12-31", gender: "male" }, u12Boys, "2026-11-01T09:00:00Z")).toEqual({
      ok: false,
      reason: "Under 12 only (age on 2026-12-31)",
    });
  });

  it("checks gender and asks for missing profile data", () => {
    expect(checkCategoryEligibility({ dob: "2015-01-01", gender: "female" }, u12Boys, "2026-11-01")).toMatchObject({ ok: false, reason: "Boys / men only" });
    expect(checkCategoryEligibility({ dob: null, gender: "male" }, u12Boys, "2026-11-01")).toMatchObject({ ok: false, reason: /date of birth/ });
  });

  it("lets younger players play up only when allowed", () => {
    const open18: CategoryRules = { ...u12Boys, name: "Open", underAge: null, minAge: 18, gender: "any" };
    expect(checkCategoryEligibility({ dob: "2012-01-01", gender: "male" }, open18, "2026-11-01").ok).toBe(false);
    expect(checkCategoryEligibility({ dob: "2012-01-01", gender: "male" }, { ...open18, allowPlayingUp: true }, "2026-11-01").ok).toBe(true);
  });

  it("applies custom-field rules", () => {
    const corporate: CategoryRules = { ...u12Boys, underAge: null, gender: "any", fieldRules: [{ field: "company", op: "in", value: "Acme, Globex" }] };
    expect(checkCategoryEligibility({ dob: null, gender: null }, corporate, "2026-11-01", { company: "globex" }).ok).toBe(true);
    expect(checkCategoryEligibility({ dob: null, gender: null }, corporate, "2026-11-01", { company: "Initech" })).toMatchObject({ ok: false, reason: "company must be one of Acme, Globex" });
  });
});
