import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, signIn, staffSignIn, startHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

describe("site pages and contact (FR-ABT-01/02)", () => {
  it("serves the seeded pages, lets staff edit them, and refuses players", async () => {
    const list = (await h.http().get("/api/v1/pages").expect(200)).body.map((p: { slug: string }) => p.slug).sort();
    expect(list).toEqual(["about", "faq", "partners", "privacy", "refunds", "sports", "terms"]);
    expect((await h.http().get("/api/v1/pages/refunds").expect(200)).body.body).toMatch(/3% platform fee/);

    const admin = await staffSignIn(h);
    await h.http().put("/api/v1/admin/pages/about").set(bearer(admin.accessToken)).send({ title: "About us", body: "New text" }).expect(200);
    expect((await h.http().get("/api/v1/pages/about")).body).toMatchObject({ title: "About us", body: "New text" });

    const player = await signIn(h, "9500000001");
    await h.http().put("/api/v1/admin/pages/about").set(bearer(player.accessToken)).send({ title: "x", body: "y" }).expect(403);
  });

  it("stores contact messages for staff, with a per-address limit", async () => {
    const send = () => h.http().post("/api/v1/contact").set("X-Forwarded-For", "198.51.100.9").send({ name: "Ravi", contact: "ravi@example.com", message: "Hello there" });
    for (let i = 0; i < 5; i++) await send().expect(201);
    await send().expect(429);
    const admin = await staffSignIn(h);
    const msgs = (await h.http().get("/api/v1/admin/contact-messages").set(bearer(admin.accessToken)).expect(200)).body;
    expect(msgs).toHaveLength(5);
    await h.http().post(`/api/v1/admin/contact-messages/${msgs[0].id}/handled`).set(bearer(admin.accessToken)).expect(204);
    expect((await h.http().get("/api/v1/admin/contact-messages").set(bearer(admin.accessToken))).body).toHaveLength(4);
  });
});

describe("privacy rights (NFR-10, DPDP Act 2023)", () => {
  it("a player downloads their data, asks for deletion, and staff anonymise the account", async () => {
    const p = await signIn(h, "9500000002");
    await h.http().patch("/api/v1/me/player").set(bearer(p.accessToken)).send({ name: "Meera Shah", dob: "1999-01-01", pincode: "400001" }).expect(200);
    const data = (await h.http().get("/api/v1/me/data").set(bearer(p.accessToken)).expect(200)).body;
    expect(data).toMatchObject({ user: { phone: "+919500000002" }, player: { name: "Meera Shah", dob: "1999-01-01" } });

    const req = (await h.http().post("/api/v1/me/deletion-request").set(bearer(p.accessToken)).send({ reason: "Not playing any more" }).expect(201)).body;
    // Asking twice keeps one open request.
    expect((await h.http().post("/api/v1/me/deletion-request").set(bearer(p.accessToken)).send({})).body.id).toBe(req.id);

    const admin = await staffSignIn(h);
    expect((await h.http().get("/api/v1/admin/privacy-requests").set(bearer(admin.accessToken))).body).toEqual([expect.objectContaining({ id: req.id, name: "Meera Shah" })]);
    await h.http().post(`/api/v1/admin/privacy-requests/${req.id}/complete`).set(bearer(admin.accessToken)).expect(200);

    // Signed out everywhere; the public profile no longer names them.
    await h.http().get("/api/v1/me").set(bearer(p.accessToken)).expect(401);
    const profile = (await h.http().get(`/api/v1/players/${data.player.id}`)).body;
    expect(profile).toMatchObject({ name: "Deleted player", city: "" });
    // The number is free again: signing in with it makes a brand-new account.
    const again = await signIn(h, "9500000002");
    expect(again.isNewUser).toBe(true);
    await h.http().post(`/api/v1/admin/privacy-requests/${req.id}/complete`).set(bearer(admin.accessToken)).expect(404);
  });
});
