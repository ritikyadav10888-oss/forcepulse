import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pincodes } from "@force-pulse/db";
import { suggestedFields } from "@force-pulse/shared";
import { EventBus, type DomainEvent } from "../src/common/event-bus";
import { bearer, signIn, startHarness, type Harness } from "./harness";

let h: Harness;
const published: DomainEvent[] = [];
beforeAll(async () => {
  h = await startHarness();
  await h.db.db.insert(pincodes).values({ pincode: "400001", city: "Mumbai", district: "Mumbai", state: "Maharashtra" });
  const bus = h.app.get(EventBus);
  bus.on("RegistrationClosed", (e) => void published.push(e));
});
afterAll(() => h.close());

let n = 0;
const person = () => signIn(h, `96${String(10_000_000 + ++n).slice(-8)}`);
type Session = Awaited<ReturnType<typeof person>>;

const api = (s: Session | null) => ({
  get: (url: string) => (s ? h.http().get(`/api/v1${url}`).set(bearer(s.accessToken)) : h.http().get(`/api/v1${url}`)),
  post: (url: string, body: object = {}) => h.http().post(`/api/v1${url}`).set(bearer(s!.accessToken)).send(body),
  put: (url: string, body: object) => h.http().put(`/api/v1${url}`).set(bearer(s!.accessToken)).send(body),
  patch: (url: string, body: object) => h.http().patch(`/api/v1${url}`).set(bearer(s!.accessToken)).send(body),
});

/** A tournament open for registration, with the given sports. */
async function tournament(org: Session, events: object[], extra: object = {}) {
  const res = await api(org)
    .post("/tournaments", { name: "Mumbai Smash Open", city: "Mumbai", startsAt: "2026-11-01T03:30:00Z", endsAt: "2026-11-02T12:30:00Z", status: "enrollment_open", events, ...extra })
    .expect(201);
  return res.body as { id: string; slug: string; events: { id: string; categories: { id: string; name: string }[] }[]; organiserUserId: string };
}

const badminton = (o: object = {}) => ({ sportId: "badminton", entryType: "individual", ...o });
const u12Boys = { name: "U12 Boys", underAge: 12, ageOn: "2026-12-31", gender: "male" };

async function profile(s: Session, dob: string, gender: "male" | "female" = "male") {
  await api(s).patch("/me/player", { name: "Test Player", dob, gender }).expect(200);
}

describe("tournaments (FR-TRN-01, FR-AUTH-03)", () => {
  it("creating one makes the player an Organiser; drafts stay out of the public list", async () => {
    const org = await person();
    const draft = await api(org).post("/tournaments", { name: "Draft Cup", startsAt: "2026-11-01T03:30:00Z", endsAt: "2026-11-02T03:30:00Z", events: [badminton()] }).expect(201);
    expect(draft.body).toMatchObject({ status: "draft", registrationPath: expect.stringMatching(/^\/t\/draft-cup-[a-z0-9]{5}$/), isPaid: false });

    const roles = await api(org).get("/me/roles").expect(200);
    expect(roles.body.label).toBe("Player / Organiser");

    await api(null).get(`/tournaments/${draft.body.id}`).expect(404);
    expect((await api(null).get("/tournaments?q=Draft%20Cup")).body).toHaveLength(0);
    await api(org).put(`/tournaments/${draft.body.id}/status`, { status: "enrollment_open" }).expect(200);
    expect((await api(null).get("/tournaments?q=Draft%20Cup")).body).toHaveLength(1);
  });

  it("refuses bad setups with clear messages", async () => {
    const org = await person();
    const base = { name: "X", startsAt: "2026-11-02T00:00:00Z", endsAt: "2026-11-01T00:00:00Z", events: [badminton()] };
    expect((await api(org).post("/tournaments", base).expect(400)).body.message).toBe("End must be after start.");
    const twice = { ...base, endsAt: "2026-11-03T00:00:00Z", events: [badminton(), badminton()] };
    expect((await api(org).post("/tournaments", twice).expect(400)).body.message).toMatch(/added twice/);
    const ages = { ...base, endsAt: "2026-11-03T00:00:00Z", events: [badminton({ categories: [{ name: "A", minAge: 12, underAge: 10 }] })] };
    expect((await api(org).post("/tournaments", ages).expect(400)).body.message).toMatch(/minimum age must be below/);
  });

  it("only the organiser manages it, and status moves forward only", async () => {
    const org = await person();
    const other = await person();
    const t = await tournament(org, [badminton()]);
    await api(other).patch(`/tournaments/${t.id}`, { name: "Hijacked" }).expect(403);
    await api(org).put(`/tournaments/${t.id}/status`, { status: "live" }).expect(409);
    await api(org).put(`/tournaments/${t.id}/status`, { status: "enrollment_closed" }).expect(200);
    expect(published).toContainEqual(expect.objectContaining({ type: "RegistrationClosed", tournamentId: t.id }));
  });
});

