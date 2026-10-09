// Pure bid rules (FR-AUC-06, FR-AUC-11, FR-AUC-12; System Design 7.3).
import type { BidSlab } from "@force-pulse/db";

/** First bid is the base; after that the current bid plus the raise of the slab it falls in. */
export function nextBid(currentBid: number | null, basePoints: number, slabs: BidSlab[]): number {
  if (currentBid === null) return basePoints;
  const slab = [...slabs].sort((a, b) => a.from - b.from).filter((s) => s.from <= currentBid).at(-1);
  if (!slab) throw new Error("No bid slab covers this amount");
  return currentBid + slab.raise;
}

/**
 * The most a team may bid and still fill its minimum squad at the lowest base price (FR-AUC-12, AC-09):
 * points left − (empty slots after this player × lowest base).
 */
export function maxAllowedBid(pointsLeft: number, squadSize: number, minSquad: number, lowestBase: number): number {
  const emptySlots = Math.max(0, minSquad - squadSize);
  return pointsLeft - Math.max(0, emptySlots - 1) * lowestBase;
}

export type BidCheck = { ok: true } | { ok: false; code: "CONFLICT" | "BID_EXCEEDS_MAX_ALLOWED"; reason: string };

export function checkBid(input: {
  amount: number;
  pointsLeft: number;
  squadSize: number;
  minSquad: number;
  maxSquad: number;
  lowestBase: number;
  /** Players this team already has from the lot's category, and that category's quota (null = none). */
  inCategory: number;
  quota: number | null;
}): BidCheck {
  if (input.squadSize >= input.maxSquad) return { ok: false, code: "CONFLICT", reason: "This team's squad is full." };
  if (input.quota !== null && input.inCategory >= input.quota) return { ok: false, code: "CONFLICT", reason: "This team has reached its quota for this category." };
  const max = maxAllowedBid(input.pointsLeft, input.squadSize, input.minSquad, input.lowestBase);
  if (input.amount > max) {
    return { ok: false, code: "BID_EXCEEDS_MAX_ALLOWED", reason: `This team can bid at most ${max} points and still fill its squad.` };
  }
  return { ok: true };
}
