# NRL Draft

Private fantasy NRL leagues for friends. Snake-draft real players live, set a
lineup each week, and score from real NRL match stats, with a ladder and
finals at the end.

- **Leagues:** create a league, share the invite link, 4–18 teams. The
  commissioner picks the squad structure, scoring, pick timer, format (head
  to head with top 4/6/8 finals, no finals, or total points), the round the
  season ends, the draft time and the draft order.
- **Live draft room:** server-run clock, pre-draft queue, autopick (queue,
  then best available that fits), autopilot for missed picks, commissioner
  pause/undo, a colour-coded board, and it survives refreshes and reconnects.
- **Season:** lineups lock per player at kickoff; bye, not named and reserve
  warnings; ordered emergencies; live scores (final after a 24-hour stats
  review); side-by-side matchups; ladder and finals.
- **Data:** imported from nrl.com (draw, team lists, every player stat), on a
  schedule.
- **Site admin:** default scoring over 46 stats with a position-balance
  preview, what commissioners may change, and player position overrides.

See [PLAN.md](PLAN.md) for the design decisions.

## How it fits together

| Path | What |
|---|---|
| `apps/web` | Vite + React + TypeScript + Tailwind. Mobile-first, dark. |
| `apps/server` | Fastify API, Better Auth (Google), Socket.io draft room, season scoring |
| `packages/shared` | Rules shared by both: settings, stats catalogue, draft and lineup rules |
| `packages/scoring` | Pure scoring: points, emergencies, fixtures, ladder, finals brackets |
| `packages/db` | Prisma schema, migrations and client (Postgres) |
| `packages/nrl` | nrl.com importer |
| `scripts/` | Points report, wake-up check |

In production the browser only talks to the web app's domain (Vercel), which
forwards `/api` and `/socket.io` to the API (Render). That keeps sign-in
cookies first-party. Postgres is on Neon. GitHub Actions runs the data import.

## Run it locally (Windows, macOS, Linux)

Needs Node.js 22+ (developed on 24) and npm 10+. Works in PowerShell or Git Bash.

1. Install:

   ```bash
   npm install
   ```

