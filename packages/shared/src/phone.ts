// Indian mobile numbers. Same rules as the web app's src/lib/phone.ts, so both sides agree on one format.
export const INDIA_DIAL = "+91";

const digitsOnly = (value: string) => value.replace(/\D/g, "");

/** 10-digit national number, or null when the input isn't a valid Indian mobile (starts 6–9). */
export function toNationalMobile(value: string): string | null {
  let digits = digitsOnly(value);
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** "+919876543210", or null when invalid. Stored this way in users.phone. */
export function toE164Mobile(value: string): string | null {
  const national = toNationalMobile(value);
  return national ? `${INDIA_DIAL}${national}` : null;
}

/** "+91 98765 ••210" for logs and screens that must not show the full number. */
export function maskMobile(e164: string): string {
  const n = e164.slice(-10);
  return `${INDIA_DIAL} ${n.slice(0, 5)} ••${n.slice(7)}`;
}