describe("form builder and registration link (FR-REG-02 to 05, AC-01)", () => {
  it("serves the organiser's published form with nothing pre-filled, and fills city and state from the pincode", async () => {
    const org = await person();
    const t = await tournament(org, [badminton()], { status: "draft" });
    const fields = suggestedFields();
    await api(org).put(`/tournaments/${t.id}/form`, { fields }).expect(200);
    // A form with a draft but nothing published can't open.
    await api(org).put(`/tournaments/${t.id}/status`, { status: "enrollment_open" }).expect(409);
    const pub = await api(org).post(`/tournaments/${t.id}/form/publish`).expect(200);
    expect(pub.body.publishedVersion).toBe(1);
    await api(org).put(`/tournaments/${t.id}/status`, { status: "enrollment_open" }).expect(200);

    const page = await api(null).get(`/t/${t.slug}`).expect(200);
    expect(page.body.form.fields).toEqual(fields);
    expect(JSON.stringify(page.body.form)).not.toMatch(/"value"|"default"/);

    expect((await api(null).get("/pincodes/400001").expect(200)).body).toMatchObject({ city: "Mumbai", state: "Maharashtra" });
    await api(null).get("/pincodes/012345").expect(400);

    const player = await person();
    const answers = { full_name: "Ravi Kumar", gender: "Male", dob: "2000-04-04", mobile: "9876500000", pincode: "400001" };
    await api(player).post(`/tournaments/${t.id}/registrations`, { entries: [{ eventId: t.events[0].id }], answers }).expect(201);
    const me = await api(player).get("/me/player").expect(200);
    expect(me.body).toMatchObject({ name: "Ravi Kumar", gender: "male", dob: "2000-04-04", pincode: "400001", city: "Mumbai", state: "Maharashtra" });
  });

  it("lists every bad answer by field", async () => {
    const org = await person();
    const t = await tournament(org, [badminton()], { status: "draft" });
    await api(org).put(`/tournaments/${t.id}/form`, { fields: suggestedFields() }).expect(200);
    await api(org).post(`/tournaments/${t.id}/form/publish`).expect(200);
    await api(org).put(`/tournaments/${t.id}/status`, { status: "enrollment_open" }).expect(200);
    const res = await api(await person()).post(`/tournaments/${t.id}/registrations`, { entries: [{ eventId: t.events[0].id }], answers: { pincode: "12" } }).expect(400);
    expect(Object.keys(res.body.details.fields).sort()).toEqual(["dob", "full_name", "gender", "mobile", "pincode"]);
  });

  it("refuses a broken form definition", async () => {
    const org = await person();
    const t = await tournament(org, [badminton()]);
    const res = await api(org).put(`/tournaments/${t.id}/form`, { fields: [{ key: "x", label: "X", type: "select", required: true }] }).expect(400);
    expect(res.body.message).toMatch(/at least one option/);
  });
});

