import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ModulesContainer, Reflector } from "@nestjs/core";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { POLICY_KEY } from "../src/common/policy";
import { bearer, signIn, staffSignIn, startHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

describe("policy layer (FR-AUTH-06)", () => {
  it("every route declares an access policy", () => {
    const reflector = h.app.get(Reflector);
    const missing: string[] = [];
    let routes = 0;
    for (const mod of h.app.get(ModulesContainer).values()) {
      for (const wrapper of mod.controllers.values()) {
        const proto = (wrapper.metatype as { prototype: object } | null)?.prototype;
        if (!proto) continue;
        for (const name of Object.getOwnPropertyNames(proto)) {
          const handler = (proto as Record<string, unknown>)[name];
          if (name === "constructor" || typeof handler !== "function") continue;
          if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
          routes++;
          const policy = reflector.getAllAndOverride(POLICY_KEY, [handler, wrapper.metatype as object]);
          if (!policy) missing.push(`${wrapper.name}.${name} (${Reflect.getMetadata(PATH_METADATA, handler)})`);
        }
      }
    }
    expect(routes).toBeGreaterThan(15);
    expect(missing).toEqual([]);
  });

  it("answers health checks without a token", async () => {
    expect((await h.http().get("/api/v1/health").expect(200)).body).toEqual({ status: "ok" });
  });

  it("returns { code, message } for unknown routes", async () => {
    expect((await h.http().get("/api/v1/nope").expect(404)).body).toEqual({ code: "NOT_FOUND", message: "Not found." });
  });
});

describe("player profile (FR-PRO-06, FR-PRO-07)", () => {
  it("lets a player edit basic details and hides private fields from others", async () => {
    const owner = await signIn(h, "9711100001");
    const patched = await h
      .http()
      .patch("/api/v1/me/player")
      .set(bearer(owner.accessToken))
      .send({ name: "Asha Rao", gender: "female", dob: "2001-05-20", pincode: "400001", city: "Mumbai", state: "Maharashtra" })
      .expect(200);
    expect(patched.body).toMatchObject({ name: "Asha Rao", dob: "2001-05-20", age: 25, pincode: "400001" });

    const id = patched.body.id;
    const anonymous = await h.http().get(`/api/v1/players/${id}`).expect(200);
    expect(anonymous.body).toMatchObject({ name: "Asha Rao", age: 25, dob: null, pincode: null, city: "Mumbai" });
    expect(anonymous.body).not.toHaveProperty("phone");

    const other = await signIn(h, "9711100002");
    expect((await h.http().get(`/api/v1/players/${id}`).set(bearer(other.accessToken))).body.dob).toBeNull();
    expect((await h.http().get(`/api/v1/players/${id}`).set(bearer(owner.accessToken))).body.dob).toBe("2001-05-20");
  });

  it("refuses fields players may not edit, and bad values", async () => {
    const s = await signIn(h, "9711100003");
    expect((await h.http().patch("/api/v1/me/player").set(bearer(s.accessToken)).send({ suspended: false }).expect(400)).body.code).toBe("BAD_REQUEST");
    await h.http().patch("/api/v1/me/player").set(bearer(s.accessToken)).send({ pincode: "012345" }).expect(400);
    await h.http().patch("/api/v1/me/player").set(bearer(s.accessToken)).send({ dob: "2025-01-01" }).expect(400);
  });

  it("saves a sport profile only with a role that sport has", async () => {
    const s = await signIn(h, "9711100004");
    await h.http().put("/api/v1/me/player/sports/cricket").set(bearer(s.accessToken)).send({ playingRole: "Goalkeeper" }).expect(400);
    await h.http().put("/api/v1/me/player/sports/cricket").set(bearer(s.accessToken)).send({ playingRole: "Bowler", skillLevel: "club" }).expect(200);
    const me = await h.http().get("/api/v1/me/player").set(bearer(s.accessToken));
    const sports = await h.http().get(`/api/v1/players/${me.body.id}/sports`).expect(200);
    expect(sports.body).toEqual([{ playerId: me.body.id, sportId: "cricket", playingRole: "Bowler", skillLevel: "club" }]);
  });
});

describe("sports and fee settings (FR-ADM-01, FR-ADM-03)", () => {
  it("lists the seeded sports publicly", async () => {
    const res = await h.http().get("/api/v1/sports").expect(200);
    expect(res.body).toHaveLength(16);
  });

  it("lets only a super admin change fees, and logs the change", async () => {
    const admin = await staffSignIn(h);
    const player = await signIn(h, "9711100005");
    const fees = { platformFeeBps: 300, convenienceFeePaidByPlayer: true, gstBps: 0 };
    expect((await h.http().get("/api/v1/admin/settings/fees").set(bearer(admin.accessToken)).expect(200)).body).toEqual(fees);

    await h.http().put("/api/v1/admin/settings/fees").set(bearer(player.accessToken)).send({ ...fees, platformFeeBps: 0 }).expect(403);
    await h.http().put("/api/v1/admin/settings/fees").set(bearer(admin.accessToken)).send({ ...fees, platformFeeBps: 250 }).expect(200);

    const log = await h.http().get("/api/v1/admin/audit-logs?entity=fee_settings").set(bearer(admin.accessToken)).expect(200);
    expect(log.body[0]).toMatchObject({ action: "update", before: fees, after: { ...fees, platformFeeBps: 250 }, userId: admin.user.id });
  });
});
