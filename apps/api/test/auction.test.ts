import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, signIn, staffSignIn, startHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

let n = 0;
const phoneOf = () => `89${String(10_000_000 + ++n).slice(-8)}`;
type Session = Awaited<ReturnType<typeof signIn>>;
const as = (s: Session) => ({
  get: (url: string) => h.http().get(`/api/v1${url}`).set(bearer(s.accessToken)),
  post: (url: string, body: object = {}) => h.http().post(`/api/v1${url}`).set(bearer(s.accessToken)).send(body),
  put: (url: string, body: object) => h.http().put(`/api/v1${url}`).set(bearer(s.accessToken)).send(body),
  patch: (url: string, body: object) => h.http().patch(`/api/v1${url}`).set(bearer(s.accessToken)).send(body),
});
const webhook = (w: { body: string; signature: string }) =>
  h.http().post("/api/v1/payments/webhook").set("Content-Type", "application/json").set("X-Razorpay-Signature", w.signature).send(w.body).expect(200);

/** A cricket tournament where players register alone for an auction; `count` players in the pool. */
async function pooledTournament(count: number) {
  const org = await signIn(h, phoneOf());
  const t = (
    await as(org)
      .post("/tournaments", { name: "Auction League", startsAt: "2026-11-20T03:30:00Z", endsAt: "2026-11-25T03:30:00Z", status: "enrollment_open", events: [{ sportId: "cricket", entryType: "pooled", poolFormation: "auction" }] })
      .expect(201)
  ).body;
  const players: Session[] = [];
  for (let i = 0; i < count; i++) {
    const p = await signIn(h, phoneOf());
    await as(p).patch("/me/player", { name: `Pool ${i + 1}` }).expect(200);
    await as(p).post(`/tournaments/${t.id}/registrations`, { entries: [{ eventId: t.events[0].id }] }).expect(201);
    players.push(p);
  }
  const auction = (await as(org).post(`/tournaments/${t.id}/auctions`, { eventId: t.events[0].id }).expect(201)).body;
  return { org, t, players, auction };
}

