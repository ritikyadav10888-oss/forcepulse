// Shapes the API returns (force-pulse-platform/apps/api), and one fetch helper for server and browser.

export const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
export const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export type Role = "player" | "organiser" | "scorer" | "team_owner" | "admin" | "super_admin";

export interface User {
  id: string;
  phone: string | null;
  email: string | null;
  platformRole: "player" | "admin" | "super_admin";
  roles: Role[];
  roleLabel: string;
}

export interface Category {
  id: string;
  name: string;
  minAge: number | null;
  underAge: number | null;
  gender: "any" | "male" | "female";
  feePaise: number | null;
}

export interface TournamentEvent {
  id: string;
  sportId: string;
  entryType: "team" | "pooled" | "individual";
  feePaise: number;
  maxTeams: number | null;
  categories: Category[];
}

export interface Tournament {
  id: string;
  slug: string;
  name: string;
  description: string;
  venue: string;
  city: string;
  startsAt: string;
  endsAt: string;
  registrationDeadline: string | null;
  status: "draft" | "enrollment_open" | "enrollment_closed" | "team_formation" | "fixtures_published" | "live" | "completed";
  visibility: "public" | "private";
  isPaid: boolean;
  registrationPath: string;
  organiserUserId: string;
  reviewRequired: boolean;
  inviteMode: "list" | "link" | null;
  refundPolicy: string;
  contactName: string;
  contactPhone: string;
  events: TournamentEvent[];
}

export interface Match {
  id: string;
  stage: "group" | "knockout";
  groupName: string | null;
  round: number;
  matchNo: number;
  homeName: string | null;
  awayName: string | null;
  homeSource: string | null;
  awaySource: string | null;
  homeScore: number | null;
  awayScore: number | null;
  winnerEntrantId: string | null;
  homeEntrantId: string | null;
  awayEntrantId: string | null;
  court: string | null;
  scheduledAt: string | null;
  status: "scheduled" | "live" | "completed" | "walkover" | "forfeit" | "abandoned" | "cancelled";
}

export interface StandingGroup {
  formatId: string;
  group: string;
  rows: { position: number; entrantId: string; name: string; played: number; won: number; drawn: number; lost: number; scoreDiff: number; points: number }[];
}

export interface LiveScore {
  matchId: string;
  sportId: string;
  status: Match["status"];
  homeName: string | null;
  awayName: string | null;
  phase: "setup" | "live" | "period_break" | "complete";
  scores: { home: number; away: number };
  winner?: "home" | "away" | "draw" | null;
  summary: { home: number | string; away: number | string; headline: string; subline?: string; lines: { id: string; label: string; value: string }[] } | null;
}

export interface Sport {
  id: string;
  name: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** One request. Errors come back as ApiError with the API's { code, message }. */
export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown; token?: string | null; base?: string } = {}): Promise<T> {
  const res = await fetch((init.base ?? API_URL) + path, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.code ?? "INTERNAL", data.message ?? "Something went wrong. Please try again.", data.details);
  return data as T;
}

/** Server components: public reads; a missing record becomes null instead of an error page. */
export async function publicGet<T>(path: string): Promise<T | null> {
  try {
    return await apiFetch<T>(path);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
