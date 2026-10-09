// Error codes returned by the API as { code, message } (System Design 10). The web app switches on `code`.
export const ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL",
  "POLICY_MISSING",
  "INVALID_PHONE",
  "OTP_RATE_LIMITED",
  "OTP_INVALID",
  "OTP_EXPIRED",
  "OTP_LOCKED",
  "STAFF_USE_STAFF_LOGIN",
  "INVALID_CREDENTIALS",
  "SESSION_EXPIRED",
  "ROLE_SUSPENDED",
  "ACCOUNT_SUSPENDED",
  "PLAN_LIMIT_REACHED",
  "GALLERY_FULL",
  "PAYMENT_NOT_VERIFIED",
  "BID_EXCEEDS_MAX_ALLOWED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}
