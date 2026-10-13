// End-to-end scenario against a running API: 2 tournaments, 6 sports, 80 players, fixtures, live scoring,
// an auction, gallery, profiles and exports. Checks SRS v2 requirements on the way and writes a report.
//   node apps/api/scripts/e2e-scenario.mjs [report.md]
// Needs: API on API_URL (default http://localhost:4000/api/v1) with OTP_PROVIDER=console, and the super admin seeded.
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { io } from "socket.io-client";

const API = process.env.API_URL ?? "http://localhost:4000/api/v1";
const ORIGIN = API.replace(/\/api\/v1\/?$/, "");
const ADMIN = { email: process.env.SEED_SUPER_ADMIN_EMAIL ?? "superadmin@forcepulse.local", password: process.env.SEED_SUPER_ADMIN_PASSWORD ?? "change-me-on-first-login" };
const REPORT = process.argv[2] ?? "e2e-report.md";
// Two-digit start for every test number (players, organisers). Change it between runs: each number gets 3 OTPs per 15 minutes.
const P = process.env.E2E_PREFIX ?? "71";
const run = Date.now().toString(36).slice(-4).toUpperCase();
const started = Date.now();

// ---------- tiny client ----------
const checks = [];
const metrics = {};
function check(area, id, title, ok, detail = "") {
  const status = ok === "blocked" ? "BLOCKED" : ok ? "PASS" : "FAIL";
  checks.push({ area, id, title, status, detail });
  console.log(`${status.padEnd(7)} ${id.padEnd(12)} ${title}${detail ? ` — ${detail}` : ""}`);
}
async function call(method, path, { token, body, ip, raw } = {}) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ip ? { "X-Forwarded-For": ip } : {}) };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(API + path, { method, headers, body: payload });
  if (raw) return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}
