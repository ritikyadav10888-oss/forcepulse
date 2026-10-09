import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import type { Server, ServerOptions } from "socket.io";
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
  app.useWebSocketAdapter(new WebOriginIoAdapter(app, deps.config.webOrigins, deps.config.redisUrl));
  return app;
}

/**
 * Socket.IO on the same port, accepting the same web origins as the HTTP API. With REDIS_URL, messages are relayed
 * through Redis so a viewer connected to one API server hears events raised on another (System Design 2, 8.1).
 */
class WebOriginIoAdapter extends IoAdapter {
  private clients: Redis[] = [];

  constructor(
    app: NestExpressApplication,
    private readonly origins: string[],
    private readonly redisUrl: string | null,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, { ...options, cors: { origin: this.origins, credentials: true } });
    if (this.redisUrl) {
      const pub = new Redis(this.redisUrl, { lazyConnect: false, maxRetriesPerRequest: null });
      const sub = pub.duplicate();
      this.clients = [pub, sub];
      server.adapter(createAdapter(pub, sub));
    }
    return server;
  }

  override async close(server: Server) {
    await super.close(server);
    await Promise.all(this.clients.map((c) => c.quit().catch(() => c.disconnect())));
  }
}