describe("individual registration (FR-REG-08 to 11, FR-REG-15)", () => {
  it("enrols at once when free, and a second submit returns the same entry", async () => {
    const org = await person();
    const t = await tournament(org, [badminton(), { sportId: "table-tennis", entryType: "individual" }]);
    const p = await person();
    const body = { entries: [{ eventId: t.events[0].id }, { eventId: t.events[1].id }] };
    const first = await api(p).post(`/tournaments/${t.id}/registrations`, body).expect(201);
    expect(first.body.enrollments.map((e: { status: string }) => e.status)).toEqual(["enrolled", "enrolled"]);
    expect(first.body.enrollments[0].registrationNo).toMatch(/^FPR-[2-9A-Z]{8}$/);
    const again = await api(p).post(`/tournaments/${t.id}/registrations`, body).expect(201);
    expect(again.body.enrollments.map((e: { id: string }) => e.id)).toEqual(first.body.enrollments.map((e: { id: string }) => e.id));
  });

  it("checks the category's age and gender rules (FR-REG-09)", async () => {
    const org = await person();
    const t = await tournament(org, [badminton({ categories: [u12Boys] })]);
    const ev = t.events[0];
    const older = await person();
    await profile(older, "2014-06-01");
    const res = await api(older).post(`/tournaments/${t.id}/registrations`, { entries: [{ eventId: ev.id, categoryId: ev.categories[0].id }] }).expect(400);
    expect(res.body.message).toBe("Not eligible for U12 Boys: Under 12 only (age on 2026-12-31)");
  });

  it("needs a guardian for players under 18", async () => {
    const org = await person();
    const t = await tournament(org, [badminton({ categories: [u12Boys] })]);
    const ev = t.events[0];
    const kid = await person();
    await profile(kid, "2016-02-02");
    const entry = { entries: [{ eventId: ev.id, categoryId: ev.categories[0].id }] };
    expect((await api(kid).post(`/tournaments/${t.id}/registrations`, entry).expect(400)).body.message).toMatch(/guardian/);
    const ok = await api(kid).post(`/tournaments/${t.id}/registrations`, { ...entry, guardian: { name: "Parent", phone: "9811111111" } }).expect(201);
    expect(ok.body.enrollments[0].guardian).toMatchObject({ name: "Parent", phone: "+919811111111" });
  });

  it("waitlists when full and promotes the first in line when a place frees up", async () => {
    const org = await person();
    const t = await tournament(org, [badminton({ maxTeams: 2 })]);
    const reg = (s: Session) => api(s).post(`/tournaments/${t.id}/registrations`, { entries: [{ eventId: t.events[0].id }] }).expect(201);
    const [a, b, c] = [await person(), await person(), await person()];
    const ea = (await reg(a)).body.enrollments[0];
    await reg(b);
    const ec = (await reg(c)).body.enrollments[0];
    expect(ec.status).toBe("waitlisted");

    await api(org).post(`/enrollments/${ea.id}/remove`, { reason: "withdrew" }).expect(200);
    const list = await api(org).get(`/tournaments/${t.id}/enrollments`).expect(200);
    expect(list.body.find((e: { id: string }) => e.id === ec.id).status).toBe("enrolled");
  });
});

describe("Review add-on (FR-REG-12, AC-05)", () => {
  it("without it entries enrol at once and review actions are refused", async () => {
    const org = await person();
    const t = await tournament(org, [badminton()]);
    const e = (await api(await person()).post(`/tournaments/${t.id}/registrations`, { entries: [{ eventId: t.events[0].id }] })).body.enrollments[0];
    expect(e.status).toBe("enrolled");
    await api(org).post(`/enrollments/${e.id}/review`, { action: "approve" }).expect(409);
  });

  it("with it entries wait; the organiser approves, rejects with a reason, or waitlists", async () => {
    const org = await person();
    const t = await tournament(org, [badminton()], { reviewRequired: true });
    const reg = async () => (await api(await person()).post(`/tournaments/${t.id}/registrations`, { entries: [{ eventId: t.events[0].id }] }).expect(201)).body.enrollments[0];
    const [a, b, c] = [await reg(), await reg(), await reg()];
    expect(a.status).toBe("pending_review");

    expect((await api(org).post(`/enrollments/${a.id}/review`, { action: "approve" }).expect(200)).body.status).toBe("enrolled");
    await api(org).post(`/enrollments/${b.id}/review`, { action: "reject" }).expect(400);
    expect((await api(org).post(`/enrollments/${b.id}/review`, { action: "reject", reason: "Not a club member" }).expect(200)).body).toMatchObject({
      status: "rejected",
      reviewNote: "Not a club member",
    });
    expect((await api(org).post(`/enrollments/${c.id}/review`, { action: "waitlist" }).expect(200)).body.status).toBe("waitlisted");
  });
});