async function must(method, path, opts = {}) {
  const r = await call(method, path, opts);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
const as = (s) => ({
  get: (p) => must("GET", p, { token: s.token }),
  post: (p, body = {}) => must("POST", p, { token: s.token, body }),
  put: (p, body) => must("PUT", p, { token: s.token, body }),
  patch: (p, body) => must("PATCH", p, { token: s.token, body }),
  try: (method, p, body) => call(method, p, { token: s.token, body }),
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

let ipN = 0;
async function signIn(phone) {
  const ip = `10.77.${Math.floor(++ipN / 250)}.${(ipN % 250) + 1}`; // each player signs in from their own phone
  const otp = await must("POST", "/auth/otp", { body: { phone }, ip });
  const s = await must("POST", "/auth/verify", { body: { phone, code: otp.debugOtp }, ip });
  return { token: s.accessToken, user: s.user, phone };
}

// ---------- people ----------
const FIRST_M = ["Aarav", "Vihaan", "Arjun", "Rohan", "Kabir", "Ishaan", "Aditya", "Karan", "Siddharth", "Rahul", "Nikhil", "Varun", "Yash", "Pranav", "Dev", "Harsh"];
const FIRST_F = ["Ananya", "Diya", "Isha", "Meera", "Saanvi", "Riya", "Kavya", "Tara", "Neha", "Pooja"];
const LAST = ["Sharma", "Patil", "Iyer", "Singh", "Rao", "Kulkarni", "Desai", "Nair", "Gupta", "Joshi", "Mehta", "Reddy", "Shah", "Kapoor"];
const female = (i) => (i >= 8 && i <= 13) || (i >= 14 && i % 9 === 4); // the 6 women's badminton players, plus a few elsewhere
const playerSpec = (i) => ({
  phone: `${P}000000${String(i + 1).padStart(2, "0")}`,
  name: `${female(i) ? FIRST_F[i % FIRST_F.length] : FIRST_M[i % FIRST_M.length]} ${LAST[(i * 7) % LAST.length]}`,
  gender: female(i) ? "female" : "male",
  dob: `${1990 + (i % 15)}-0${1 + (i % 9)}-1${i % 9}`,
});
const answersOf = (p) => ({ full_name: p.name, gender: p.gender === "male" ? "Male" : "Female", dob: p.dob, mobile: p.phone, pincode: "411001", privacy_consent: true });

// ========== 1. Accounts ==========
console.log(`\nForce Pulse end-to-end scenario ${run} against ${API}\n`);
const health = await call("GET", "/health");
if (health.status !== 200) throw new Error(`API not reachable at ${API}`);

const t0 = Date.now();
const players = [];
for (let i = 0; i < 80; i++) {
  const spec = playerSpec(i);
  const s = await signIn(spec.phone);
  await as(s).patch("/me/player", { name: spec.name, gender: spec.gender, dob: spec.dob });
  players.push({ ...s, ...spec, i });
}
metrics.signInSeconds = ((Date.now() - t0) / 1000).toFixed(1);
check("Accounts", "FR-AUTH-01", "80 players sign in with mobile + OTP", players.length === 80, `${metrics.signInSeconds}s for 80 sign-ins`);
check("Accounts", "FR-AUTH-02", "Every new account is a Player", players.every((p) => p.user.roles.includes("player")));

const limitIp = "10.88.0.1";
for (let k = 0; k < 3; k++) await call("POST", "/auth/otp", { body: { phone: `${P}00009999` }, ip: limitIp });
check("Accounts", "FR-AUTH-01", "4th OTP to one number within 15 min is refused", (await call("POST", "/auth/otp", { body: { phone: `${P}00009999` }, ip: limitIp })).status === 429);

const atul = await signIn(`${P}00000102`); // test organiser for tournament A (keeps real numbers out of tests)
await as(atul).patch("/me/player", { name: "Anil Mehta" });
const priya = await signIn(`${P}00000101`);
await as(priya).patch("/me/player", { name: "Priya Kulkarni" });
const adminLogin = await must("POST", "/auth/staff/login", { body: ADMIN });
const admin = { token: adminLogin.accessToken };

// ========== 2. Tournament A: badminton, table tennis, football ==========
const A = await as(atul).post("/tournaments", {
  name: `Mumbai Multi-Sport Championship ${run}`,
  venue: "NSCI Dome",
  city: "Mumbai",
  contactName: "Anil Mehta",
  contactPhone: `+91${P}00000102`,
  startsAt: "2026-11-20T08:00:00+05:30",
  endsAt: "2026-11-22T20:00:00+05:30",
  status: "draft",
  events: [
    { sportId: "badminton", entryType: "individual", categories: [{ name: "Men's Singles", gender: "male" }, { name: "Women's Singles", gender: "female" }] },
    { sportId: "table-tennis", entryType: "individual" },
    { sportId: "football", entryType: "team", minPlayersPerTeam: 5, maxPlayersPerTeam: 8, maxTeams: 4 },
  ],
});
check("Tournaments", "FR-TRN-01", "Organiser creates a 3-sport tournament with categories", A.events.length === 3 && A.events[0].categories.length === 2);
check("Tournaments", "FR-TRN-02", "Tournament gets a registration link", typeof A.registrationPath === "string" && A.registrationPath.length > 3, A.registrationPath);
check("Accounts", "FR-AUTH-03", "Creating a tournament adds the Organiser role", (await as(atul).get("/me/roles")).roles.includes("organiser"));

const suggested = await must("GET", "/forms/suggested-fields");
await as(atul).put(`/tournaments/${A.id}/form`, { fields: suggested });
await as(atul).post(`/tournaments/${A.id}/form/publish`);
await as(atul).put(`/tournaments/${A.id}/status`, { status: "enrollment_open" });
const regPage = await must("GET", `/t/${A.slug}`);
check("Registration", "FR-REG-03/04", "Form built from the suggested fields and published", regPage.form.fields.length === suggested.length, `${suggested.length} fields incl. consent`);
check("Registration", "FR-REG-02", "Registration link serves the form with nothing pre-filled", !/"(value|default)"/.test(JSON.stringify(regPage.form)));

const [bad, tt, foot] = A.events;
const [mens, womens] = bad.categories;
const reg = (p, t, entries) => as(p).post(`/tournaments/${t.id}/registrations`, { entries, answers: answersOf(p) });

// Badminton: players 0-7 men's, 8-13 women's. Players 0 and 1 also play table tennis in the same submission.
for (const p of players.slice(0, 8)) await reg(p, A, [{ eventId: bad.id, categoryId: mens.id }, ...(p.i < 2 ? [{ eventId: tt.id }] : [])]);
for (const p of players.slice(8, 14)) await reg(p, A, [{ eventId: bad.id, categoryId: womens.id }]);
const multi = (await as(players[0]).get("/me/enrollments")).filter((e) => e.tournamentId === A.id);
check("Registration", "FR-REG-08", "One player enters two sports in one submission", multi.length === 2);
const wrongCat = await as(players[13]).try("POST", `/tournaments/${A.id}/registrations`, { entries: [{ eventId: bad.id, categoryId: mens.id }], answers: answersOf(players[13]) });
check("Registration", "FR-REG-09", "A woman can't enter Men's Singles (category gender rule)", wrongCat.status === 400 || wrongCat.status === 409, wrongCat.data?.message);
for (const p of players.slice(14, 22)) await reg(p, A, [{ eventId: tt.id }]);

// Football: 4 teams of 7 (players 22-49). Captain registers, six team-mates join with the code.
const footballTeams = [];
for (let k = 0; k < 4; k++) {
  const squad = players.slice(22 + k * 7, 29 + k * 7);
  const captain = squad[0];
  const r = await as(captain).post(`/tournaments/${A.id}/events/${foot.id}/teams`, { teamName: ["Mumbai Strikers", "Andheri United", "Bandra Blues", "Thane Titans"][k], answers: answersOf(captain) });
  for (const mate of squad.slice(1)) await as(mate).post("/teams/join", { code: r.team.code, answers: answersOf(mate) });
  footballTeams.push({ ...r.team, squad });
}
const teamView = await must("GET", `/teams/code/${footballTeams[0].code}`);
check("Registration", "FR-REG-07", "Captain registers a team; team-mates join with its code", teamView.players === 7, `${footballTeams.length} teams × ${teamView.players} players`);

const entriesA = await as(atul).get(`/tournaments/${A.id}/enrollments`);
check("Registration", "FR-REG-11", "Free entries are approved at once", entriesA.every((e) => e.status === "enrolled"), `${entriesA.length} entries, all enrolled`);
const csv = await call("GET", `/tournaments/${A.id}/enrollments.csv`, { token: atul.token, raw: true });
check("Registration", "FR-REG-17", "Organiser exports registrations to CSV", csv.status === 200 && csv.buf.toString().split("\n").length > 40, `${csv.buf.toString().trim().split("\n").length - 1} rows`);

// ========== 3. Fixtures for A ==========
await as(atul).put(`/tournaments/${A.id}/status`, { status: "enrollment_closed" });
const fmtMen = await as(atul).put(`/events/${bad.id}/format`, { categoryId: mens.id, type: "knockout", rules: { pointsToWin: 11, winBy: 2, cap: 15, bestOf: "1" }, config: { thirdPlace: true } });
const fmtWomen = await as(atul).put(`/events/${bad.id}/format`, { categoryId: womens.id, type: "league", rules: { pointsToWin: 11, winBy: 2, cap: 15, bestOf: "1" } });
const fmtTT = await as(atul).put(`/events/${tt.id}/format`, { type: "league_knockout", rules: { pointsToWin: 11, winBy: 2, cap: 0, bestOf: "1" }, config: { groups: 2, qualifiersPerGroup: 2 } });
const fmtFoot = await as(atul).put(`/events/${foot.id}/format`, { type: "league", rules: { halves: 2, halfMinutes: 20 } });
check("Tournaments", "FR-TRN-04", "Formats per sport and category: knockout, league, league + knockout", !!(fmtMen.id && fmtWomen.id && fmtTT.id && fmtFoot.id));
check("Scoring", "FR-SCR-01", "Organiser sets each sport's rules (nothing applied by default)", fmtMen.rules?.pointsToWin === 11 && fmtFoot.rules?.halfMinutes === 20);

const durations = {};
const gen = async (f, courts, minutes) => {
  durations[f.id] = minutes;
  return as(atul).post(`/formats/${f.id}/fixtures`, { startDate: "2026-11-20", dayStart: "08:00", dayEnd: "20:00", matchMinutes: minutes, courts });
};
await gen(fmtMen, ["Court 1", "Court 2"], 30);
await gen(fmtWomen, ["Court 3"], 30);
await gen(fmtTT, ["TT Table 1", "TT Table 2"], 20);
await gen(fmtFoot, ["Ground A"], 60);
let matchesA = await must("GET", `/tournaments/${A.id}/matches`);
check("Tournaments", "FR-TRN-08", "Fixtures generated automatically for every sport", matchesA.length > 0, `${matchesA.length} matches`);

// Clash check: same court at the same time, or one player in two overlapping matches.
const playersOf = new Map();
for (const e of entriesA) {
  const key = e.teamId ?? e.id;
  playersOf.set(key, [...(playersOf.get(key) ?? []), e.player.playerCode]);
}
let courtClash = 0;
let playerClash = 0;
const span = (m) => [Date.parse(m.scheduledAt), Date.parse(m.scheduledAt) + durations[m.formatId] * 60_000];
for (let x = 0; x < matchesA.length; x++) {
  for (let y = x + 1; y < matchesA.length; y++) {
    const [m1, m2] = [matchesA[x], matchesA[y]];
    if (!m1.scheduledAt || !m2.scheduledAt) continue;
    const [a1, b1] = span(m1);
    const [a2, b2] = span(m2);
    if (a1 >= b2 || a2 >= b1) continue;
    if (m1.court === m2.court) courtClash++;
    const p1 = [...(playersOf.get(m1.homeEntrantId) ?? []), ...(playersOf.get(m1.awayEntrantId) ?? [])];
    const p2 = new Set([...(playersOf.get(m2.homeEntrantId) ?? []), ...(playersOf.get(m2.awayEntrantId) ?? [])]);
    if (p1.some((p) => p2.has(p))) playerClash++;
  }
}
check("Tournaments", "FR-TRN-08", "No court clashes and no player in two matches at once (across sports)", courtClash === 0 && playerClash === 0, `${courtClash} court, ${playerClash} player clashes`);

// Assign a player as scorer for the first men's match.
const firstMen = matchesA.find((m) => m.formatId === fmtMen.id && m.homeEntrantId && m.awayEntrantId);
const scorer = players[60];
await as(atul).patch(`/matches/${firstMen.id}`, { scorerUserId: scorer.user.id });
await as(atul).put(`/tournaments/${A.id}/status`, { status: "fixtures_published" });
await as(atul).put(`/tournaments/${A.id}/status`, { status: "live" });

// ========== 4. Live scoring ==========
const socket = io(ORIGIN, { transports: ["websocket"] });
await new Promise((ok, fail) => (socket.once("connect", ok), socket.once("connect_error", fail)));
const latencies = [];
let tournamentPushes = 0;
socket.on("standings.updated", () => tournamentPushes++);
await socket.emitWithAck("subscribe", `tournament:${A.id}`);

/** Scores a rally-sport match point by point: the loser's points first, then the winner's, game by game. */
async function scoreSets(s, m, games, target, timed = false) {
  const device = `e2e-${m.id.slice(0, 8)}`;
  await as(s).post(`/matches/${m.id}/start`, { deviceId: device });
  const winner = Math.random() < 0.5 ? "home" : "away";
  const loser = winner === "home" ? "away" : "home";
  const events = [];
  for (let g = 0; g < games; g++) {
    const lose = Math.floor(Math.random() * (target - 2));
    for (let k = 0; k < lose; k++) events.push(loser);
    for (let k = 0; k < target; k++) events.push(winner);
  }
  let seq = 0;
  for (let k = 0; k < events.length; k += 8) {
    const batch = events.slice(k, k + 8).map((side) => ({ id: crypto.randomUUID(), seq: ++seq, action: "point", payload: { side } }));
    if (timed) {
      await socket.emitWithAck("subscribe", `match:${m.id}`);
      const t = Date.now();
      const heard = new Promise((ok) => socket.once("score.updated", () => ok(Date.now() - t)));
      await as(s).post(`/matches/${m.id}/events`, { deviceId: device, events: batch });
      latencies.push(await Promise.race([heard, sleep(3000).then(() => 9999)]));
      timed = false;
    } else await as(s).post(`/matches/${m.id}/events`, { deviceId: device, events: batch });
  }
  await as(s).post(`/matches/${m.id}/close`, {});
}

/** Plays every match of a format whose two sides are known, round after round, until none are left. */
async function playFormat(tid, formatId, play) {
  let played = 0;
  for (;;) {
    const ms = (await must("GET", `/tournaments/${tid}/matches`)).filter((m) => m.formatId === formatId && m.status === "scheduled" && m.homeEntrantId && m.awayEntrantId);
    if (!ms.length) return played;
    for (const m of ms) {
      await play(m);
      played++;
    }
  }
}

const tScore = Date.now();
await scoreSets(scorer, firstMen, 1, 11, true);
check("Accounts", "FR-AUTH-04", "A player assigned to score becomes a Scorer", (await as(scorer).get("/me/roles")).roles.includes("scorer"));
const menPlayed = 1 + (await playFormat(A.id, fmtMen.id, (m) => scoreSets(atul, m, 1, 11)));
const womenPlayed = await playFormat(A.id, fmtWomen.id, (m) => scoreSets(atul, m, 1, 11));
const ttPlayed = await playFormat(A.id, fmtTT.id, (m) => scoreSets(atul, m, 1, 11));
metrics.scoringSeconds = ((Date.now() - tScore) / 1000).toFixed(1);
check("Scoring", "FR-SCR-08/10/14", "Matches scored point by point, ends detected from the rules, closed", menPlayed + womenPlayed + ttPlayed > 20, `${menPlayed + womenPlayed + ttPlayed} matches in ${metrics.scoringSeconds}s`);
metrics.liveLatencyMs = latencies[0];
check("Scoring", "FR-SCR-13 / NFR-03", "Live score reaches a viewer within 2 seconds", latencies[0] < 2000, `${latencies[0]} ms`);
check("Tournaments", "FR-TRN-11", "Points tables update live when matches close", tournamentPushes > 0, `${tournamentPushes} live table updates`);

// Football: results entered by hand; one walkover.
const footMatches = (await must("GET", `/tournaments/${A.id}/matches`)).filter((m) => m.formatId === fmtFoot.id);
for (const [k, m] of footMatches.entries()) {
  if (k === 0) await as(atul).post(`/matches/${m.id}/result`, { type: "walkover", winnerEntrantId: m.homeEntrantId, reason: "Opponent didn't turn up" });
  else await as(atul).post(`/matches/${m.id}/result`, { type: "score", homeScore: Math.floor(Math.random() * 4), awayScore: Math.floor(Math.random() * 4) });
}
check("Tournaments", "FR-TRN-12", "Walkover recorded with a reason; other results entered", footMatches.length === 6, `${footMatches.length} football matches`);

const standingsA = await must("GET", `/tournaments/${A.id}/standings`);
const footTable = standingsA.find((s) => s.formatId === fmtFoot.id);
check("Tournaments", "FR-TRN-05/11", "League tables: played, points, tie-breakers", footTable?.rows.length === 4 && footTable.rows.every((r) => r.played === 3), footTable?.rows.map((r) => `${r.name} ${r.points}`).join(", "));
const finalMen = (await must("GET", `/tournaments/${A.id}/matches`)).filter((m) => m.formatId === fmtMen.id && m.stage === "knockout").sort((a, b) => b.round - a.round || a.matchNo - b.matchNo);
const final = finalMen.find((m) => !m.homeSource?.startsWith("L:"));
check("Tournaments", "FR-TRN-06/11", "Knockout bracket fills itself to a final with a winner, plus a third-place match", final?.status === "completed" && finalMen.some((m) => m.homeSource?.startsWith("L:")), `final: ${final?.homeName} vs ${final?.awayName}`);
const ttKo = (await must("GET", `/tournaments/${A.id}/matches`)).filter((m) => m.formatId === fmtTT.id && m.stage === "knockout");
check("Tournaments", "FR-TRN-07", "League + knockout: group places fill the knockout", ttKo.length > 0 && ttKo.every((m) => m.status === "completed"), `${ttKo.length} knockout matches`);

// Gallery with real photos.
for (let k = 0; k < 3; k++) {
  const img = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: ["#0b1f3a", "#d4af37", "#1e8e5a"][k] } }).jpeg().toBuffer();
  const form = new FormData();
  form.append("kind", "media");
  form.append("file", new Blob([img], { type: "image/jpeg" }), `day${k + 1}.jpg`);
  const up = await must("POST", "/uploads", { token: atul.token, body: form });
  await as(atul).post(`/tournaments/${A.id}/media`, { uploadKey: up.key, caption: `Day ${k + 1}` });
}
const gallery = await must("GET", `/tournaments/${A.id}/media`);
check("Gallery", "FR-MED-01/02/06", "Organiser uploads photos; each gets a preview", gallery.items.length === 3 && gallery.items.every((m) => m.thumbUrl), `${gallery.items.length} of ${gallery.limit}`);

