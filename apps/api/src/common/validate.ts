import type { z } from "zod";
import { ApiError } from "./api-error";

/** Parses a request body or query with a zod schema; a mismatch is a 400 listing each bad field. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const fields = result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    throw new ApiError("BAD_REQUEST", fields.map((f) => (f.field ? `${f.field}: ${f.message}` : f.message)).join("; "), { fields });
  }
  return result.data;
}
