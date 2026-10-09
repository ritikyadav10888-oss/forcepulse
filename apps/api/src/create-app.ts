import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule, type AppDeps } from "./app.module";

export const API_PREFIX = "api/v1";

/** Builds the HTTP app. Used by main.ts and by the tests, so both run exactly the same setup. */
export async function createApp(deps: AppDeps): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(deps), {
    rawBody: true, // Razorpay signs the exact bytes of its webhook body
    logger: deps.config.nodeEnv === "test" ? false : ["log", "warn", "error"],
  });
  app.setGlobalPrefix(API_PREFIX);
  app.enableCors({ origin: deps.config.webOrigins, credentials: true });
  app.disable("x-powered-by");
  // One proxy hop (load balancer) in front, so req.ip is the caller's address for OTP limits.
  app.set("trust proxy", 1);
  app.useBodyParser("json", { limit: "100kb" });
  return app;
}