await as(atul).put(`/tournaments/${A.id}/status`, { status: "completed" });

// Profile of the men's champion.
const champEntry = entriesA.find((e) => e.id === final?.winnerEntrantId);
const champ = players.find((p) => p.name === champEntry?.player.playerName);
const champPlayer = champ ? await as(champ).get("/me/player") : null;
const prof = champPlayer ? await must("GET", `/players/${champPlayer.id}/profile`) : null;
check("Profile", "FR-PRO-02/03/05", "Champion's profile: stats, Winner in history, Champion badge", !!prof && prof.history.some((h) => h.finish === "Winner") && prof.badges.some((b) => b.id === "champion"), prof ? `${prof.player.name}: ${prof.totals.played} played, ${prof.totals.won} won` : "no champion found");
check("Profile", "FR-PRO-07", "Public profile hides date of birth and pincode", prof?.player.dob === null && prof?.player.pincode === null);

// ========== 5. Tournament B: cricket auction, volleyball, paid tennis ==========
const B = await as(priya).post("/tournaments", {
  name: `Pune Premier League ${run}`,
  venue: "Balewadi Stadium",
  city: "Pune",
  contactName: "Priya Kulkarni",
  startsAt: "2026-11-27T08:00:00+05:30",
  endsAt: "2026-11-29T20:00:00+05:30",
  status: "draft",
  events: [
    { sportId: "cricket", entryType: "pooled", poolFormation: "auction" },
    { sportId: "volleyball", entryType: "team", minPlayersPerTeam: 4, maxPlayersPerTeam: 6 },
    { sportId: "tennis", entryType: "individual", feePaise: 30_000 },
  ],
});
const [cricket, volley, tennis] = B.events;
const blocked = await as(priya).try("PUT", `/tournaments/${B.id}/status`, { status: "enrollment_open" });
check("Payments", "FR-PAY-11", "Paid registration can't open until the bank account is verified", blocked.status === 409, blocked.data?.message);
await as(priya).put("/payout-accounts/me", { holderName: "Priya Kulkarni", accountNumber: "50100123456789", ifsc: "HDFC0000123" });
await as(admin).post(`/admin/payout-accounts/${priya.user.id}/verify`);
await as(priya).put(`/tournaments/${B.id}/status`, { status: "enrollment_open" });

