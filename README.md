# NRL Draft

Private fantasy NRL leagues for friends: snake-draft players, set weekly
lineups, score from real NRL match stats, and compete on a ladder with finals.

See [PLAN.md](PLAN.md) for the agreed design and milestones.

## Layout

| Path | What |
|---|---|
| `apps/web` | Vite + React + TypeScript + Tailwind frontend (mobile-first, dark) |
| `apps/server` | Fastify API and (soon) Socket.io draft server |
| `packages/shared` | Shared types and zod schemas: positions, league settings, defaults |

## Requirements

- Node.js 22 or newer (developed on 24)
- npm 10 or newer
- Works on Windows (PowerShell or Git Bash), macOS and Linux

## Run locally

```bash
npm install
```

Copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`), then:

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

## Environment variables

| Name | Used by | Description |
|---|---|---|
| `PORT` | server | API port (default 3001) |
| `WEB_ORIGIN` | server | Comma-separated origins allowed by CORS (default `http://localhost:5173`) |
