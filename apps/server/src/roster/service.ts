import type { Prisma, PrismaClient } from "@nrl/db";
import { playerPoints } from "@nrl/scoring";
import {
  LeagueSettings,
  effectivePositions,
  playerSlug,
  reconcileLineup,
  resolveWaivers,
  squadSize,
  statLineFromRaw,
  swapSpots,
  waiverClearings,
  type ActivityItem,
  type AddPlayerInput,
  type ClaimView,
  type LeaguePlayer,
  type Lineup,
  type PlayerSeasonRound,
  type PlayerSeasonView,
  type PlayersView,
  type SquadPlayer,
} from "@nrl/shared";
import type { SessionUser } from "../auth.ts";
import { rankingSeason, seasonTotals } from "../draft/rankings.ts";
import { AppError, conflict, forbidden, notFound } from "../errors.ts";
import type { SeasonContext, SeasonService } from "../season/service.ts";

type Tx = Prisma.TransactionClient;
type Via = "freeAgent" | "waiver" | "trade";

const bad = (code: string, message: string) => new AppError(400, code, message);

/**
 * Squad changes during the season: free-agent pickups, drops and waiver
 * claims (trades use `changeSquad` too). Every change runs under the league's
 * lock, after anything that's due (waivers that have cleared) is settled.
 */
export class RosterService {
  private readonly now: () => Date;