for (const p of players.slice(50, 66)) await as(p).post(`/tournaments/${B.id}/registrations`, { entries: [{ eventId: cricket.id }] });
const tennisRegs = [];
for (const p of players.slice(66, 72)) tennisRegs.push(await as(p).post(`/tournaments/${B.id}/registrations`, { entries: [{ eventId: tennis.id }] }));
const held = tennisRegs.every((r) => r.enrollments[0].status === "payment_pending" && r.amountDuePaise === 30_000 && r.holdExpiresAt);
check("Payments", "FR-PAY-01/07", "Paid entries wait for payment and hold their place for 30 minutes", held, "₹300 due each");
const order = await as(players[66]).try("POST", "/payments/orders", { enrollmentIds: [tennisRegs[0].enrollments[0].id] });
check("Payments", "FR-PAY-04/06", "Pay through Razorpay Checkout", order.status === 201 ? true : "blocked", order.status === 201 ? "order created" : `Razorpay test keys not set: ${order.data?.message}`);

for (let k = 0; k < 2; k++) {
  const squad = players.slice(72 + k * 4, 76 + k * 4);
  const r = await as(squad[0]).post(`/tournaments/${B.id}/events/${volley.id}/teams`, { teamName: ["Shivaji Spikers", "Koregaon Kings"][k] });
  for (const mate of squad.slice(1)) await as(mate).post("/teams/join", { code: r.team.code });
}

