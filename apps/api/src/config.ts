import { z } from "zod";

const DEV_SECRET = /change-me/;

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().default("pglite:.data/pglite"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  OTP_SECRET: z.string().min(32, "OTP_SECRET must be at least 32 characters"),
  OTP_PROVIDER: z.enum(["console"]).default("console"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  otpSecret: string;
  otpProvider: "console";
  webOrigins: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === "production") {
    if (DEV_SECRET.test(c.JWT_SECRET) || DEV_SECRET.test(c.OTP_SECRET)) throw new Error("Set real JWT_SECRET and OTP_SECRET in production");
    if (c.OTP_PROVIDER === "console") throw new Error("OTP_PROVIDER=console prints codes to the log and is not allowed in production");
    if (c.DATABASE_URL.startsWith("pglite:")) throw new Error("Use PostgreSQL (postgres://…) in production, not PGlite");
  }
  return {
    nodeEnv: c.NODE_ENV,
    port: c.PORT,
    databaseUrl: c.DATABASE_URL,
    jwtSecret: c.JWT_SECRET,
    otpSecret: c.OTP_SECRET,
    otpProvider: c.OTP_PROVIDER,
    webOrigins: c.WEB_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean),
  };
}
