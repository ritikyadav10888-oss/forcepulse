import { HttpException } from "@nestjs/common";
import type { ErrorCode } from "@force-pulse/shared";

const STATUS: Partial<Record<ErrorCode, number>> = {
  BAD_REQUEST: 400,
  INVALID_PHONE: 400,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  POLICY_MISSING: 403,
  STAFF_USE_STAFF_LOGIN: 403,
  ROLE_SUSPENDED: 403,
  ACCOUNT_SUSPENDED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  OTP_LOCKED: 423,
  RATE_LIMITED: 429,
  OTP_RATE_LIMITED: 429,
};

/** The one error type services throw. Becomes { code, message, details? } on the wire. */
export class ApiError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, STATUS[code] ?? 500);
  }
}
