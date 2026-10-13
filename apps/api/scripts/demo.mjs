// Fills a running development API with a small demo: an organiser, 4 players, a badminton league with fixtures,
// one match played and one being scored live. Usage: npm run demo (API must be running with OTP_PROVIDER=console).
import { randomUUID } from "node:crypto";

const API = process.env.API_URL ?? "http://localhost:4000/api/v1";

async function call(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data.message ?? ""}`);
  return data;
}

async function signIn(phone, name) {
  const { debugOtp } = await call("POST", "/auth/otp", { phone });
  if (!debugOtp) throw new Error("Run the API with OTP_PROVIDER=console (development) for the demo");
  const s = await call("POST", "/auth/verify", { phone, code: debugOtp });
  await call("PATCH", "/me/player", { name }, s.accessToken);
  return s;
}

const run = Date.now().toString().slice(-4);
const org = await signIn(`70000${run}0`, "Ravi (Organiser)");
const t = await call(
  "POST",
  "/tournaments",
  {
    name: `Mumbai Smash Open ${run}`,
    city: "Mumbai",
    venue: "Andheri Sports Complex",
    startsAt: "2026-11-20T03:30:00Z",
    endsAt: "2026-11-21T12:30:00Z",
    status: "enrollment_open",
    events: [{ sportId: "badminton", entryType: "individual" }],
  },
  org.accessToken,
);
const names = ["Asha Rao", "Vikram Singh", "Neha Patil", "Arjun Mehta"];
for (const [i, name] of names.entries()) {
  const p = await signIn(`70000${run}${i + 1}`, name);
  await call("POST", `/tournaments/${t.id}/registrations`, { entries: [{ eventId: t.events[0].id }] }, p.accessToken);
}
await call("PUT", `/tournaments/${t.id}/status`, { status: "enrollment_closed" }, org.accessToken);
const format = await call("PUT", `/events/${t.events[0].id}/format`, { type: "league", rules: { pointsToWin: 21, winBy: 2, cap: 30, bestOf: "3" } }, org.accessToken);
await call("POST", `/formats/${format.id}/fixtures`, { startDate: "2026-11-20", dayStart: "09:00", dayEnd: "18:00", matchMinutes: 30, courts: ["Court 1", "Court 2"] }, org.accessToken);
const matches = await call("GET", `/tournaments/${t.id}/matches`);

// Match 1: played to the end (21–15, 21–18).
const device = "demo-scorer-phone";
let seq = 0;
const send = (matchId, list) =>
  call("POST", `/matches/${matchId}/events`, { deviceId: device, events: list.map((side) => ({ id: randomUUID(), seq: ++seq, action: "point", payload: { side } })) }, org.accessToken);
const pts = (home, away) => [...Array(home).fill("home"), ...Array(away).fill("away")];
await call("POST", `/matches/${matches[0].id}/start`, { deviceId: device }, org.accessToken);
await send(matches[0].id, [...pts(15, 15), ...pts(6, 0), ...pts(18, 18), ...pts(3, 0)]);
await call("POST", `/matches/${matches[0].id}/close`, {}, org.accessToken);

// Match 2: in progress (11–8 in game 1).
seq = 0;
await call("POST", `/matches/${matches[1].id}/start`, { deviceId: device }, org.accessToken);
await send(matches[1].id, pts(11, 8));

const base = API.replace(/\/api\/v1$/, "");
console.log(`
Demo ready: ${t.name}

Open in a browser:
  Tournament        ${API}/tournaments/${t.id}
  Schedule/results  ${API}/tournaments/${t.id}/matches
  Points table      ${API}/tournaments/${t.id}/standings
  Finished match    ${API}/matches/${matches[0].id}/live
  Live match        ${API}/matches/${matches[1].id}/live
  Badminton rules   ${API}/sports/badminton/rules
  All sports        ${API}/sports
  Health            ${base}/api/v1/health
`);