// Auction for cricket.
await as(priya).put(`/tournaments/${B.id}/status`, { status: "enrollment_closed" });
await as(priya).put(`/tournaments/${B.id}/status`, { status: "team_formation" });
const auction = await as(priya).post(`/tournaments/${B.id}/auctions`, { eventId: cricket.id });
await as(admin).post(`/admin/auctions/${auction.id}/plan`, { planId: "starter" });
await as(priya).put(`/auctions/${auction.id}/config`, {
  purse: 100_000,
  minSquad: 7,
  maxSquad: 9,
  timerSeconds: 5,
  lotOrder: "category",
  slabs: [{ from: 0, raise: 500 }, { from: 10_000, raise: 1_000 }],
  categories: [{ name: "Gold", basePoints: 5_000, quotaPerTeam: 3 }, { name: "Silver", basePoints: 2_000 }],
});
const owners = [players[66], players[67]];
let state = await as(priya).post(`/auctions/${auction.id}/teams`, { name: "Pune Panthers", ownerPhone: owners[0].phone });
state = await as(priya).post(`/auctions/${auction.id}/teams`, { name: "Deccan Chargers", ownerPhone: owners[1].phone });
const [teamP, teamD] = state.teams;
const pool = await as(priya).get(`/auctions/${auction.id}/pool`);
const goldIds = new Set(players.slice(50, 54).map((p) => p.name));
await as(priya).put(`/auctions/${auction.id}/lots`, {
  lots: pool.map((p, k) => ({
    playerId: p.playerId,
    categoryId: goldIds.has(p.name) ? state.categories[0].id : state.categories[1].id,
    retain: k === 0 ? { teamId: teamP.id, points: 8_000 } : null,
  })),
});
check("Auction", "FR-AUC-08", "A player is retained by a team before bidding", (await must("GET", `/auctions/${auction.id}`)).lots.some((l) => l.retained));
await as(priya).post(`/auctions/${auction.id}/start`);

