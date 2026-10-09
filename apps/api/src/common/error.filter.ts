import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Response } from "express";
import type { ApiErrorBody, ErrorCode } from "@force-pulse/shared";
import { ApiError } from "./api-error";

const BY_STATUS: Record<number, ErrorCode> = {
  400: "BAD_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "BAD_REQUEST",
  429: "RATE_LIMITED",
};

/** Every error leaves the API as { code, message } (System Design 10). Unknown errors never leak details. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger("Error");

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let body: ApiErrorBody = { code: "INTERNAL", message: "Something went wrong. Please try again." };

    if (err instanceof ApiError) {
      status = err.getStatus();
      body = { code: err.code, message: err.message, ...(err.details === undefined ? {} : { details: err.details }) };
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      body = { code: BY_STATUS[status] ?? "INTERNAL", message: status === 404 ? "Not found." : err.message };
    } else {
      this.log.error(err instanceof Error ? err.stack : String(err));
    }
    res.status(status).json(body);
  }
}
