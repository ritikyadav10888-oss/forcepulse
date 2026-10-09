import { Logger } from "@nestjs/common";
import { migrateDb, openDb, seedReferenceData } from "@force-pulse/db";
import { loadConfig } from "./config";
import { API_PREFIX, createApp } from "./create-app";

async function main() {
  const config = loadConfig();
  const db = await openDb(config.databaseUrl);
  // Development runs migrations on start. Staging and production run them as a separate deploy step.
  if (config.nodeEnv !== "production") {
    await migrateDb(db);
    await seedReferenceData(db.db);
  }
  const app = await createApp({ config, db });
  await app.listen(config.port);
  new Logger("Force Pulse").log(`API ready on http://localhost:${config.port}/${API_PREFIX} (${config.nodeEnv}, ${db.kind})`);

  const stop = async () => {
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