describe("paid entries hold a place for 30 minutes (FR-PAY-07, AC-03)", () => {
  it("holds, then releases the place and lets the player try again", async () => {
    const org = await person();
    const t = await tournament(org, [badminton({ maxTeams: 2, feePaise: 100_000 })]);
    expect((await api(null).get(`/tournaments/${t.id}`)).body.isPaid).toBe(true);
    const [a, b, c] = [await person(), await person(), await person()];
    const reg = (s: Session) => api(s).post(`/tournaments/${t.id}/registrations`, { entries: [{ eventId: t.events[0].id }] }).expect(201);

    const first = await reg(a);
    expect(first.body).toMatchObject({ amountDuePaise: 100_000, holdExpiresAt: "2026-10-09T10:30:00.000Z" });
    expect(first.body.enrollments[0]).toMatchObject({ status: "payment_pending", paymentStatus: "pending", feePaise: 100_000 });
    await reg(b);
    expect((await reg(c)).body.enrollments[0].status).toBe("waitlisted");

    h.clock.advance(30 * 60);
    const mine = await api(a).get("/me/enrollments").expect(200);
    expect(mine.body[0].status).toBe("expired");
    const retry = await reg(a);
    expect(retry.body.enrollments[0].status).toBe("payment_pending");
  });
});

describe("teams and team codes (FR-REG-07)", () => {
  const football = (o: object = {}) => ({ sportId: "football", entryType: "team", maxPlayersPerTeam: 3, ...o });

  it("captain registers, team-mates join with the code until the squad is full", async () => {
    const org = await person();
    const t = await tournament(org, [football()]);
    const captain = await person();
    const res = await api(captain).post(`/tournaments/${t.id}/events/${t.events[0].id}/teams`, { teamName: "Thunder FC" }).expect(201);
    expect(res.body.team).toMatchObject({ name: "Thunder FC", status: "confirmed", players: 1, code: expect.stringMatching(/^[2-9A-Z]{6}$/) });
    const code = res.body.team.code;

    expect((await api(null).get(`/teams/code/${code.toLowerCase()}`).expect(200)).body.name).toBe("Thunder FC");
    await api(await person()).post("/teams/join", { code }).expect(201);
    await api(await person()).post("/teams/join", { code }).expect(201);
    expect((await api(await person()).post("/teams/join", { code }).expect(409)).body.message).toMatch(/maximum of 3/);

    await api(await person()).post(`/tournaments/${t.id}/events/${t.events[0].id}/teams`, { teamName: "thunder fc" }).expect(409);
    await api(await person()).post(`/tournaments/${t.id}/registrations`, { entries: [{ eventId: t.events[0].id }] }).expect(400);
  });

  it("a paid team waits for the captain's payment before anyone can join; the captain pays once (FR-PAY-02)", async () => {
    const org = await person();
    const t = await tournament(org, [football({ feePaise: 500_000 })]);
    const res = await api(await person()).post(`/tournaments/${t.id}/events/${t.events[0].id}/teams`, { teamName: "Paid XI" }).expect(201);
    expect(res.body).toMatchObject({ amountDuePaise: 500_000, team: { status: "pending" } });
    expect((await api(await person()).post("/teams/join", { code: res.body.team.code }).expect(409)).body.message).toMatch(/complete payment/);
  });

  it("removing the captain takes the team and its members out", async () => {
    const org = await person();
    const t = await tournament(org, [football()]);
    const res = await api(await person()).post(`/tournaments/${t.id}/events/${t.events[0].id}/teams`, { teamName: "Short Lived" }).expect(201);
    const member = await person();
    await api(member).post("/teams/join", { code: res.body.team.code }).expect(201);
    await api(org).post(`/enrollments/${res.body.enrollments[0].id}/remove`, {}).expect(200);
    expect((await api(member).get("/me/enrollments")).body[0].status).toBe("removed");
    await api(null).get(`/teams/code/${res.body.team.code}`).expect(404);
  });
});

