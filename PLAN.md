# Plan

Agreed 2026-10-05. This file records the decisions behind the build; update it
when a decision changes.

## Decisions

- **Draft:** snake only for MVP (auction later, schema leaves room). No
  third-round reversal. Default pick timer 60s, configurable per league.
  Commissioners can set a draft date/time (editable until it starts); the
  server starts the draft at that time, even after a restart. Draft order:
  "randomise & lock when the league is full" (default) or set manually by the
  commissioner (arrange or shuffle until the draft).
- **Autopick:** queue first, then best available player who fits an open
  slot. A team that misses a pick stays on autopilot until its manager turns
  it off.
- **Squad (default, commissioner-editable):** 1 HF/HK (HB, FE, HK), 3 FWD
  (FRF, 2RF, LK), 3 OB (FB, WG, CE), 1 Flex (any), 6 bench. Only starters
  score.
- **Scoring:** any of 46 nrl.com stats (not minutes played or match points) (catalogue in packages/shared). Site
  default (admin panel → Scoring & permissions) starts at run metres 0.1/m,
  tackles 0.25, tries 8, try assists 4, goals 2, errors -4: the balanced set
  from the 2026 analysis. New leagues copy the site default; existing leagues
  keep theirs. The admin chooses what commissioners may change (scoring and
  which stats, squad, pick timer, format); league size is always theirs. Site
  admins aren't limited.
- **Non-playing starters:** ordered emergencies. The first bench player in the
  manager's emergency order who is eligible for the slot and played comes in.
- **Lineup lock:** per player at their match's kickoff.
- **Leagues:** 4-12 teams, default 8. Head-to-head with top-4 finals or no
  finals, or a total-points ladder. Commissioners choose the round the season
  ends (12-27, default 27), because playoff-bound clubs rest players late: the
  grand final with finals (semis the round before), otherwise the last round.
- **Ladder ties:** wins (draw = half), points for, head-to-head, points against.
- **Ownership:** a player is on at most one team per league; a user can be in
  many leagues.
- **Hosting (free):** Vercel (web), Render free (API + draft sockets; wake it
  before drafts), Neon free (Postgres), GitHub Actions (scraper cron).
- **Auth:** Better Auth with Google. Users live in our own database.

## Data sources

- nrl.com has no public JSON API, but every draw and match-centre page embeds
  the JSON it was rendered from in a `q-data` attribute. The importer
  (`packages/nrl`) fetches pages with plain `fetch` and parses that JSON. No
  Playwright needed.
- One match page gives the team list before kickoff and full player stats
  after, with nrl.com's own player, club and match IDs. The draw gives UTC
  kickoff times and byes.
- nrl.com quirks handled: a cookie-less "browser" request is bounced through
  a sign-in probe (avoided with `Accept: */*` and the `nrl_sso_probed`
  cookie), and the stats' `goals` field is always 0 (goals = conversions +
  penalty goals).
- Positions: derived from where a player started in their latest season
  (25%+ of starts or 3+ starts). Players who never start get the position
  from their nrl.com profile.
- Seed data: the 2026 season is backfilled from nrl.com. The old 2020-2026
  CSVs aren't imported (no player IDs, so cross-season name matching would be
  fragile).
- Schedule: GitHub Actions runs `nrl:import --current` (current + previous
  round) Tue/Wed for team lists and hourly on match days.

## Milestones

1. Scaffold: workspaces, TypeScript, Vitest, CI, README.
2. Data: Prisma schema for NRL data, CSV importer, live scraper (team lists,
   draw, match stats), raw scrape storage, re-runnable per round.
3. Scoring package: player points, team scores with emergencies, ladder and
   tiebreakers, fixtures, finals. Pure and unit tested.
4. Auth and leagues: Google login, profile, create/join via invite, settings.
5. Draft room: server-authoritative engine, Socket.io, queue, autopick,
   commissioner tools, reconnect handling.
6. Season play: lineups with locks, byes and emergencies, weekly scoring,
   matchups, ladder, finals.
7. Seed script and sample league, README, deploy.

## Post-MVP

Auction drafts, waivers/free agents, trades, chat, activity feed,
notifications, mock drafts, public leagues.