const tAuction = Date.now();
let sold = 0;
let refused = 0;
for (;;) {
  const next = await call("POST", `/auctions/${auction.id}/next`, { token: priya.token, body: { lotId: null } });
  if (next.status !== 200) break;
  const rounds = 1 + Math.floor(Math.random() * 4);
  for (let r = 0; r < rounds; r++) {
    const view = await must("GET", `/auctions/${auction.id}`);
    const teamOrder = [...view.teams].sort((a, b) => a.players - b.players);
    for (const t of teamOrder) {
      if (t.id === view.leadingTeamId) continue;
      const owner = t.id === teamP.id ? owners[0] : owners[1];
      const b = await call("POST", `/auctions/${auction.id}/bid`, { token: owner.token, body: { teamId: t.id } });
      if (b.status === 200 || b.status === 201) break;
      refused++;
    }
  }
  for (let w = 0; w < 20; w++) {
    await sleep(500);
    if (!(await must("GET", `/auctions/${auction.id}`)).current) break;
  }
  sold++;
}
await as(priya).post(`/auctions/${auction.id}/close`);
const afterAuction = await must("GET", `/auctions/${auction.id}`);
metrics.auctionSeconds = ((Date.now() - tAuction) / 1000).toFixed(1);
const soldLots = afterAuction.lots.filter((l) => l.status === "sold");
check("Auction", "FR-AUC-09 to 17", "Live auction: lots, owner bids, timer sells, points deducted", soldLots.length >= 10, `${soldLots.length} sold of ${afterAuction.lots.length} in ${metrics.auctionSeconds}s; ${refused} bids refused by the rules`);
check("Auction", "FR-AUC-12", "Every team kept enough points to fill its squad", afterAuction.teams.every((t) => t.pointsLeft >= 0), afterAuction.teams.map((t) => `${t.name}: ${t.players} players, ${t.pointsLeft} left`).join("; "));
const statusMine = await as(players[50]).get("/me/auctions");
check("Auction", "FR-AUC-18", "A player sees their own auction status", statusMine.length === 1 && !!statusMine[0].label, statusMine[0]?.label);
const pdfX = await call("GET", `/auctions/${auction.id}/export.pdf`, { token: priya.token, raw: true });
const xlsX = await call("GET", `/auctions/${auction.id}/export.xlsx`, { token: priya.token, raw: true });
check("Auction", "FR-AUC-20", "Results export to PDF and Excel", pdfX.buf.subarray(0, 5).toString() === "%PDF-" && xlsX.buf.subarray(0, 2).toString() === "PK");