  constructor(
    private readonly db: PrismaClient,
    private readonly season: SeasonService,
    opts: { now?: () => Date } = {},
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  // ---- Settling what's due ------------------------------------------------------

  /** Hooks run under the league lock before every read and change (trades add theirs). */
  readonly settlers: Array<(tx: Tx, leagueId: string) => Promise<void>> = [(tx, id) => this.settleWaivers(tx, id)];

  /** Runs first in `settle` (a test season catches its games up with the clock). */
  beforeSettle: ((leagueId: string) => Promise<void>) | null = null;

  /** Settle anything due for a league. Cheap when there's nothing to do. */
  async settle(leagueId: string): Promise<void> {
    await this.beforeSettle?.(leagueId);
    if (!(await this.anythingDue(leagueId))) return;
    await this.inLeague(leagueId, async () => {});
  }

  private async anythingDue(leagueId: string): Promise<boolean> {
    const now = this.now();
    const { last } = waiverClearings(now);
    const [claims, trades] = await Promise.all([
      this.db.waiverClaim.count({ where: { leagueId, status: "pending", createdAt: { lt: last } } }),
      this.db.trade.count({ where: { leagueId, status: "review", reviewEndsAt: { lte: now } } }),
    ]);
    return claims + trades > 0;
  }

  /** Run `fn` holding the league's lock, after settling anything due. */
  async inLeague<T>(leagueId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.$transaction(
      async (tx) => {
        // Touching the row takes its lock for the rest of the transaction.
        const locked = await tx.league.updateMany({ where: { id: leagueId }, data: { updatedAt: this.now() } });
        if (locked.count === 0) throw notFound("League");
        for (const settle of this.settlers) await settle(tx, leagueId);
        return fn(tx);
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
  }

  /** Waiver claims made before the last clearing go through now, as at that clearing. */
  private async settleWaivers(tx: Tx, leagueId: string) {
    const { last } = waiverClearings(this.now());
    const claims = await tx.waiverClaim.findMany({
      where: { leagueId, status: "pending", createdAt: { lt: last } },
      orderBy: [{ rank: "asc" }, { createdAt: "asc" }],
    });
    if (claims.length === 0) return;

    let ctx = await this.season.context(leagueId, tx);
    const order = await this.waiverOrder(tx, leagueId, ctx);
    const ids = claims.flatMap((c) => (c.dropPlayerId !== null ? [c.playerId, c.dropPlayerId] : [c.playerId]));
    const names = await this.playerNames(tx, ids);
    const clubOf = new Map(
      (await tx.player.findMany({ where: { id: { in: ids } }, select: { id: true, clubId: true } })).map((p) => [p.id, p.clubId]),
    );
    const lockedNow = await this.lockChecker(tx, ctx);
    const owners = new Map<number, string>();
    for (const t of ctx.teams) for (const p of t.squad) owners.set(p.id, t.id);

    const { outcomes, order: nextOrder } = resolveWaivers({
      order,
      claims: claims.map((c) => ({ id: c.id, teamId: c.teamId, playerId: c.playerId, dropPlayerId: c.dropPlayerId, rank: c.rank })),
      owners,
      squadSizes: new Map(ctx.teams.map((t) => [t.id, t.squad.length])),
      maxSquad: squadSize(ctx.settings.roster),
      isLocked: (id) => lockedNow(id, clubOf.get(id) ?? null),
      playerName: (id) => names.get(id) ?? `Player ${id}`,
    });

    const results = [];
    for (const c of claims) {
      const outcome = outcomes.get(c.id) ?? { status: "lost" as const, note: "Not reached" };
      if (outcome.status === "won") {
        await this.changeSquad(tx, ctx, c.teamId, { remove: c.dropPlayerId !== null ? [c.dropPlayerId] : [], add: [c.playerId], via: "waiver" });
        ctx = await this.season.context(leagueId, tx);
      }
      await tx.waiverClaim.update({
        where: { id: c.id },
        data: { status: outcome.status, note: "note" in outcome ? outcome.note : null, processedAt: this.now() },
      });
      results.push({ claimId: c.id, teamId: c.teamId, playerId: c.playerId, dropPlayerId: c.dropPlayerId, status: outcome.status });
    }
    await tx.league.update({ where: { id: leagueId }, data: { waiverOrder: nextOrder } });
    await tx.auditLog.create({ data: { leagueId, actorId: null, action: "waiver.run", payload: { clearedAt: last.toISOString(), results } } });
  }

  /** Waiver order, first in line first; starts as the reverse of the draft order. */
  private async waiverOrder(tx: Tx, leagueId: string, ctx: SeasonContext): Promise<string[]> {
    const league = await tx.league.findUniqueOrThrow({ where: { id: leagueId }, select: { waiverOrder: true, draftOrder: true } });
    const teamIds = ctx.teams.map((t) => t.id);
    const base = league.waiverOrder.length ? league.waiverOrder : [...league.draftOrder].reverse();
    // Any team missing from the stored order (shouldn't happen) goes to the back.
    return [...base.filter((id) => teamIds.includes(id)), ...teamIds.filter((id) => !base.includes(id))];
  }

  // ---- Changing a squad ---------------------------------------------------------------

  /**
   * Move players out of and into a team's squad. Rounds that have started keep
   * the squad they had (their lineups are saved first); in a round under way,
   * the new player goes into a starting spot the leaver left, if they fit, or
   * the bench.
   */
  async changeSquad(tx: Tx, ctx: SeasonContext, teamId: string, change: { remove: number[]; add: number[]; via: Via }) {
    const now = this.now();
    const save = (round: number, lineup: Lineup) =>
      tx.lineup.upsert({
        where: { teamId_round: { teamId, round } },
        create: { leagueId: ctx.league.id, teamId, round, starters: lineup.starters as Prisma.InputJsonValue, bench: lineup.bench },
        update: { starters: lineup.starters as Prisma.InputJsonValue, bench: lineup.bench },
      });
    for (const { round, lineup } of this.season.lineupsToFreeze(ctx, teamId)) await save(round, lineup);

    if (change.remove.length) {
      const released = await tx.rosterEntry.updateMany({
        where: { teamId, playerId: { in: change.remove }, releasedAt: null },
        data: { releasedAt: now },
      });
      if (released.count !== change.remove.length) throw conflict("not_in_squad", "A player has already left that squad");
    }
    for (const playerId of change.add) {
      await tx.rosterEntry.create({ data: { leagueId: ctx.league.id, teamId, playerId, acquiredVia: change.via, acquiredAt: now } });
    }
    // Other teams' claims on these players can't succeed now.
    if (change.add.length) {
      await tx.waiverClaim.updateMany({
        where: { leagueId: ctx.league.id, status: "pending", playerId: { in: change.add } },
        data: { status: "failed", note: "Picked up by another team", processedAt: now },
      });
    }

    // The round under way: update its lineup to the new squad.
    const round = this.season.currentRound(ctx);
    const team = ctx.teams.find((t) => t.id === teamId)!;
    if (round === null || !this.season.started(ctx, round)) return;
    const current = this.season.lineupFor(ctx, team, round).lineup;
    const added = await tx.player.findMany({ where: { id: { in: change.add } } });
    const squad: SquadPlayer[] = [
      ...this.season.squadFor(ctx, team, round).filter((p) => !change.remove.includes(p.id)),
      ...added.map((p) => ({ id: p.id, positions: effectivePositions(p) })),
    ];
    let next = reconcileLineup(ctx.settings.roster, squad, current);
    for (const p of added) {
      const spot = ctx.settings.roster.slots
        .flatMap((s) => (next.starters[s.key] ?? []).map((id, i) => ({ s, i, id })))
        .find(({ s, id }) => id === null && effectivePositions(p).some((pos) => s.eligible.includes(pos)));
      const benchAt = next.bench.indexOf(p.id);
      if (spot && benchAt >= 0) next = swapSpots(next, `${spot.s.key}:${spot.i}`, `bench:${benchAt}`);
    }
    await save(round, next);
  }

  // ---- Reads -------------------------------------------------------------------------

  async players(user: SessionUser, leagueId: string): Promise<PlayersView> {
    await this.settle(leagueId);
    const ctx = await this.season.context(leagueId);
    const me = this.memberTeam(ctx, user);
    const now = this.now();
    const { last, next } = waiverClearings(now);

    const prevSeason = await rankingSeason(this.db, ctx.league.season);
    const [all, current, prev, released, claims, league] = await Promise.all([
      this.db.player.findMany({
        where: { OR: [{ clubId: { not: null } }, { id: { in: [...ctx.players.keys()] } }] },
        include: { club: true },
      }),
      seasonTotals(this.db, ctx.league.season),
      prevSeason !== null && prevSeason !== ctx.league.season ? seasonTotals(this.db, prevSeason) : Promise.resolve([]),
      this.db.rosterEntry.groupBy({ by: ["playerId"], where: { leagueId, releasedAt: { gt: last } } }),
      this.db.waiverClaim.findMany({ where: { leagueId, teamId: me.id, status: "pending" }, orderBy: { rank: "asc" } }),
      this.db.league.findUniqueOrThrow({ where: { id: leagueId }, select: { waiverOrder: true, draftOrder: true } }),
    ]);

    const owners = new Map<number, string>();
    for (const t of ctx.teams) for (const p of t.squad) owners.set(p.id, t.id);
    const avg = (rows: typeof current) =>
      new Map(rows.map((t) => [t.playerId, { games: t.games, avg: round1(playerPoints(statLineFromRaw(t.raw), ctx.settings.scoring) / t.games) }]));
    const thisSeason = avg(current);
    const lastSeason = avg(prev);
    const recentlyDropped = new Set(released.map((r) => r.playerId));
    const lockedNow = await this.lockChecker(this.db, ctx);
    const kickedOffSince = this.kickoffChecker(ctx, last, now);

    const players: LeaguePlayer[] = all.map((p) => {
      const positions = effectivePositions(p);
      const owner = owners.get(p.id) ?? null;
      const onWaivers = recentlyDropped.has(p.id) || kickedOffSince(p.clubId);
      return {
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        slug: playerSlug(p.firstName, p.lastName),
        club: p.club ? { key: p.club.key, nickName: p.club.nickName } : null,
        positions,
        ownerTeamId: owner,
        availability: owner ? "owned" : onWaivers ? "waivers" : "free",
        locked: lockedNow(p.id, p.clubId),
        seasonAvg: thisSeason.get(p.id)?.avg ?? null,
        seasonGames: thisSeason.get(p.id)?.games ?? 0,
        prevAvg: lastSeason.get(p.id)?.avg ?? null,
        prevGames: lastSeason.get(p.id)?.games ?? 0,
      };
    });
    // Only list players anyone could want: owned, or who've played in either season.
    const listed = players.filter((p) => p.ownerTeamId || p.seasonGames || p.prevGames);

    const byId = new Map(all.map((p) => [p.id, p]));
    const brief = (id: number) => {
      const p = byId.get(id);
      return { id, name: p ? `${p.firstName} ${p.lastName}` : `Player ${id}`, positions: p ? effectivePositions(p) : [] };
    };
    const teamIds = ctx.teams.map((t) => t.id);
    const base = league.waiverOrder.length ? league.waiverOrder : [...league.draftOrder].reverse();
    return {
      leagueId,
      myTeamId: me.id,
      isCommissioner: ctx.league.commissionerId === user.id,
      season: ctx.league.season,
      prevSeason: prevSeason !== ctx.league.season ? prevSeason : null,
      squadMax: squadSize(ctx.settings.roster),
      teams: ctx.teams.map((t) => ({ id: t.id, name: t.name })),
      waivers: {
        lastClear: last.toISOString(),
        nextClear: next.toISOString(),
        order: [...base.filter((id) => teamIds.includes(id)), ...teamIds.filter((id) => !base.includes(id))],
      },
      players: listed,
      claims: claims.map(
        (c): ClaimView => ({ id: c.id, rank: c.rank, player: brief(c.playerId), drop: c.dropPlayerId !== null ? brief(c.dropPlayerId) : null }),
      ),
    };
  }

  /** A player's season in the league's NRL season, round by round, under its scoring. */
  async playerSeason(user: SessionUser, leagueId: string, playerId: number): Promise<PlayerSeasonView> {
    await this.settle(leagueId);
    const league = await this.db.league.findUnique({ where: { id: leagueId }, select: { season: true, settings: true } });
    if (!league) throw notFound("League");
    if (!(await this.db.team.findFirst({ where: { leagueId, ownerId: user.id }, select: { id: true } }))) throw notFound("League");
    const player = await this.db.player.findUnique({ where: { id: playerId }, select: { id: true, clubId: true, club: { select: { key: true } } } });
    if (!player) throw notFound("Player");
    const scoring = LeagueSettings.parse(league.settings).scoring;

    const [rounds, apps] = await Promise.all([
      this.db.round.findMany({
        where: { season: league.season, matches: { some: {} } },
        orderBy: { number: "asc" },
        include: { matches: { include: { homeClub: true, awayClub: true } } },
      }),
      this.db.appearance.findMany({
        where: { playerId, match: { round: { season: league.season } } },
        select: { matchId: true, clubId: true, jersey: true, minutes: true, stats: true },
      }),
    ]);
    const byMatch = new Map(apps.map((a) => [a.matchId, a]));
    const now = this.now();
    const totals = { games: 0, points: 0, minutes: 0, stats: {} as Record<string, number> };

    const out: PlayerSeasonRound[] = rounds.map((r) => {
      const app = r.matches.map((m) => byMatch.get(m.id)).find((a) => a) ?? null;
      const clubId = app?.clubId ?? player.clubId;
      const match = r.matches.find((m) => (app ? m.id === app.matchId : m.homeClubId === clubId || m.awayClubId === clubId)) ?? null;
      const home = match ? match.homeClubId === clubId : null;
      const base = {
        round: r.number,
        title: r.title,
        opponent: match ? (home ? match.awayClub.nickName : match.homeClub.nickName) : null,
        home,
        kickoffAt: match?.kickoffAt.toISOString() ?? null,
        jersey: app?.jersey ?? null,
        minutes: app?.minutes ?? null,
        points: null as number | null,
        stats: {} as Record<string, number>,
      };
      if (!match) {
        const bye = !!player.club && clubId === player.clubId && r.byeClubKeys.includes(player.club.key);
        return { ...base, state: bye ? ("bye" as const) : ("noGame" as const) };
      }
      if (match.kickoffAt > now) return { ...base, state: "upcoming" as const };
      if (!app) return { ...base, state: "notNamed" as const };
      const raw = (app.stats as Record<string, unknown> | null) ?? null;
      if (!raw || (app.minutes ?? 0) === 0) {
        return { ...base, state: match.state === "FullTime" ? ("dnp" as const) : ("live" as const) };
      }
      const line = statLineFromRaw(raw);
      const stats = Object.fromEntries(Object.entries(line).filter(([, v]) => v !== 0));
      const points = playerPoints(line, scoring);
      totals.games++;
      totals.points += points;
      totals.minutes += app.minutes ?? 0;
      for (const [k, v] of Object.entries(stats)) totals.stats[k] = (totals.stats[k] ?? 0) + v;
      return { ...base, state: match.state === "FullTime" ? ("played" as const) : ("live" as const), points, stats };
    });

    return {
      playerId,
      season: league.season,
      scoring: Object.fromEntries(Object.entries(scoring).filter(([, v]) => v)),
      rounds: out,
      totals: {
        ...totals,
        points: Math.round(totals.points * 100) / 100,
        avg: totals.games ? Math.round((totals.points / totals.games) * 10) / 10 : null,
      },
    };
  }

  async activity(user: SessionUser, leagueId: string): Promise<ActivityItem[]> {
    await this.settle(leagueId);
    const ctx = await this.season.context(leagueId);
    this.memberTeam(ctx, user);
    const logs = await this.db.auditLog.findMany({
      where: { leagueId, action: { in: ["roster.add", "roster.drop", "waiver.run", "trade.complete"] } },
      orderBy: { createdAt: "desc" },
      take: 60,
    });
    type Payload = {
      teamId?: string; playerId?: number; dropPlayerId?: number | null;
      results?: Array<{ claimId: string; teamId: string; playerId: number; dropPlayerId: number | null; status: string }>;
      teams?: Array<{ teamId: string; gets: number[] }>;
    };
    const payloads = logs.map((l) => (l.payload ?? {}) as Payload);
    const ids = payloads.flatMap((p) => [
      p.playerId, p.dropPlayerId, ...(p.results ?? []).flatMap((r) => [r.playerId, r.dropPlayerId]), ...(p.teams ?? []).flatMap((t) => t.gets),
    ]).filter((id): id is number => typeof id === "number");
    const names = await this.playerNames(this.db, ids);
    const team = new Map(ctx.teams.map((t) => [t.id, t.name]));
    const p = (id: number) => names.get(id) ?? `Player ${id}`;
    const dropping = (id: number | null | undefined) => (id ? `, dropping ${p(id)}` : "");

    return logs.flatMap((log, i): ActivityItem[] => {
      const d = payloads[i]!;
      const at = log.createdAt.toISOString();
      const t = team.get(d.teamId ?? "") ?? "A team";
      switch (log.action) {
        case "roster.add":
          return [{ id: log.id, at, kind: "add", text: `${t} picked up ${p(d.playerId!)}${dropping(d.dropPlayerId)}` }];
        case "roster.drop":
          return [{ id: log.id, at, kind: "drop", text: `${t} dropped ${p(d.playerId!)}` }];
        case "waiver.run":
          return (d.results ?? [])
            .filter((r) => r.status === "won")
            .map((r) => ({
              id: `${log.id}:${r.claimId}`, at, kind: "waiver" as const,
              text: `${team.get(r.teamId) ?? "A team"} claimed ${p(r.playerId)} off waivers${dropping(r.dropPlayerId)}`,
            }));
        case "trade.complete": {
          const [a, b] = d.teams ?? [];
          if (!a || !b) return [];
          const list = (xs: number[]) => xs.map(p).join(", ");
          return [{ id: log.id, at, kind: "trade", text: `Trade: ${team.get(a.teamId)} get ${list(a.gets)}; ${team.get(b.teamId)} get ${list(b.gets)}` }];
        }
        default:
          return [];
      }
    });
  }

  // ---- Changes -----------------------------------------------------------------------

  /** Pick up a free agent straight away (dropping someone if the squad's full). */
  async add(user: SessionUser, leagueId: string, input: AddPlayerInput): Promise<void> {
    await this.inLeague(leagueId, async (tx) => {
      const ctx = await this.season.context(leagueId, tx);
      const team = this.manageable(ctx, user, input.teamId);
      const drop = input.dropPlayerId ?? null;
      const status = await this.availability(tx, ctx, input.playerId);
      if (status === "owned") throw conflict("player_owned", "That player is already on a team");
      if (status === "waivers") throw conflict("on_waivers", "That player is on waivers: put in a claim instead");
      await this.checkMove(tx, ctx, team, input.playerId, drop);
      await this.changeSquad(tx, ctx, team.id, { remove: drop !== null ? [drop] : [], add: [input.playerId], via: "freeAgent" });
      await tx.auditLog.create({
        data: { leagueId, actorId: user.id, action: "roster.add", payload: { teamId: team.id, playerId: input.playerId, dropPlayerId: drop } },
      });
    });
  }

  async drop(user: SessionUser, leagueId: string, teamId: string, playerId: number): Promise<void> {
    await this.inLeague(leagueId, async (tx) => {
      const ctx = await this.season.context(leagueId, tx);
      const team = this.manageable(ctx, user, teamId);
      this.checkLeavingPlayer(ctx, team, playerId);
      await this.changeSquad(tx, ctx, team.id, { remove: [playerId], add: [], via: "freeAgent" });
      await tx.auditLog.create({ data: { leagueId, actorId: user.id, action: "roster.drop", payload: { teamId, playerId } } });
    });
  }

  /** Claim a player on waivers; it's settled when waivers next clear. */
  async claim(user: SessionUser, leagueId: string, input: AddPlayerInput): Promise<void> {
    await this.inLeague(leagueId, async (tx) => {
      const ctx = await this.season.context(leagueId, tx);
      const team = this.manageable(ctx, user, input.teamId);
      const status = await this.availability(tx, ctx, input.playerId);
      if (status === "owned") throw conflict("player_owned", "That player is already on a team");
      if (status === "free") throw conflict("free_agent", "That player is a free agent: add them straight away");
      const drop = input.dropPlayerId ?? null;
      if (drop !== null && !team.squad.some((p) => p.id === drop)) throw bad("not_in_squad", "That player isn't in your squad");
      const existing = await tx.waiverClaim.findMany({ where: { teamId: team.id, status: "pending" } });
      if (existing.some((c) => c.playerId === input.playerId)) throw conflict("already_claimed", "You've already claimed that player");
      await tx.waiverClaim.create({
        data: {
          leagueId, teamId: team.id, playerId: input.playerId, dropPlayerId: drop,
          rank: Math.max(0, ...existing.map((c) => c.rank)) + 1,
          createdAt: this.now(),
        },
      });
    });
  }

  async cancelClaim(user: SessionUser, leagueId: string, claimId: string): Promise<void> {
    await this.inLeague(leagueId, async (tx) => {
      const ctx = await this.season.context(leagueId, tx);
      const claim = await tx.waiverClaim.findFirst({ where: { id: claimId, leagueId, status: "pending" } });
      if (!claim) throw notFound("Claim");
      this.manageable(ctx, user, claim.teamId);
      await tx.waiverClaim.update({ where: { id: claimId }, data: { status: "cancelled", processedAt: this.now() } });
    });
  }

  async orderClaims(user: SessionUser, leagueId: string, teamId: string, claimIds: string[]): Promise<void> {
    await this.inLeague(leagueId, async (tx) => {
      const ctx = await this.season.context(leagueId, tx);
      this.manageable(ctx, user, teamId);
      const pending = await tx.waiverClaim.findMany({ where: { teamId, status: "pending" } });
      if (pending.length !== claimIds.length || !pending.every((c) => claimIds.includes(c.id))) {
        throw bad("bad_order", "List every pending claim once");
      }
      for (const [i, id] of claimIds.entries()) await tx.waiverClaim.update({ where: { id }, data: { rank: i + 1 } });
    });
  }

  // ---- Checks ------------------------------------------------------------------------

  memberTeam(ctx: SeasonContext, user: SessionUser) {
    const team = ctx.teams.find((t) => t.ownerId === user.id);
    if (!team) throw notFound("League");
    return team;
  }

  /** The team, if this user may change it: its manager, or the commissioner. */
  manageable(ctx: SeasonContext, user: SessionUser, teamId: string) {
    this.memberTeam(ctx, user);
    const team = ctx.teams.find((t) => t.id === teamId);
    if (!team) throw notFound("Team");
    if (team.ownerId !== user.id && ctx.league.commissionerId !== user.id) throw forbidden("That's not your team");
    if (ctx.league.status !== "inSeason") throw conflict("season_over", "The season is over");
    return team;
  }

  /** A player leaving a squad: they must be in it, and not mid-round. */
  checkLeavingPlayer(ctx: SeasonContext, team: SeasonContext["teams"][number], playerId: number) {
    if (!team.squad.some((p) => p.id === playerId)) throw bad("not_in_squad", "That player isn't in the squad");
    if (this.season.isLocked(ctx, playerId)) {
      throw conflict("player_locked", `${ctx.players.get(playerId)?.name ?? "That player"}'s game this round has started`);
    }
  }

  private async checkMove(tx: Tx, ctx: SeasonContext, team: SeasonContext["teams"][number], playerId: number, drop: number | null) {
    if (drop !== null) this.checkLeavingPlayer(ctx, team, drop);
    const after = team.squad.length + 1 - (drop !== null ? 1 : 0);
    if (after > squadSize(ctx.settings.roster)) throw conflict("squad_full", "Your squad is full: choose someone to drop");
    const p = await tx.player.findUnique({ where: { id: playerId } });
    if (!p) throw notFound("Player");
    if ((await this.lockChecker(tx, ctx))(playerId, p.clubId)) throw conflict("player_locked", "Their game this round has started");
  }

  private async availability(tx: Tx, ctx: SeasonContext, playerId: number) {
    if (ctx.teams.some((t) => t.squad.some((p) => p.id === playerId))) return "owned" as const;
    const player = await tx.player.findUnique({ where: { id: playerId } });
    if (!player) throw notFound("Player");
    const now = this.now();
    const { last } = waiverClearings(now);
    const dropped = await tx.rosterEntry.count({ where: { leagueId: ctx.league.id, playerId, releasedAt: { gt: last } } });
    return dropped > 0 || this.kickoffChecker(ctx, last, now)(player.clubId) ? ("waivers" as const) : ("free" as const);
  }

  /**
   * Has a club's game kicked off since `since`? Those players go on waivers
   * until the next clearing. A club on a bye has no game, so its players don't.
   */
  private kickoffChecker(ctx: SeasonContext, since: Date, now: Date) {
    const kickoffs = [...ctx.rounds.values()].flatMap((r) => {
      if (!r.firstKickoff || r.firstKickoff > now) return [];
      return [{ first: r.firstKickoff, byClub: new Map(r.matches.flatMap((m) => [[m.home.id, m.kickoffAt], [m.away.id, m.kickoffAt]] as const)) }];
    });
    return (clubId: number | null) =>
      kickoffs.some((r) => {
        const t = clubId !== null ? r.byClub.get(clubId) : undefined;
        return !!t && t > since && t <= now;
      });
  }

  /** Is a player's game in the current round under way or over? (Owned players: from their round view.) */
  private async lockChecker(_db: Tx | PrismaClient, ctx: SeasonContext) {
    const round = this.season.currentRound(ctx);
    const r = round !== null ? ctx.rounds.get(round) : undefined;
    const now = this.now();
    const clubPlays = new Map(r?.matches.flatMap((m) => [[m.home.id, m.kickoffAt], [m.away.id, m.kickoffAt]] as const) ?? []);
    return (playerId: number, clubId?: number | null) => {
      if (!r || !r.firstKickoff || r.firstKickoff > now) return false;
      if (ctx.players.has(playerId)) return this.season.isLocked(ctx, playerId);
      // No game this round (a bye): never locked.
      const t = clubId != null ? clubPlays.get(clubId) : undefined;
      return !!t && t <= now;
    };
  }

  private async playerNames(db: Tx | PrismaClient, ids: number[]): Promise<Map<number, string>> {
    const rows = await db.player.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, firstName: true, lastName: true } });
    return new Map(rows.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

