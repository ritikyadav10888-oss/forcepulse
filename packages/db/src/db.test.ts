import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { auditLogs, enrollments, ensureSuperAdmin, migrateDb, openDb, parsePincodeCsv, players, seedReferenceData, settings, sports, tournamentEvents, tournaments, userRoles, users, type DbHandle } from "./index";

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

describe("pincodes (FR-REG-05)", () => {
  it("keeps one row per pincode from the India Post CSV, with quoted fields", () => {
    const csv = [
      "circlename,regionname,divisionname,officename,pincode,officetype,delivery,district,statename,latitude,longitude",
      'Maharashtra Circle,Mumbai Region,Mumbai GPO,"Mumbai G.P.O., Fort",400001,H.O,Delivery,MUMBAI,MAHARASHTRA,18.9,72.8',
      "Maharashtra Circle,Mumbai Region,Mumbai GPO,Bazargate S.O,400001,S.O,Delivery,MUMBAI,MAHARASHTRA,18.9,72.8",
      "Karnataka Circle,Bangalore,Bangalore GPO,Bangalore G.P.O.,560001,H.O,Delivery,BENGALURU URBAN,KARNATAKA,12.9,77.5",
      "bad,row,,,12345,,,,,,",
    ].join("\n");
    expect(parsePincodeCsv(csv)).toEqual([
      { pincode: "400001", city: "Mumbai", district: "Mumbai", state: "Maharashtra" },
      { pincode: "560001", city: "Bengaluru Urban", district: "Bengaluru Urban", state: "Karnataka" },
    ]);
  });
});

describe("one live entry per player per sport (SRS gap 6)", () => {
  it("blocks a second live entry but allows a new one after expiry", async () => {
    const db = handle.db;
    const [u] = await db.insert(users).values({ phone: "+919800000077" }).returning();
    const [p] = await db.insert(players).values({ userId: u.id, playerCode: "FPTEST01" }).returning();
    const [t] = await db
      .insert(tournaments)
      .values({ organiserUserId: u.id, slug: "gap-6", name: "Gap 6", startsAt: new Date("2026-11-01"), endsAt: new Date("2026-11-02") })
      .returning();
    const [e] = await db.insert(tournamentEvents).values({ tournamentId: t.id, sportId: "badminton", entryType: "individual" }).returning();
    const entry = { tournamentId: t.id, eventId: e.id, playerId: p.id, paymentStatus: "pending" as const };

    await db.insert(enrollments).values({ ...entry, registrationNo: "R1", status: "payment_pending" });
    await expect(db.insert(enrollments).values({ ...entry, registrationNo: "R2", status: "enrolled" })).rejects.toThrow();
    await db.update(enrollments).set({ status: "expired" }).where(eq(enrollments.registrationNo, "R1"));
    await db.insert(enrollments).values({ ...entry, registrationNo: "R3", status: "payment_pending" });
  });
});
