// Stacked roles (SRS v2 2.2): every account is a player; other roles are added by actions or by staff.
export const ROLES = ["player", "organiser", "scorer", "team_owner", "admin", "super_admin"] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES: readonly Role[] = ["admin", "super_admin"];

/** The web app's single `platformRole` field: highest staff role, otherwise "player". */
export type PlatformRole = "player" | "admin" | "super_admin";

export function platformRoleOf(roles: readonly Role[]): PlatformRole {
  if (roles.includes("super_admin")) return "super_admin";
  if (roles.includes("admin")) return "admin";
  return "player";
}

const LABELS: Record<Role, string> = {
  player: "Player",
  organiser: "Organiser",
  scorer: "Scorer",
  team_owner: "Team Owner",
  admin: "Admin",
  super_admin: "Super Admin",
};

/** "Player / Organiser / Scorer" for the account header (FR-AUTH-05), in a fixed order. */
export function combinedRoleLabel(roles: readonly Role[]): string {
  return ROLES.filter((r) => roles.includes(r)).map((r) => LABELS[r]).join(" / ");
}
