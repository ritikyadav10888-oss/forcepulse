# Force Pulse Platform

Backend for Force Pulse: the API, the database and code shared with the web app. The web app lives in `multisports-scoring-engine`; it switches from its mock data to this API one module at a time.

Built from **Force Pulse – SRS v2**, **System Design v2** and **Sprint Plan Weeks 1–3** (in the folder above).

## Run it

Needs Node 22 or newer. No database install: development uses PGlite (real PostgreSQL running inside Node).

```bash
npm install
cp .env.example .env          # then set your own secrets
npm run dev                   # API on http://localhost:4000/api/v1
```

Sign in from a terminal:

```bash
curl -X POST localhost:4000/api/v1/auth/otp -H "Content-Type: application/json" -d '{"phone":"9876543210"}'
# The code is printed in the server log and returned as debugOtp (development only)
curl -X POST localhost:4000/api/v1/auth/verify -H "Content-Type: application/json" -d '{"phone":"9876543210","code":"<code>"}'
```

Super admin: `npm run db:seed` creates it from `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD`, then sign in with `POST /auth/staff/login`.

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | All tests (shared, database, API) |
| `npm run build` | Type-check and compile everything |
| `npm run db:generate` | Write a new SQL migration after a schema change (review it before committing) |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run db:seed` | Sports, fee settings and the first super admin (safe to rerun) |
| `npm run load-pincodes -w @force-pulse/db -- <file.csv>` | Load the India Post pincode CSV from data.gov.in |

## Layout

| Path | Contents |
| --- | --- |
| `packages/shared` | Phone format, money split (3% / 97%, in paise), roles, error codes. Used by API and web app |
| `packages/db` | Drizzle schema in PostgreSQL schemas `identity`, `people`, `competition`, `finance`, `platform`; migrations; seed |
| `apps/api` | NestJS API at `/api/v1` |

## Rules every change follows

- **Every route declares a policy**: `@Public()`, `@Authenticated()` or `@RequireRole(...)`. A route without one is refused, and a test fails.
- **Errors are `{ code, message }`**, with codes from `packages/shared/src/errors.ts`.
- **Money is integer paise.** Never floats. Fields carrying money end in `Paise`.
- **Inside a transaction, use `tx` only.** Calling `this.db` there deadlocks on PGlite and escapes the transaction on PostgreSQL.
- **The audit log and the money ledger are append-only.** The database refuses updates and deletes, and refuses any ledger transaction whose debits and credits differ.
- **Only Razorpay test keys outside production.** The API refuses to start with `rzp_live_` keys unless `NODE_ENV=production`.
- **Roles are granted by events** (`TournamentCreated` → organiser, `ScorerAssigned` / `MatchStartedBy` → scorer), never by a form.

## API so far (weeks 1–3)

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/otp`, `POST /auth/verify`, `POST /auth/staff/login`, `POST /auth/refresh`, `POST /auth/logout` |
| Me | `GET /me`, `GET /me/roles`, `GET/PATCH /me/player`, `PUT/DELETE /me/player/sports/:sportId` |
| Public | `GET /players/:id`, `GET /players/:id/sports`, `GET /sports`, `GET /sports/:id`, `GET /health` |
| Admin | `GET /admin/users/:id/roles`, `POST /admin/users/:id/roles/:role/suspend\|restore`, `PUT /admin/users/:id/platform-role`, `POST /admin/players/:id/suspend\|restore`, `GET/PUT /admin/settings/fees`, `PUT /admin/sports/:id`, `GET /admin/audit-logs` |
| Tournaments | `POST /tournaments`, `GET /tournaments` (public list), `GET /tournaments/:idOrSlug`, `GET /me/tournaments`, `PATCH /tournaments/:id`, `PUT /tournaments/:id/events`, `PUT /tournaments/:id/status` |
| Form builder | `GET /forms/suggested-fields`, `GET/PUT /tournaments/:id/form`, `POST /tournaments/:id/form/publish`, `GET /t/:slug` (registration page) |
| Private tournaments | `GET/POST /tournaments/:id/invites`, `DELETE /tournaments/:id/invites/:phone`, `GET/PATCH /tournaments/:id/invite-link`, `POST /tournaments/:id/invite-link/reset` |
| Registration | `POST /tournaments/:id/registrations`, `POST /tournaments/:id/events/:eventId/teams`, `GET /teams/code/:code`, `POST /teams/join`, `GET /me/enrollments`, `GET/POST /me/managed-players` |
| Organiser | `GET /tournaments/:id/enrollments`, `GET /tournaments/:id/enrollments.csv`, `POST /enrollments/:id/remove`, `POST /enrollments/:id/review`, `PATCH /enrollments/:id/flag` |
| Files and pincodes | `POST /uploads` (multipart: `file`, `kind`), `GET /uploads/:key`, `GET /pincodes/:pincode` |
| Payments | `POST /payments/orders`, `POST /payments/webhook` (Razorpay, signature-checked), `POST /payments/confirm`, `GET /me/payments`, `GET /payments/:id`, `GET /payments/:id/receipt` |
| Organiser money | `GET/PUT /payout-accounts/me`, `GET /tournaments/:id/finance`, `GET /tournaments/:id/statement.csv` |
| Admin money | `GET /admin/finance`, `GET /admin/payments`, `GET /admin/payouts/due` (organisers waiting to be paid), `GET /admin/payouts`, `POST /admin/tournaments/:id/payouts`, `POST /admin/payouts/:id/mark-paid\|mark-failed`, `POST /admin/payout-accounts/:userId/verify` |

## Payments: how money moves

On a ₹1,000 entry fee paid by card (SRS v2 4.1):

| | Amount | Ledger |
| --- | --- | --- |
| Player pays | ₹1,023.60 | Debit Razorpay clearing |
| Organiser share (97%) | ₹970.00 | Credit organiser payable (per tournament) |
| Platform fee (3%) | ₹30.00 | Credit platform fee revenue |
| Convenience fee (paid by player) | ₹23.60 | Credit convenience fee revenue |
| Razorpay charge | ₹23.60 | Debit gateway fee expense, credit Razorpay clearing |

A payment counts only when Razorpay's signed webhook says so, or when the server fetches it from Razorpay after Checkout. Payouts are manual: once a tournament is completed and its organiser asks, staff raise a payout of the organiser-payable balance, send the bank transfer, and record its reference.
