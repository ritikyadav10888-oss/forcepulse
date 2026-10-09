import { randomInt } from "node:crypto";

/** No look-alikes (0/O, 1/I/L): safe to read out over the phone or type from a poster. */
export const READABLE = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export function randomCode(length: number, alphabet = READABLE): string {
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
}

/** "Mumbai Smash Open 2026" → "mumbai-smash-open-2026" */
export function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "tournament"
  );
}
