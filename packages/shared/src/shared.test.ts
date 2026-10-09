import { describe, expect, it } from "vitest";
import { combinedRoleLabel, platformRoleOf, splitEntryFee, toE164Mobile, maskMobile } from "./index";

describe("splitEntryFee", () => {
  it("₹1,000 entry fee → ₹30 platform fee, ₹970 to the organiser (AC-02)", () => {
    expect(splitEntryFee(100_000)).toEqual({ entryFee: 100_000, platformFee: 3_000, organiserShare: 97_000 });
  });

  it("always adds back to the entry fee, rounding the platform fee half up", () => {
    for (const fee of [0, 1, 17, 50, 99_99, 123_457, 2_500_00]) {
      const s = splitEntryFee(fee);
      expect(s.platformFee + s.organiserShare).toBe(fee);
    }
    expect(splitEntryFee(50).platformFee).toBe(2); // 1.5 paise → 2
    expect(splitEntryFee(16).platformFee).toBe(0); // 0.48 paise → 0
  });

  it("rejects non-integer paise and out-of-range rates", () => {
    expect(() => splitEntryFee(10.5)).toThrow(RangeError);
    expect(() => splitEntryFee(-1)).toThrow(RangeError);
    expect(() => splitEntryFee(100, 10_001)).toThrow(RangeError);
  });
});

describe("phone", () => {
  it("normalises Indian mobiles to E.164", () => {
    expect(toE164Mobile("98765 43210")).toBe("+919876543210");
    expect(toE164Mobile("+91-98765-43210")).toBe("+919876543210");
    expect(toE164Mobile("09876543210")).toBe("+919876543210");
  });

  it("rejects numbers that aren't Indian mobiles", () => {
    expect(toE164Mobile("12345")).toBeNull();
    expect(toE164Mobile("5876543210")).toBeNull();
  });

  it("masks the middle digits", () => {
    expect(maskMobile("+919876543210")).toBe("+91 98765 ••210");
  });
});

describe("roles", () => {
  it("labels stacked roles in a fixed order (AC-06)", () => {
    expect(combinedRoleLabel(["scorer", "player", "organiser"])).toBe("Player / Organiser / Scorer");
  });

  it("maps to the web app's platformRole", () => {
    expect(platformRoleOf(["player", "organiser"])).toBe("player");
    expect(platformRoleOf(["player", "admin"])).toBe("admin");
    expect(platformRoleOf(["admin", "super_admin"])).toBe("super_admin");
  });
});
