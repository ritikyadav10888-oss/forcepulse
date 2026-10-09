// All amounts are integer paise. Rates are basis points (1% = 100 bps), read from admin settings
// and frozen on each payment (SRS v2 FR-PAY-08, System Design 5.2).

export const DEFAULT_PLATFORM_FEE_BPS = 300; // 3% of the entry fee, kept by Force Pulse

export interface FeeSplit {
  entryFee: number;
  platformFee: number;
  organiserShare: number;
}

/**
 * Splits an entry fee into Force Pulse's platform fee and the organiser's share.
 * The platform fee rounds half up to the paisa; the organiser gets the exact remainder,
 * so the two always add back to the entry fee.
 * The convenience fee (Razorpay's charge) is paid by the player on top and is not part of this split.
 */
export function splitEntryFee(entryFee: number, platformFeeBps = DEFAULT_PLATFORM_FEE_BPS): FeeSplit {
  if (!Number.isSafeInteger(entryFee) || entryFee < 0) throw new RangeError("entryFee must be a non-negative integer (paise)");
  if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 10_000) {
    throw new RangeError("platformFeeBps must be an integer from 0 to 10000");
  }
  const platformFee = Math.floor((entryFee * platformFeeBps + 5_000) / 10_000);
  return { entryFee, platformFee, organiserShare: entryFee - platformFee };
}

/** ₹1,023.60 style, for receipts and statements. */
export function formatInr(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2, maximumFractionDigits: 2 })}`;
}
