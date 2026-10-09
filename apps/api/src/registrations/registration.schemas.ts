import { z } from "zod";

const Guardian = z.object({ name: z.string().trim().min(1).max(80), phone: z.string().trim().min(1).max(20) }).strict();
const Answers = z.record(z.string(), z.unknown()).default({});

/** What every entry form sends. `playerId` defaults to the caller's own player. */
const common = {
  playerId: z.uuid().optional(),
  inviteCode: z.string().trim().max(40).nullable().optional(),
  guardian: Guardian.nullable().optional(),
  answers: Answers,
  proofKey: z.string().max(60).nullable().optional(),
};

/** FR-REG-08: several sports / categories in one submission. */
export const RegisterInput = z
  .object({
    ...common,
    entries: z
      .array(z.object({ eventId: z.uuid(), categoryId: z.uuid().nullable().optional() }).strict())
      .min(1, "Pick at least one sport")
      .max(10),
  })
  .strict();
export type RegisterInput = z.infer<typeof RegisterInput>;

/** FR-REG-07: a captain registers a team and gets a code for team-mates. */
export const TeamRegisterInput = z
  .object({
    ...common,
    teamName: z.string().trim().min(2).max(60),
    color: z.string().trim().max(20).default(""),
    categoryId: z.uuid().nullable().optional(),
  })
  .strict();
export type TeamRegisterInput = z.infer<typeof TeamRegisterInput>;

export const JoinTeamInput = z.object({ ...common, code: z.string().trim().min(4).max(12) }).strict();
export type JoinTeamInput = z.infer<typeof JoinTeamInput>;

export const ListEnrollmentsQuery = z.object({
  status: z.enum(["payment_pending", "pending_review", "enrolled", "waitlisted", "rejected", "removed", "expired"]).optional(),
  eventId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
});

export const ReviewInput = z
  .object({ action: z.enum(["approve", "reject", "waitlist"]), reason: z.string().trim().max(500).optional() })
  .strict()
  .refine((v) => v.action !== "reject" || !!v.reason, { message: "Give a reason when rejecting", path: ["reason"] });

export const ReasonInput = z.object({ reason: z.string().trim().max(500).optional() }).strict();
export const FlagInput = z.object({ flagged: z.boolean() }).strict();

export const ManagedPlayerInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    dob: z.iso.date(),
    gender: z.enum(["male", "female"]),
  })
  .strict();
