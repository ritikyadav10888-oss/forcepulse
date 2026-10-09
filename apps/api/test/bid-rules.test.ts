import { describe, expect, it } from "vitest";
import { checkBid, maxAllowedBid, nextBid } from "../src/auction/bid-rules";

const slabs = [
  { from: 0, raise: 1_000 },
  { from: 20_000, raise: 2_000 },
  { from: 50_000, raise: 5_000 },
];

describe("bid rules", () => {
  it("first bid is the base price, then the raise of the current slab (FR-AUC-06, FR-AUC-11)", () => {
    expect(nextBid(null, 10_000, slabs)).toBe(10_000);
    expect(nextBid(10_000, 10_000, slabs)).toBe(11_000);
    expect(nextBid(20_000, 10_000, slabs)).toBe(22_000);
    expect(nextBid(55_000, 10_000, slabs)).toBe(60_000);
  });

  it("AC-09: 50,000 left, 3 empty slots, lowest base 10,000 → at most 30,000; a 35,000 bid is refused", () => {
    expect(maxAllowedBid(50_000, 2, 5, 10_000)).toBe(30_000);
    const check = checkBid({ amount: 35_000, pointsLeft: 50_000, squadSize: 2, minSquad: 5, maxSquad: 8, lowestBase: 10_000, inCategory: 0, quota: null });
    expect(check).toEqual({ ok: false, code: "BID_EXCEEDS_MAX_ALLOWED", reason: "This team can bid at most 30000 points and still fill its squad." });
    expect(checkBid({ amount: 30_000, pointsLeft: 50_000, squadSize: 2, minSquad: 5, maxSquad: 8, lowestBase: 10_000, inCategory: 0, quota: null })).toEqual({ ok: true });
  });

  it("a full squad or a met quota can't bid", () => {
    const base = { amount: 1, pointsLeft: 100, squadSize: 4, minSquad: 2, maxSquad: 4, lowestBase: 1, inCategory: 0, quota: null };
    expect(checkBid(base)).toMatchObject({ ok: false, reason: "This team's squad is full." });
    expect(checkBid({ ...base, squadSize: 1, inCategory: 2, quota: 2 })).toMatchObject({ ok: false, reason: /quota/ });
  });
});