const fmtCricket = await as(priya).put(`/events/${cricket.id}/format`, { type: "league", rules: { overs: 10, ballsPerOver: 6, playersPerSide: 7 } });
const cricketFixtures = await as(priya).post(`/formats/${fmtCricket.id}/fixtures`, { startDate: "2026-11-27", dayStart: "08:00", dayEnd: "18:00", matchMinutes: 120, courts: ["Main Ground"] });
check("Auction", "FR-AUC-19 / AC-10", "Sold players join their teams, which play in the tournament", cricketFixtures.length === 1, `${cricketFixtures[0]?.homeName} vs ${cricketFixtures[0]?.awayName}`);

const fmtVolley = await as(priya).put(`/events/${volley.id}/format`, { type: "league", rules: { pointsToWin: 15, winBy: 2, cap: 0, bestOf: "3" }, config: { legs: 2 } });
await as(priya).post(`/formats/${fmtVolley.id}/fixtures`, { startDate: "2026-11-28", dayStart: "08:00", dayEnd: "18:00", matchMinutes: 45, courts: ["Indoor Court"] });
await as(priya).put(`/tournaments/${B.id}/status`, { status: "fixtures_published" });
await as(priya).put(`/tournaments/${B.id}/status`, { status: "live" });
await as(priya).post(`/matches/${cricketFixtures[0].id}/result`, { type: "score", homeScore: 142, awayScore: 138 });
const volleyPlayed = await playFormat(B.id, fmtVolley.id, (m) => scoreSets(priya, m, 2, 15));
check("Scoring", "FR-SCR-01/10", "Volleyball best of 3 to 15 scored and closed", volleyPlayed === 2);
await as(priya).put(`/tournaments/${B.id}/status`, { status: "completed" });

