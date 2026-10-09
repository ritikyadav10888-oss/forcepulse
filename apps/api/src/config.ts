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
  UPLOAD_DIR: z.string().default(".data/uploads"),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  /** 64 hex characters (32 bytes): encrypts organiser bank account numbers. */
  PAYOUT_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "PAYOUT_ENCRYPTION_KEY must be 64 hex characters").optional(),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  otpSecret: string;
  otpProvider: "console";
  webOrigins: string[];
  /** Local folder for uploaded files (development; S3 later). */
  uploadDir: string;
  /** Null when Razorpay isn't configured: payment endpoints then answer PAYMENTS_UNAVAILABLE. */
  razorpay: { keyId: string; keySecret: string; webhookSecret: string } | null;
  payoutEncryptionKey: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  const c = parsed.data;
  const rp = [c.RAZORPAY_KEY_ID, c.RAZORPAY_KEY_SECRET, c.RAZORPAY_WEBHOOK_SECRET];
  if (rp.some(Boolean) && !rp.every(Boolean)) throw new Error("Set all three of RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET, or none");
  // Live keys charge real money: never in development or tests.
  if (c.NODE_ENV !== "production" && c.RAZORPAY_KEY_ID?.startsWith("rzp_live_")) {
    throw new Error("Live Razorpay keys (rzp_live_...) are only allowed with NODE_ENV=production. Use test keys (rzp_test_...) here");
  }
  if (c.NODE_ENV === "production") {
    if (!c.RAZORPAY_KEY_ID || !c.PAYOUT_ENCRYPTION_KEY) throw new Error("Production needs Razorpay keys and PAYOUT_ENCRYPTION_KEY");
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
    uploadDir: c.UPLOAD_DIR,
    razorpay: c.RAZORPAY_KEY_ID ? { keyId: c.RAZORPAY_KEY_ID, keySecret: c.RAZORPAY_KEY_SECRET!, webhookSecret: c.RAZORPAY_WEBHOOK_SECRET! } : null,
    payoutEncryptionKey: c.PAYOUT_ENCRYPTION_KEY ?? null,
  };
}