describe("auction plans (FR-AUC-21 to 24, FR-PAY-16, AC-11)", () => {
  it("a plan is bought through Razorpay; the 9th team on an 8-team plan is refused with the upgrade price; upgrading pays the difference", async () => {
    const { org, auction } = await pooledTournament(0);
    expect(auction.status).toBe("locked");
    expect((await as(org).post(`/auctions/${auction.id}/teams`, { name: "Early" }).expect(409)).body.message).toMatch(/Buy a plan/);
    expect((await as(org).post(`/auctions/${auction.id}/plan`, { planId: "standard" }).expect(503)).body.message).toMatch(/isn't on sale yet/);

    const admin = await staffSignIn(h);
    await as(admin).put("/admin/auction-plans/standard", { pricePaise: 300_000 }).expect(200);
    await as(admin).put("/admin/auction-plans/pro", { pricePaise: 500_000 }).expect(200);
    await as(org).put("/admin/auction-plans/pro", { pricePaise: 1 }).expect(403);

    const order = await as(org).post(`/auctions/${auction.id}/plan`, { planId: "standard" }).expect(201);
    expect(order.body).toMatchObject({ amountPaise: 300_000, plan: { maxTeams: 8 } });
    await webhook(h.gateway.pay(order.body.razorpayOrderId).webhook);
    const unlocked = (await h.http().get(`/api/v1/auctions/${auction.id}`).expect(200)).body;
    expect(unlocked).toMatchObject({ status: "setup", planId: "standard", maxTeams: 8 });

    for (let i = 1; i <= 8; i++) await as(org).post(`/auctions/${auction.id}/teams`, { name: `Team ${i}` }).expect(201);
    const ninth = await as(org).post(`/auctions/${auction.id}/teams`, { name: "Team 9" }).expect(409);
    expect(ninth.body).toMatchObject({ code: "PLAN_LIMIT_REACHED", details: { maxTeams: 8, upgrade: { planId: "pro", maxTeams: 16, pricePaise: 200_000 } } });

    const upgrade = await as(org).post(`/auctions/${auction.id}/plan`, { planId: "pro" }).expect(201);
    expect(upgrade.body.amountPaise).toBe(200_000);
    await webhook(h.gateway.pay(upgrade.body.razorpayOrderId).webhook);
    await as(org).post(`/auctions/${auction.id}/teams`, { name: "Team 9" }).expect(201);

    const money = (await as(admin).get("/admin/finance").expect(200)).body;
    expect(money.auctionPlanRevenuePaise).toBeGreaterThanOrEqual(500_000);
  });
});

describe("live auction (FR-AUC-09 to 20, AC-10)", () => {
  it("owners bid by the slab rules, the timer sells, unsold players go round again, and sold players join their teams", async () => {
    const { org, t, players, auction } = await pooledTournament(4);
    const admin = await staffSignIn(h);
    await as(admin).post(`/admin/auctions/${auction.id}/plan`, { planId: "starter" }).expect(200);

    const [ownerA, ownerB] = [await signIn(h, phoneOf()), await signIn(h, phoneOf())];
    await as(org)
      .put(`/auctions/${auction.id}/config`, {
        purse: 50_000,
        minSquad: 2,
        maxSquad: 3,
        timerSeconds: 30,
        slabs: [{ from: 0, raise: 1_000 }, { from: 20_000, raise: 2_000 }],
        categories: [{ name: "Gold", basePoints: 10_000, quotaPerTeam: 1 }, { name: "Silver", basePoints: 5_000 }],
      })
      .expect(200);
    const teamA = (await as(org).post(`/auctions/${auction.id}/teams`, { name: "Strikers", ownerPhone: ownerA.user.phone }).expect(201)).body.teams[0];
    const teamB = (await as(org).post(`/auctions/${auction.id}/teams`, { name: "Titans", ownerPhone: ownerB.user.phone }).expect(201)).body.teams.find((x: { name: string }) => x.name === "Titans");
    expect((await as(ownerA).get("/me/roles")).body.roles).toContain("team_owner");

    const pool = (await as(org).get(`/auctions/${auction.id}/pool`).expect(200)).body as { playerId: string; name: string }[];
    expect(pool).toHaveLength(4);
    const [gold, silver] = (await h.http().get(`/api/v1/auctions/${auction.id}`)).body.categories;
    const byName = (name: string) => pool.find((p) => p.name === name)!.playerId;
    await as(org)
      .put(`/auctions/${auction.id}/lots`, {
        lots: [
          { playerId: byName("Pool 1"), categoryId: gold.id },
          { playerId: byName("Pool 2"), categoryId: gold.id },
          { playerId: byName("Pool 3"), categoryId: silver.id },
          { playerId: byName("Pool 4"), categoryId: silver.id },
        ],
      })
      .expect(200);
    await as(org).post(`/auctions/${auction.id}/start`).expect(200);

    // Lot 1 (Gold): base 10,000, then +1,000 per bid; the same team can't bid twice in a row.
    let state = (await as(org).post(`/auctions/${auction.id}/next`).expect(200)).body;
    expect(state.current).toMatchObject({ name: "Pool 1", category: "Gold", basePoints: 10_000 });
    expect((await as(ownerA).post(`/auctions/${auction.id}/bid`, { teamId: teamA.id }).expect(200)).body.accepted).toBe(10_000);
    await as(ownerA).post(`/auctions/${auction.id}/bid`, { teamId: teamA.id }).expect(409);
    await as(ownerA).post(`/auctions/${auction.id}/bid`, { teamId: teamB.id }).expect(403); // not their team
    expect((await as(ownerB).post(`/auctions/${auction.id}/bid`, { teamId: teamB.id }).expect(200)).body.accepted).toBe(11_000);
    expect((await as(ownerA).post(`/auctions/${auction.id}/bid`, { teamId: teamA.id }).expect(200)).body.accepted).toBe(12_000);

    h.clock.advance(31);
    state = (await h.http().get(`/api/v1/auctions/${auction.id}`)).body;
    expect(state.lots[0]).toMatchObject({ status: "sold", soldTeamId: teamA.id, soldPoints: 12_000 });
    expect(state.teams.find((x: { id: string }) => x.id === teamA.id)).toMatchObject({ pointsLeft: 38_000, players: 1, slotsLeft: 2 });

    // Lot 2 (Gold): team A has its one Gold player, so it can't bid; B gets it at base.
    await as(org).post(`/auctions/${auction.id}/next`).expect(200);
    expect((await as(ownerA).post(`/auctions/${auction.id}/bid`, { teamId: teamA.id }).expect(409)).body.message).toMatch(/quota/);
    await as(ownerB).post(`/auctions/${auction.id}/bid`, { teamId: teamB.id }).expect(200);
    h.clock.advance(31);
    // A bid after the timer is refused, and the sale stands.
    expect((await as(ownerA).post(`/auctions/${auction.id}/bid`, { teamId: teamA.id }).expect(409)).body.message).toMatch(/Time ran out/);
    expect((await h.http().get(`/api/v1/auctions/${auction.id}`)).body.lots[1]).toMatchObject({ status: "sold", soldTeamId: teamB.id });

    // Lot 3 (Silver): no bids → unsold; it goes round again (FR-AUC-15, FR-AUC-25).
    await as(org).post(`/auctions/${auction.id}/next`).expect(200);
    h.clock.advance(31);
    expect((await h.http().get(`/api/v1/auctions/${auction.id}`)).body.lots[2].status).toBe("unsold");
    await as(org).post(`/auctions/${auction.id}/reauction`).expect(200);
    state = (await as(org).post(`/auctions/${auction.id}/next`, { lotId: state.lots[2].lotId }).expect(200)).body;
    expect(state.current).toMatchObject({ name: "Pool 3", round: 2 });

    // A floor bid by the auctioneer (FR-AUC-16); pausing keeps the time left (FR-AUC-15).
    await as(org).post(`/auctions/${auction.id}/bid`, { teamId: teamA.id, floor: true }).expect(200);
    await as(ownerA).post(`/auctions/${auction.id}/bid`, { teamId: teamB.id, floor: true }).expect(403);
    h.clock.advance(10);
    await as(org).post(`/auctions/${auction.id}/pause`).expect(200);
    h.clock.advance(120);
    expect((await h.http().get(`/api/v1/auctions/${auction.id}`)).body.lots[2].status).toBe("live"); // the clock stopped
    await as(org).post(`/auctions/${auction.id}/resume`).expect(200);
    h.clock.advance(21);
    expect((await h.http().get(`/api/v1/auctions/${auction.id}`)).body.lots[2]).toMatchObject({ status: "sold", soldTeamId: teamA.id, soldPoints: 5_000 });

    // Undo the last sale with a reason; the player is back in the pool.
    await as(org).post(`/auctions/${auction.id}/undo`, { reason: "Wrong team tapped" }).expect(200);
    expect((await h.http().get(`/api/v1/auctions/${auction.id}`)).body.lots[2].status).toBe("upcoming");

    // Close: sold players are enrolled under their buying teams (AC-10).
    await as(org).post(`/auctions/${auction.id}/close`).expect(200);
    const mine = (await as(players[0]).get("/me/enrollments")).body[0];
    expect(mine).toMatchObject({ joinedVia: "auction", isCaptain: true, teamId: expect.any(String) });
    const entries = (await as(org).get(`/tournaments/${t.id}/enrollments`)).body as { playerId: string; teamId: string | null; player: { teamName: string | null } }[];
    expect(entries.map((e) => e.player.teamName).sort()).toEqual(["Strikers", "Titans", null, null].sort());

    const csv = (await as(org).get(`/auctions/${auction.id}/export.csv`).expect(200)).text;
    expect(csv).toContain('"Pool 1","Gold","sold","Strikers","12000"');
  });
});