2. Copy the environment template and fill it in (see
   [Environment variables](#environment-variables)). In PowerShell:

   ```bash
   Copy-Item .env.example .env
   ```

3. Create the database tables:

   ```bash
   npm run db:migrate
   ```

4. Load a season of NRL data. It takes about 15 minutes, because requests to
   nrl.com are deliberately spaced out:

   ```bash
   npm run nrl:import -- --season 2026
   ```

5. Start the app:

   ```bash
   npm run dev
   ```

   The web app is at http://localhost:5173 (the API runs on :3001 behind it).

6. Sign in with Google once, then make yourself a sample league: a finished
   draft and a fully scored 2026 season, with 7 demo managers:

   ```bash
   npm run seed -- --owner you@gmail.com
   ```

   Re-running replaces it, `--teams 10` changes the size, and
   `npm run seed -- --reset` removes it.

## Environment variables

| Name | Needed by | What |
|---|---|---|
| `DATABASE_URL` | server, importer, scripts | Neon **pooled** connection string (host contains `-pooler`) |
| `DIRECT_URL` | migrations, tests | Neon **direct** connection string (no `-pooler`) |
| `BETTER_AUTH_SECRET` | server | Random string, 32+ characters; signs session cookies |
| `BETTER_AUTH_URL` | server | The web app's URL (default `http://localhost:5173`) |
| `WEB_ORIGIN` | server | Web app URL(s) allowed to call the API, comma-separated (default `http://localhost:5173`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | server | Google OAuth client |
| `ADMIN_EMAILS` | server | Site admins' Google emails, comma-separated |
| `PORT` | server | API port (default 3001; hosts set it themselves) |

**Neon:** project, **Connect**, **Show password**. Copy once with connection
pooling on (`DATABASE_URL`) and once with it off (`DIRECT_URL`).

**Auth secret:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**Google sign-in:** in the [Google Cloud console](https://console.cloud.google.com),
create a project. Under **Google Auth Platform**, set up the consent screen
(External; leave it in Testing and add your friends as test users), then
**Clients → Create client → Web application** with:

- Authorised JavaScript origin: `http://localhost:5173`
- Authorised redirect URI: `http://localhost:5173/api/auth/callback/google`

Add the same two for your production URL when you deploy.

## Everyday commands

| Command | What |
|---|---|
| `npm run dev` | Web and API with hot reload |
| `npm test` | All tests (database tests use a separate `test` schema, never your data) |
| `npm run typecheck` | TypeScript across every package |
| `npm run build` | Production build of the web app |
| `npm run db:migrate` | Apply schema changes in development |
| `npm run db:deploy` | Apply migrations in production |
| `npm run db:studio` | Browse the database |
| `npm run nrl:import -- ...` | Import NRL data (below) |
| `npm run seed -- --owner you@gmail.com` | Sample league |
| `npm run report:points -- --tackles 0.5` | CSV of every player's season points under a scoring |

## NRL data

```bash
npm run nrl:import -- --season 2027
```

| Option | Meaning |
|---|---|
| `--season Y` | Every round of a season (1–27, then finals 28–31) |
| `--season Y --round N` / `--from A --to B` | One round / a range |
| `--current` | This round and last round, as nrl.com sees it (what the schedule runs) |
| `--force` | Re-fetch match pages even for settled matches |
| `--skip-profiles` | Skip the profile lookup for players who never start |

nrl.com pages embed the JSON they're built from; the importer reads that with
plain HTTP, one request every 2.5 seconds, retrying with backoff. Imports
are safe to re-run: rounds update in place and settled matches aren't
re-fetched. Every payload is stored (gzipped) in `RawScrape` and every run is
logged in `ImportRun`.

**Each new season:** when the NRL publishes next year's draw (usually
November), import it once so rounds have kickoff times and byes:

```bash
npm run nrl:import -- --season 2027 --skip-profiles
```

Players who never start get their position from their nrl.com profile; site
admins can set any player's positions under **Profile → Player positions**.

## Deploying (free tiers)

You need accounts on GitHub, [Neon](https://neon.tech), [Render](https://render.com)
and [Vercel](https://vercel.com), plus the Google OAuth client above.

1. **Database (Neon):** use your Neon project (Sydney region). Migrations run
   automatically when the API deploys.

2. **Code (GitHub):** push this repository to a GitHub repo (private is fine).

3. **API (Render):** New → **Blueprint** → pick the repo. It reads
   `render.yaml` and creates `nrl-draft-api` (free plan, Singapore region).
   Enter the secret environment variables when asked. `BETTER_AUTH_URL` and
   `WEB_ORIGIN` are your Vercel URL from the next step; set them once you know
   it. Check it's up at `https://nrl-draft-api.onrender.com/health`.

   If Render gives the service a different URL, update the three
   `onrender.com` addresses in `apps/web/vercel.json` to match.

4. **Web (Vercel):** Add New → Project → pick the repo, set **Root
   Directory** to `apps/web`. Everything else comes from `apps/web/vercel.json`.
   No environment variables are needed. Then go back to Render and set
   `BETTER_AUTH_URL` and `WEB_ORIGIN` to the Vercel URL.

5. **Google:** add the Vercel URL as an authorised JavaScript origin and
   `<vercel url>/api/auth/callback/google` as a redirect URI.

6. **Data import (GitHub Actions):** in the repo's **Settings → Secrets and
   variables → Actions**, add `DATABASE_URL`. The `NRL import` workflow then
   runs on schedule (team lists Tue/Wed, hourly on match days, the full draw
   weekly). Run it by hand from the Actions tab any time.

7. **Keep the API awake:** Render's free plan sleeps after 15 minutes idle
   and takes up to a minute to wake, which would stall a draft clock or a
   scheduled draft start. Point a free uptime monitor (for example
   [UptimeRobot](https://uptimerobot.com) or [cron-job.org](https://cron-job.org))
   at `https://nrl-draft-api.onrender.com/health` every 5–10 minutes. One
   always-on free service fits inside Render's 750 free hours a month.
   (Alternative for a public repo: enable the schedule in
   `.github/workflows/wake.yml`, which only wakes it around drafts.)

The live draft room works over long-polling in production, because Vercel's
rewrites don't pass WebSocket upgrades through. It falls back automatically.

## Testing

`npm test` runs about 220 tests: the pure rules (draft, lineups, scoring,
finals, stats catalogue), the importer against saved nrl.com pages, and the
API end to end against a real Postgres. Database tests use a separate `test`
schema, created and migrated automatically from `DIRECT_URL`, so they never
touch real data; without database URLs they're skipped (as in CI).
