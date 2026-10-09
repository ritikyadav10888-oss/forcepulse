import { z } from "zod";
import { FIELD_TYPES, PROFILE_KEYS } from "@force-pulse/shared";

// Request bodies for tournaments, events, categories, forms and invites. Amounts are paise.

const money = z.number().int().min(0).max(10_000_000_00); // up to ₹1 crore
const limit = z.number().int().min(2).max(10_000).nullable();
const isoDateTime = z.iso.datetime({ offset: true });

export const FieldRuleInput = z.object({
  field: z.string().min(1).max(40),
  op: z.enum(["eq", "neq", "in", "gte", "lte", "contains"]),
  value: z.string().max(200),
  message: z.string().max(200).optional(),
});

export const CategoryInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    minAge: z.number().int().min(0).max(100).nullable().default(null),
    underAge: z.number().int().min(1).max(120).nullable().default(null),
    ageOn: z.iso.date().nullable().default(null),
    gender: z.enum(["any", "male", "female"]).default("any"),
    allowPlayingUp: z.boolean().default(false),
    proofRequired: z.boolean().default(false),
    maxTeams: limit.default(null),
    feePaise: money.nullable().default(null),
    fieldRules: z.array(FieldRuleInput).max(10).default([]),
  })
  .strict();

export const EventInput = z
  .object({
    sportId: z.string().min(1).max(40),
    entryType: z.enum(["team", "pooled", "individual"]),
    poolFormation: z.enum(["auction", "organizer_assigns"]).nullable().default(null),
    rules: z.record(z.string(), z.union([z.number(), z.string()])).default({}),
    maxTeams: limit.default(null),
    minPlayersPerTeam: z.number().int().min(1).max(100).nullable().default(null),
    maxPlayersPerTeam: z.number().int().min(1).max(100).nullable().default(null),
    feePaise: money.default(0),
    categories: z.array(CategoryInput).max(30).default([]),
  })
  .strict();

const details = {
  name: z.string().trim().min(1, "Give the tournament a name").max(120),
  description: z.string().max(5000).default(""),
  bannerUrl: z.string().max(500).default(""),
  logoUrl: z.string().max(500).default(""),
  venue: z.string().trim().max(200).default(""),
  city: z.string().trim().max(80).default(""),
  mapUrl: z.string().max(500).default(""),
  prizes: z.string().max(2000).default(""),
  rulesText: z.string().max(10000).default(""),
  contactName: z.string().max(80).default(""),
  contactPhone: z.string().max(20).default(""),
  refundPolicy: z.string().max(5000).default(""),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  registrationDeadline: isoDateTime.nullable().default(null),
  visibility: z.enum(["public", "private"]).default("public"),
  inviteMode: z.enum(["list", "link"]).nullable().default(null),
  reviewRequired: z.boolean().default(false),
};

export const CreateTournamentInput = z
  .object({
    ...details,
    /** Save without publishing, or open registration at once. */
    status: z.enum(["draft", "enrollment_open"]).default("draft"),
    events: z.array(EventInput).min(1, "Pick at least one sport").max(20),
  })
  .strict();
export type CreateTournamentInput = z.infer<typeof CreateTournamentInput>;

/**
 * PATCH: only the fields sent change (the service drops keys the caller didn't send, so defaults
 * never overwrite stored values). Events are replaced through PUT /tournaments/:id/events.
 */
export const UpdateTournamentInput = z.object(details).partial().strict();
export type UpdateTournamentInput = z.infer<typeof UpdateTournamentInput>;

export const ReplaceEventsInput = z.object({ events: z.array(EventInput).min(1).max(20) }).strict();

export const StatusInput = z.object({
  status: z.enum(["draft", "enrollment_open", "enrollment_closed", "team_formation", "fixtures_published", "live", "completed"]),
});

export const FieldInput = z
  .object({
    key: z.string(),
    label: z.string().trim().max(120),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    min: z.number().nullable().optional(),
    max: z.number().nullable().optional(),
    helpText: z.string().max(300).optional(),
    profileKey: z.enum(PROFILE_KEYS).nullable().optional(),
  })
  .strict();

export const FormInput = z.object({ fields: z.array(FieldInput).max(60) }).strict();

export const ListQuery = z.object({
  sportId: z.string().max(40).optional(),
  city: z.string().max(80).optional(),
  q: z.string().max(80).optional(),
  status: z.enum(["enrollment_open", "enrollment_closed", "team_formation", "fixtures_published", "live", "completed"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const InviteInput = z.object({ phone: z.string().min(1), name: z.string().trim().max(80).default("") }).strict();

export const InviteLinkInput = z
  .object({
    maxUses: z.number().int().min(1).max(100_000).nullable().optional(),
    expiresAt: isoDateTime.nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();
