import path from "node:path";
import { mkdirSync } from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Schema = typeof schema;
/** Works the same over PGlite (development, tests) and node-postgres (staging, production). */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export interface DbHandle {
  db: Db;
  kind: "pglite" | "postgres";
  close(): Promise<void>;
}

const MIGRATIONS = path.join(__dirname, "..", "migrations");

/**
 * DATABASE_URL:
 *   "" or "pglite:memory"  → in-memory PGlite (tests)
 *   "pglite:<folder>"      → PGlite stored in that folder (local development)
 *   "postgres://…"         → real PostgreSQL
 */
export async function openDb(url = process.env.DATABASE_URL ?? ""): Promise<DbHandle> {
  if (url === "" || url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const target = url.slice("pglite:".length);
    let dataDir: string | undefined;
    if (target && target !== "memory") {
      dataDir = path.resolve(target);
      mkdirSync(dataDir, { recursive: true });
    }
    const client = new PGlite(dataDir);
    const db = drizzle(client, { schema }) as unknown as Db;
    return { db, kind: "pglite", close: () => client.close() };
  }
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
  const db = drizzle(pool, { schema }) as unknown as Db;
  return { db, kind: "postgres", close: () => pool.end() };
}

/** Applies the SQL migrations in packages/db/migrations that haven't run yet. */
export async function migrateDb(handle: DbHandle): Promise<void> {
  if (handle.kind === "pglite") {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(handle.db as never, { migrationsFolder: MIGRATIONS });
  } else {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(handle.db as never, { migrationsFolder: MIGRATIONS });
  }
}