describe("private tournaments", () => {
  it("link mode needs the code, and counts its uses", async () => {
    const org = await person();
    const t = await tournament(org, [badminton()], { visibility: "private" });
    const link = (await api(org).get(`/tournaments/${t.id}/invite-link`).expect(200)).body;
    const body = { entries: [{ eventId: t.events[0].id }] };
    await api(await person()).post(`/tournaments/${t.id}/registrations`, body).expect(403);
    await api(await person()).post(`/tournaments/${t.id}/registrations`, { ...body, inviteCode: link.code.toLowerCase() }).expect(201);
    expect((await api(org).get(`/tournaments/${t.id}/invite-link`)).body.uses).toBe(1);
    expect((await api(null).get("/tournaments?q=Mumbai")).body.some((x: { id: string }) => x.id === t.id)).toBe(false);
  });

  it("list mode admits only invited numbers", async () => {
    const org = await person();
    const t = await tournament(org, [badminton()], { visibility: "private", inviteMode: "list" });
    const invited = await signIn(h, "9555500001");
    await api(org).post(`/tournaments/${t.id}/invites`, { phone: "95555 00001", name: "Invited" }).expect(201);
    const body = { entries: [{ eventId: t.events[0].id }] };
    await api(invited).post(`/tournaments/${t.id}/registrations`, body).expect(201);
    expect((await api(await person()).post(`/tournaments/${t.id}/registrations`, body).expect(403)).body.message).toMatch(/list/);
  });
});

describe("uploads and age proof (FR-REG-06)", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

  it("needs a proof where the category asks for it; only the owner and organiser can open it", async () => {
    const org = await person();
    const t = await tournament(org, [badminton({ categories: [{ name: "Open", proofRequired: true }] })]);
    const ev = t.events[0];
    const p = await person();
    const body = { entries: [{ eventId: ev.id, categoryId: ev.categories[0].id }] };
    await api(p).post(`/tournaments/${t.id}/registrations`, body).expect(400);

    const up = await h.http().post("/api/v1/uploads").set(bearer(p.accessToken)).field("kind", "proof").attach("file", png, "proof.png").expect(201);
    expect(up.body).toMatchObject({ mime: "image/png", key: expect.stringMatching(/^upl_[a-z0-9]{24}$/) });
    await api(p).post(`/tournaments/${t.id}/registrations`, { ...body, proofKey: up.body.key }).expect(201);

    await api(p).get(`/uploads/${up.body.key}`).expect(200);
    await api(org).get(`/uploads/${up.body.key}`).expect(200);
    await api(await person()).get(`/uploads/${up.body.key}`).expect(404);
    await api(null).get(`/uploads/${up.body.key}`).expect(404);
  });

  it("refuses files that aren't the allowed types, whatever their name says", async () => {
    const p = await person();
    const res = await h.http().post("/api/v1/uploads").set(bearer(p.accessToken)).field("kind", "photo").attach("file", Buffer.from("<svg onload=alert(1)>"), "x.png").expect(400);
    expect(res.body.message).toMatch(/JPG, PNG, WEBP/);
  });

  it("won't attach someone else's upload", async () => {
    const org = await person();
    const t = await tournament(org, [badminton({ categories: [{ name: "Open", proofRequired: true }] })]);
    const ev = t.events[0];
    const owner = await person();
    const up = await h.http().post("/api/v1/uploads").set(bearer(owner.accessToken)).field("kind", "proof").attach("file", png, "p.png").expect(201);
    await api(await person()).post(`/tournaments/${t.id}/registrations`, { entries: [{ eventId: ev.id, categoryId: ev.categories[0].id }], proofKey: up.body.key }).expect(400);
  });
});

describe("organiser export (FR-REG-17)", () => {
  it("exports registrations as CSV, defusing spreadsheet formulas", async () => {
    const org = await person();
    const t = await tournament(org, [badminton()]);
    const p = await person();
    await api(p).patch("/me/player", { name: "=HYPERLINK(evil)" }).expect(200);
    await api(p).post(`/tournaments/${t.id}/registrations`, { entries: [{ eventId: t.events[0].id }] }).expect(201);
    const res = await api(org).get(`/tournaments/${t.id}/enrollments.csv`).expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    const lines = res.text.trim().split("\r\n");
    expect(lines[0]).toMatch(/^Registration no,Status,Payment,Sport/);
    expect(lines[1]).toContain("'=HYPERLINK(evil)");
    await api(p).get(`/tournaments/${t.id}/enrollments.csv`).expect(403);
  });
});
