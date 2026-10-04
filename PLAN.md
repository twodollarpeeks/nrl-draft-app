# Plan

Agreed 2026-10-05. This file records the decisions behind the build; update it
when a decision changes.

## Decisions

- **Draft:** snake only for MVP (auction later, schema leaves room). No
  third-round reversal. Default pick timer 60s, configurable per league.
- **Autopick:** queue first, then best available player who fits an open
  slot. A team that misses a pick stays on autopilot until its manager turns
  it off.
- **Squad (default, commissioner-editable):** 1 HB/HK (HB, FE, HK), 3 FWD
  (FRF, 2RF, LK), 3 OB (FB, WG, CE), 1 Flex (any), 6 bench. Only starters
  score.
- **Scoring (default, editable):** run metres 0.1/m, tackles 1, tries 6, try
  assists 4, goals 2 (conversions + penalty goals), errors -4.
- **Non-playing starters:** ordered emergencies. The first bench player in the
  manager's emergency order who is eligible for the slot and played comes in.
- **Lineup lock:** per player at their match's kickoff.
- **Leagues:** 4-12 teams, default 8. Head-to-head with top-4 finals (semis
  round 26, grand final round 27) or a total-points ladder.
- **Ladder ties:** wins (draw = half), points for, head-to-head, points against.
- **Ownership:** a player is on at most one team per league; a user can be in
  many leagues.
- **Hosting (free):** Vercel (web), Render free (API + draft sockets; wake it
  before drafts), Neon free (Postgres), GitHub Actions (scraper cron).
- **Auth:** Better Auth with Google. Users live in our own database.

## Data sources

- nrl.com has no JSON API for draw or match-centre data; stats are parsed from
  server-rendered HTML with Playwright (approach proven in the Python
  `nrl_stats_scraper.py`).
- Historical per-match stats for 2020-2026 already exist as CSVs (one per
  match). An importer loads them for seed data and pre-draft rankings.
- Team lists: port the parser from the `nrl-team-lists` project.

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
