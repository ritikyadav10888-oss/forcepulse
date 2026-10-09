import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { IoAdapter } from "@nestjs/platform-socket.io";
import type { ServerOptions } from "socket.io";
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
  app.useWebSocketAdapter(new WebOriginIoAdapter(app, deps.config.webOrigins));
  return app;
}

/** Socket.IO on the same port, accepting the same web origins as the HTTP API. */
class WebOriginIoAdapter extends IoAdapter {
  constructor(
    app: NestExpressApplication,
    private readonly origins: string[],
  ) {
    super(app);
  }
  override createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, { ...options, cors: { origin: this.origins, credentials: true } });
  }
}
