# NRL Draft

Private fantasy NRL leagues for friends: snake-draft players, set weekly
lineups, score from real NRL match stats, and compete on a ladder with finals.

See [PLAN.md](PLAN.md) for the agreed design and milestones.

## Layout

| Path | What |
|---|---|
| `apps/web` | Vite + React + TypeScript + Tailwind frontend (mobile-first, dark) |
| `apps/server` | Fastify API: auth (Better Auth + Google), leagues, invites (Socket.io draft server next) |
| `packages/shared` | Shared types and zod schemas: positions, league settings, defaults |
| `packages/db` | Prisma schema, migrations and client (Postgres on Neon) |
| `packages/nrl` | nrl.com importer: draw, team lists, player stats, positions |

## Requirements

- Node.js 22 or newer (developed on 24)
- npm 10 or newer
- Works on Windows (PowerShell or Git Bash), macOS and Linux

## Run locally

```bash
npm install
```

Copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`) and
fill in the database URLs (see below). Create the tables:

```bash
npm run db:migrate
```

Load NRL data (the 2026 season takes ~15 minutes; requests to nrl.com are
deliberately spaced 2.5s apart):

```bash
npm run nrl:import -- --season 2026
```

Then start the app:

```bash
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:3001 (also proxied through the web dev server at `/api`)

## Checks

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build
```

## Importing NRL data

```bash
npm run nrl:import -- --season 2026 --round 5
```

| Option | Meaning |
|---|---|
| `--season Y --round N` | One round (1-27 regular season, 28-31 finals) |
| `--season Y --from A --to B` | A range of rounds (default: all) |
| `--current` | The current and previous round, as nrl.com sees it (used by the schedule) |
| `--force` | Re-fetch match pages even for settled matches |
| `--skip-profiles` | Skip the profile lookup for players who never start |

Imports are idempotent: re-running a round updates it in place, and a match
that finished over a week ago isn't re-fetched unless `--force` is given.
Every payload fetched is stored gzipped in `RawScrape`, and every run is
logged in `ImportRun`.

The `NRL import` GitHub Actions workflow runs `--current` on a schedule. It
needs a `DATABASE_URL` repository secret.

## Environment variables

| Name | Used by | Description |
|---|---|---|
| `DATABASE_URL` | server, importer | Neon **pooled** connection string (host contains `-pooler`) |
| `DIRECT_URL` | migrations | Neon **direct** connection string (no `-pooler`) |
| `PORT` | server | API port (default 3001) |
| `WEB_ORIGIN` | server | Comma-separated origins allowed by CORS (default `http://localhost:5173`) |
| `BETTER_AUTH_SECRET` | server | Random string, 32+ characters; signs session cookies |
| `BETTER_AUTH_URL` | server | The web app's origin (default `http://localhost:5173`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | server | Google OAuth client (see below) |

In the Neon console: project, **Connect**, **Show password**. Copy once with
connection pooling on (`DATABASE_URL`) and once with it off (`DIRECT_URL`).

Generate a `BETTER_AUTH_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### Google sign-in

In the [Google Cloud console](https://console.cloud.google.com): create a
project, then under **Google Auth Platform** set up the consent screen
(External; keep it in Testing and add your friends as test users), then
**Clients → Create client → Web application** with:

- Authorised JavaScript origin: `http://localhost:5173`
- Authorised redirect URI: `http://localhost:5173/api/auth/callback/google`

Add the production web origin and `<origin>/api/auth/callback/google` when
deploying.

## Tests

`npm test` runs everything. Tests that need a database run against a separate
`test` Postgres schema (created and migrated automatically from
`DIRECT_URL`), never the real data in `public`. Without `DATABASE_URL` and
`DIRECT_URL` they're skipped.
