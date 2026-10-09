import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { auditLogs, ensureSuperAdmin, migrateDb, openDb, seedReferenceData, settings, sports, userRoles, users, type DbHandle } from "./index";

let handle: DbHandle;

beforeAll(async () => {
  handle = await openDb("pglite:memory");
  await migrateDb(handle);
});

afterAll(() => handle.close());

describe("migrations and seed", () => {
  it("seeds sports and fee settings, and is safe to run twice", async () => {
    await seedReferenceData(handle.db);
    await seedReferenceData(handle.db);
    const rows = await handle.db.select().from(sports);
    expect(rows).toHaveLength(16);
    const [fees] = await handle.db.select().from(settings).where(eq(settings.key, "fees"));
    expect(fees.value).toEqual({ platformFeeBps: 300, convenienceFeePaidByPlayer: true, gstBps: 0 });
  });

  it("creates the first super admin once", async () => {
    expect(await ensureSuperAdmin(handle.db, "Boss@Example.com", "long-enough-pw")).toBe(true);
    expect(await ensureSuperAdmin(handle.db, "boss@example.com", "long-enough-pw")).toBe(false);
    const [u] = await handle.db.select().from(users).where(eq(users.email, "boss@example.com"));
    const roles = await handle.db.select().from(userRoles).where(eq(userRoles.userId, u.id));
    expect(roles.map((r) => r.role).sort()).toEqual(["admin", "super_admin"]);
  });
});

describe("database guards", () => {
  it("refuses an unknown role", async () => {
    const [u] = await handle.db.insert(users).values({ phone: "+919800000099" }).returning();
    await expect(
      handle.db.insert(userRoles).values({ userId: u.id, role: "owner" as never, grantedByAction: "test" }),
    ).rejects.toThrow();
  });

  it("keeps the audit log append-only", async () => {
    const [row] = await handle.db.insert(auditLogs).values({ entity: "test", entityId: "1", action: "create" }).returning();
    await expect(handle.db.update(auditLogs).set({ action: "changed" }).where(eq(auditLogs.id, row.id))).rejects.toThrow();
    await expect(handle.db.delete(auditLogs).where(eq(auditLogs.id, row.id))).rejects.toThrow();
    const [{ n }] = await handle.db.select({ n: sql<number>`count(*)::int` }).from(auditLogs);
    expect(n).toBe(1);
  });
});