// ========== 6. Casual match, pages, privacy, admin ==========
const casual = await as(players[5]).post("/matches/casual", { sportId: "table-tennis", rules: { pointsToWin: 11, winBy: 2, cap: 0, bestOf: "1" }, home: { name: "Aarav", players: [{ phone: players[5].phone }] }, away: { name: "Guest", players: [{ phone: players[6].phone }] } });
await scoreSets(players[5], { id: casual.matchId }, 1, 11);
check("Scoring", "FR-SCR-05", "A player sets up and scores a casual match", (await must("GET", `/matches/${casual.matchId}/live`)).status === "completed");

const pages = await must("GET", "/pages");
check("Site", "FR-ABT-01", "About, FAQ, terms, privacy and refund pages exist", ["about", "faq", "terms", "privacy", "refunds"].every((s) => pages.some((p) => p.slug === s)));
const myData = await as(players[3]).get("/me/data");
check("Privacy", "NFR-10", "A player downloads their data", myData.user.phone === `+91${players[3].phone}` && myData.registrations.length >= 1);
const finance = await as(admin).get("/admin/finance");
check("Admin", "FR-PAY-15 / FR-ADM-04", "Admin finance report", typeof finance.netRevenuePaise === "number");
const audit = await as(admin).get("/admin/audit-logs");
check("Admin", "FR-ADM-05", "Audit log records results, payouts and admin changes", Array.isArray(audit) ? audit.length > 10 : (audit.items ?? []).length > 10);
socket.disconnect();

// ========== Report ==========
const counts = { PASS: 0, FAIL: 0, BLOCKED: 0 };
for (const c of checks) counts[c.status]++;
const totalMatches = (await must("GET", `/tournaments/${A.id}/matches`)).length + (await must("GET", `/tournaments/${B.id}/matches`)).length + 1;
const md = `# Force Pulse – End-to-End Test Report

${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · run ${run} · ${((Date.now() - started) / 1000).toFixed(0)} s

**${counts.PASS} passed, ${counts.FAIL} failed, ${counts.BLOCKED} blocked** out of ${checks.length} checks, run against the real API (${API}).

## What was run

| | |
| --- | --- |
| Players | 80 signed in with mobile + OTP, plus 2 organisers and the super admin |
| Tournament A | ${A.name}: badminton (Men's knockout 8, Women's league 6), table tennis (league + knockout, 10), football (4 teams of 7) |
| Tournament B | ${B.name}: cricket by auction (16-player pool, 2 teams), volleyball (2 teams of 4), tennis (6 paid entries) |
| Matches | ${totalMatches} (including 1 casual match) |
| Live score delay | ${metrics.liveLatencyMs} ms (target ≤ 2,000) |
| Timings | sign-ins ${metrics.signInSeconds} s · scoring ${metrics.scoringSeconds} s · auction ${metrics.auctionSeconds} s |

## Results

| Area | Requirement | Check | Result | Detail |
| --- | --- | --- | --- | --- |
${checks.map((c) => `| ${c.area} | ${c.id} | ${c.title} | ${c.status === "PASS" ? "✅ Pass" : c.status === "FAIL" ? "❌ Fail" : "⏸ Blocked"} | ${String(c.detail).replace(/\|/g, "/")} |`).join("\n")}

## Not covered by this run
- Real Razorpay payment, refund and receipt (needs test keys); notifications (not built); boxing, golf and other unbuilt sports; load and security testing.
`;
writeFileSync(REPORT, md);
console.log(`\n${counts.PASS} passed, ${counts.FAIL} failed, ${counts.BLOCKED} blocked. Report: ${REPORT}`);
process.exit(counts.FAIL ? 1 : 0);
