import type { Prisma, PrismaClient } from "@nrl/db";
import {
  finalsBracket,
  headToHeadLadder,
  playerPoints,
  pointsBreakdown,
  playerStatus,
  scoreTeamRound,
  totalPointsLadder,
  type FinalsSize,
  type PlayerRoundResult,
} from "@nrl/scoring";
import {
  LeagueSettings,
  autoLineup,
  effectivePositions,
  lineupErrors,
  movedLockedPlayers,
  reconcileLineup,
  seasonRounds,
  statLineFromRaw,
  type Lineup,
  type MatchupSide,
  type MatchupView,
  type NrlPosition,
  type PlayerNote,
  type PlayerRoundView,
  type RoundStatus,
  type RoundView,
  type SeasonOverview,
  type SquadPlayer,
  type TeamRoundView,
} from "@nrl/shared";
import type { SessionUser } from "../auth.ts";
import { AppError, conflict, forbidden, notFound } from "../errors.ts";

/** Jersey numbers from 18 up are reserves: named, but usually not used. */
const FIRST_RESERVE_JERSEY = 18;

interface MatchInfo {
  id: string;
  kickoffAt: Date;
  state: string;
  home: { id: number; key: string; nickName: string };
  away: { id: number; key: string; nickName: string };
}

interface RoundInfo {
  number: number;
  title: string;
  byeClubKeys: Set<string>;
  matches: MatchInfo[];
  firstKickoff: Date | null;
  status: RoundStatus;
}

interface AppearanceInfo {
  matchId: string;
  clubId: number;
  jersey: number;
  minutes: number | null;
  stats: Record<string, unknown> | null;
}

interface PlayerInfo {
  id: number;
  name: string;
  positions: NrlPosition[];
  club: { id: number; key: string; nickName: string } | null;
}

interface TeamInfo {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  /** Squad, best first (draft order). */
  squad: SquadPlayer[];
}

/** Everything needed to score a league's season, loaded once per request. */
interface SeasonContext {
  league: { id: string; season: number; status: string; firstRound: number; commissionerId: string };
  settings: LeagueSettings;
  rounds: Map<number, RoundInfo>;
  players: Map<number, PlayerInfo>;
  /** playerId -> round number -> appearance */
  appearances: Map<number, Map<number, AppearanceInfo>>;
  teams: TeamInfo[];
  /** Matches whose team lists are out (any player named). */
  teamListsOut: Set<string>;
  /** teamId -> round -> saved lineup */
  lineups: Map<string, Map<number, Lineup>>;
  matchups: Array<{ round: number; homeTeamId: string; awayTeamId: string }>;
  range: { firstRound: number; lastRegularRound: number; grandFinalRound: number | null; lastRound: number };
}

export class SeasonService {
  private readonly now: () => Date;

  constructor(
    private readonly db: PrismaClient,
    opts: { now?: () => Date } = {},
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  // ---- Loading -------------------------------------------------------------

  private async load(user: SessionUser, leagueId: string): Promise<SeasonContext & { myTeamId: string }> {
    const league = await this.db.league.findUnique({
      where: { id: leagueId },
      include: { teams: { include: { owner: true }, orderBy: { createdAt: "asc" } } },
    });
    const mine = league?.teams.find((t) => t.ownerId === user.id);
    if (!league || !mine) throw notFound("League");
    if (league.status !== "inSeason" && league.status !== "complete") {
      throw conflict("season_not_started", "The season starts once the draft is done");
    }
    const settings = LeagueSettings.parse(league.settings);
    const range = seasonRounds(settings.seasonEndRound, settings.matchups);
    const firstRound = league.firstRound ?? 1;

    const [rounds, roster, picks, lineups, matchups, named] = await Promise.all([
      this.db.round.findMany({
        where: { season: league.season, number: { gte: firstRound, lte: settings.seasonEndRound } },
        include: { matches: { include: { homeClub: true, awayClub: true } } },
      }),
      this.db.rosterEntry.findMany({
        where: { leagueId, releasedAt: null },
        include: { player: { include: { club: true } } },
      }),
      this.db.draftPick.findMany({ where: { draft: { leagueId } }, select: { playerId: true, pickNo: true } }),
      this.db.lineup.findMany({ where: { leagueId } }),
      this.db.matchup.findMany({ where: { leagueId } }),
      this.db.appearance.groupBy({
        by: ["matchId"],
        where: { match: { round: { season: league.season, number: { gte: firstRound, lte: settings.seasonEndRound } } } },
      }),
    ]);

    const now = this.now();
    const roundMap = new Map<number, RoundInfo>();
    for (const r of rounds) {
      const matches = r.matches.map((m) => ({
        id: m.id,
        kickoffAt: m.kickoffAt,
        state: m.state,
        home: { id: m.homeClub.id, key: m.homeClub.key, nickName: m.homeClub.nickName },
        away: { id: m.awayClub.id, key: m.awayClub.key, nickName: m.awayClub.nickName },
      }));
      const kickoffs = matches.map((m) => m.kickoffAt.getTime());
      const status: RoundStatus =
        matches.length > 0 && matches.every((m) => m.state === "FullTime")
          ? "complete"
          : kickoffs.some((k) => k <= now.getTime())
            ? "live"
            : "upcoming";
      roundMap.set(r.number, {
        number: r.number,
        title: r.title,
        byeClubKeys: new Set(r.byeClubKeys),
        matches,
        firstKickoff: kickoffs.length ? new Date(Math.min(...kickoffs)) : null,
        status,
      });
    }

    const pickNo = new Map(picks.map((p) => [p.playerId, p.pickNo]));
    const players = new Map<number, PlayerInfo>();
    const squads = new Map<string, SquadPlayer[]>();
    for (const e of roster) {
      const p = e.player;
      const positions = effectivePositions(p);
      players.set(p.id, {
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        positions,
        club: p.club ? { id: p.club.id, key: p.club.key, nickName: p.club.nickName } : null,
      });
      const list = squads.get(e.teamId) ?? [];
      list.push({ id: p.id, positions });
      squads.set(e.teamId, list);
    }
    for (const list of squads.values()) list.sort((a, b) => (pickNo.get(a.id) ?? 1e9) - (pickNo.get(b.id) ?? 1e9));

    const apps = await this.db.appearance.findMany({
      where: { playerId: { in: [...players.keys()] }, match: { round: { season: league.season } } },
      select: {
        playerId: true, matchId: true, clubId: true, jersey: true, minutes: true, stats: true,
        match: { select: { round: { select: { number: true } } } },
      },
    });
    const appearances = new Map<number, Map<number, AppearanceInfo>>();
    for (const a of apps) {
      const byRound = appearances.get(a.playerId) ?? new Map<number, AppearanceInfo>();
      byRound.set(a.match.round.number, {
        matchId: a.matchId, clubId: a.clubId, jersey: a.jersey, minutes: a.minutes,
        stats: (a.stats as Record<string, unknown> | null) ?? null,
      });
      appearances.set(a.playerId, byRound);
    }

    const lineupMap = new Map<string, Map<number, Lineup>>();
    for (const l of lineups) {
      const byRound = lineupMap.get(l.teamId) ?? new Map<number, Lineup>();
      byRound.set(l.round, { starters: l.starters as Lineup["starters"], bench: l.bench });
      lineupMap.set(l.teamId, byRound);
    }

    return {
      myTeamId: mine.id,
      league: { id: league.id, season: league.season, status: league.status, firstRound, commissionerId: league.commissionerId },
      settings,
      rounds: roundMap,
      players,
      appearances,
      teams: league.teams.map((t) => ({
        id: t.id, name: t.name, ownerId: t.ownerId, ownerName: t.owner.name, squad: squads.get(t.id) ?? [],
      })),
      lineups: lineupMap,
      teamListsOut: new Set(named.map((n) => n.matchId)),
      matchups: matchups.map((m) => ({ round: m.round, homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId })),
      range: {
        firstRound,
        lastRegularRound: range.lastRegularRound,
        grandFinalRound: range.grandFinalRound,
        lastRound: range.grandFinalRound ?? range.lastRegularRound,
      },
    };
  }

  // ---- Players and lineups ---------------------------------------------------

  /** A player's situation in a round: status for scoring, plus what to show. */
  private playerRound(ctx: SeasonContext, playerId: number, roundNo: number) {
    const now = this.now();
    const player = ctx.players.get(playerId)!;
    const round = ctx.rounds.get(roundNo);
    const app = ctx.appearances.get(playerId)?.get(roundNo) ?? null;
    const clubId = app?.clubId ?? player.club?.id ?? null;
    const clubKey = clubId === null ? null : (round?.matches.find((m) => m.home.id === clubId)?.home.key ?? round?.matches.find((m) => m.away.id === clubId)?.away.key ?? player.club?.key ?? null);
    const match = round?.matches.find((m) => m.home.id === clubId || m.away.id === clubId) ?? null;
    const bye = !!round && !match && clubKey !== null && round.byeClubKeys.has(clubKey);

    const matchStarted = !!match && match.kickoffAt <= now;
    const matchFinished = match?.state === "FullTime";
    // No draw for the round (or the club's game is missing): nothing is known yet.
    const status = !round || (!match && !bye)
      ? "pending"
      : playerStatus({ clubHasMatch: !!match, matchFinished, matchStarted, named: !!app, minutes: app?.minutes ?? null });

    const stats = app?.stats ? statLineFromRaw(app.stats) : null;
    const points = stats && (app?.minutes ?? 0) > 0 ? playerPoints(stats, ctx.settings.scoring) : null;

    let note: PlayerNote | null = null;
    if (!round || (!match && !bye)) note = "noFixture";
    else if (bye) note = "bye";
    else if (matchFinished && app && (app.minutes ?? 0) === 0) note = "didNotPlay";
    else if (!app && match && (matchStarted || ctx.teamListsOut.has(match.id))) note = "notNamed";
    else if (app && app.jersey >= FIRST_RESERVE_JERSEY && !matchFinished) note = "reserve";

    // A bye player locks with the round's first game; anyone else at their own kickoff.
    const locked = match ? matchStarted : bye ? !!round?.firstKickoff && round.firstKickoff <= now : false;

    const result: PlayerRoundResult = { status, points: points ?? 0, positions: player.positions };
    const view: PlayerRoundView = {
      id: player.id,
      name: player.name,
      club: player.club ? { key: player.club.key, nickName: player.club.nickName } : null,
      positions: player.positions,
      status,
      note,
      locked,
      jersey: app?.jersey ?? null,
      match: match
        ? {
            opponent: match.home.id === clubId ? match.away.nickName : match.home.nickName,
            home: match.home.id === clubId,
            kickoffAt: match.kickoffAt.toISOString(),
            state: match.state,
          }
        : null,
      points,
      breakdown: stats && points !== null ? pointsBreakdown(stats, ctx.settings.scoring) : [],
    };
    return { result, view };
  }

  /** The lineup a team uses in a round: saved for that round, else the latest earlier one, else automatic. */
  private lineupFor(ctx: SeasonContext, team: TeamInfo, roundNo: number): { lineup: Lineup; saved: boolean } {
    const saved = ctx.lineups.get(team.id);
    let base: Lineup | undefined = saved?.get(roundNo);
    const exact = !!base;
    if (!base && saved) {
      const earlier = [...saved.keys()].filter((r) => r < roundNo).sort((a, b) => b - a)[0];
      if (earlier !== undefined) base = saved.get(earlier);
    }
    const lineup = base
      ? reconcileLineup(ctx.settings.roster, team.squad, base)
      : autoLineup(ctx.settings.roster, team.squad);
    return { lineup, saved: exact };
  }

  private teamScore(ctx: SeasonContext, team: TeamInfo, roundNo: number) {
    const { lineup, saved } = this.lineupFor(ctx, team, roundNo);
    const results = new Map<number, PlayerRoundResult>();
    const views: PlayerRoundView[] = [];
    for (const p of team.squad) {
      const { result, view } = this.playerRound(ctx, p.id, roundNo);
      results.set(p.id, result);
      views.push(view);
    }
    const score = scoreTeamRound(ctx.settings.roster, lineup, results);
    // Until the draw is loaded nothing is final.
    const provisional = score.provisional || ctx.rounds.get(roundNo)?.status !== "complete";
    return { lineup, saved, views, score: { ...score, provisional } };
  }

  // ---- Views -------------------------------------------------------------------

  async teamRound(user: SessionUser, leagueId: string, teamId: string, roundNo: number): Promise<TeamRoundView> {
    const ctx = await this.load(user, leagueId);
    this.checkRound(ctx, roundNo);
    const team = ctx.teams.find((t) => t.id === teamId);
    if (!team) throw notFound("Team");
    const { lineup, saved, views, score } = this.teamScore(ctx, team, roundNo);
    const round = ctx.rounds.get(roundNo);
    return {
      leagueId,
      teamId,
      teamName: team.name,
      ownerName: team.ownerName,
      round: roundNo,
      roundTitle: round?.title ?? `Round ${roundNo}`,
      roundStatus: round?.status ?? "upcoming",
      editable: team.ownerId === user.id && round?.status !== "complete",
      saved,
      lineup,
      players: views,
      score: { total: score.total, provisional: score.provisional, slots: score.slots },
    };
  }

  async saveLineup(user: SessionUser, leagueId: string, teamId: string, roundNo: number, next: Lineup): Promise<TeamRoundView> {
    const ctx = await this.load(user, leagueId);
    this.checkRound(ctx, roundNo);
    const team = ctx.teams.find((t) => t.id === teamId);
    if (!team) throw notFound("Team");
    if (team.ownerId !== user.id) throw forbidden("That's not your team");
    if (ctx.rounds.get(roundNo)?.status === "complete") throw conflict("round_over", "This round is over");

    const errors = lineupErrors(ctx.settings.roster, team.squad, next);
    if (errors.length) throw new AppError(400, "bad_lineup", errors.join(". "));
    const { lineup: current } = this.lineupFor(ctx, team, roundNo);
    const moved = movedLockedPlayers(current, next, (id) => this.playerRound(ctx, id, roundNo).view.locked);
    if (moved.length) {
      const names = moved.map((id) => ctx.players.get(id)?.name ?? id).join(", ");
      throw conflict("player_locked", `${names} ${moved.length === 1 ? "has" : "have"} already kicked off and can't be moved`);
    }

    const data = { starters: next.starters as Prisma.InputJsonValue, bench: next.bench, updatedBy: user.id };
    await this.db.lineup.upsert({
      where: { teamId_round: { teamId, round: roundNo } },
      create: { leagueId, teamId, round: roundNo, ...data },
      update: data,
    });
    return this.teamRound(user, leagueId, teamId, roundNo);
  }

  async round(user: SessionUser, leagueId: string, roundNo: number): Promise<RoundView> {
    const ctx = await this.load(user, leagueId);
    this.checkRound(ctx, roundNo);
    const sides = this.sidesFor(ctx, roundNo);
    const round = ctx.rounds.get(roundNo);
    const finals = this.finals(ctx);
    const matchups =
      roundNo <= ctx.range.lastRegularRound
        ? ctx.matchups
            .filter((m) => m.round === roundNo)
            .map((m) => regularMatchup(roundNo, sides.get(m.homeTeamId)!, sides.get(m.awayTeamId)!))
        : (finals?.games.filter((g) => g.round === roundNo) ?? []);
    return {
      round: roundNo,
      title: round?.title ?? `Round ${roundNo}`,
      status: round?.status ?? "upcoming",
      matchups,
      scores: [...sides.values()].sort((a, b) => b.score - a.score),
    };
  }

  async overview(user: SessionUser, leagueId: string): Promise<SeasonOverview> {
    const ctx = await this.load(user, leagueId);
    const rounds = [];
    for (let n = ctx.range.firstRound; n <= ctx.range.lastRound; n++) {
      const r = ctx.rounds.get(n);
      rounds.push({
        number: n,
        title: r?.title ?? `Round ${n}`,
        status: r?.status ?? ("upcoming" as RoundStatus),
        finals: n > ctx.range.lastRegularRound,
        firstKickoff: r?.firstKickoff?.toISOString() ?? null,
      });
    }
    const currentRound = rounds.find((r) => r.status !== "complete")?.number ?? ctx.range.lastRound;
    const finals = this.finals(ctx);
    return {
      leagueId,
      mode: ctx.settings.matchups.mode,
      myTeamId: ctx.myTeamId,
      firstRound: ctx.range.firstRound,
      lastRegularRound: ctx.range.lastRegularRound,
      grandFinalRound: ctx.range.grandFinalRound,
      currentRound,
      rounds,
      ladder: this.ladder(ctx),
      finals: finals ? { size: finals.size, champion: finals.champion, games: finals.games } : null,
    };
  }

  // ---- Ladder and finals ---------------------------------------------------------

  /** Every team's score in a round. */
  private sidesFor(ctx: SeasonContext, roundNo: number): Map<string, MatchupSide> {
    return new Map(
      ctx.teams.map((t) => {
        const s = this.teamScore(ctx, t, roundNo).score;
        return [t.id, { teamId: t.id, name: t.name, ownerName: t.ownerName, score: s.total, provisional: s.provisional }];
      }),
    );
  }

  /** Regular-season rounds that are over. Only these count on the ladder. */
  private completedRegularRounds(ctx: SeasonContext): number[] {
    const done: number[] = [];
    for (let n = ctx.range.firstRound; n <= ctx.range.lastRegularRound; n++) {
      if (ctx.rounds.get(n)?.status === "complete") done.push(n);
    }
    return done;
  }

  private ladder(ctx: SeasonContext) {
    const teamIds = ctx.teams.map((t) => t.id);
    const byId = new Map(ctx.teams.map((t) => [t.id, t]));
    const rounds = this.completedRegularRounds(ctx);
    const scores = new Map(rounds.map((r) => [r, this.sidesFor(ctx, r)]));

    if (ctx.settings.matchups.mode === "totalPoints") {
      const rows = totalPointsLadder(
        teamIds,
        rounds.flatMap((r) => [...scores.get(r)!.values()].map((s) => ({ team: s.teamId, points: s.score }))),
      );
      return rows.map((row, i) => ({
        rank: i + 1, teamId: row.team, name: byId.get(row.team)!.name, ownerName: byId.get(row.team)!.ownerName,
        played: rounds.length, wins: 0, draws: 0, losses: 0, pointsFor: row.pointsFor, pointsAgainst: 0,
      }));
    }

    const results = ctx.matchups
      .filter((m) => scores.has(m.round))
      .map((m) => ({
        home: m.homeTeamId,
        away: m.awayTeamId,
        homePoints: scores.get(m.round)!.get(m.homeTeamId)!.score,
        awayPoints: scores.get(m.round)!.get(m.awayTeamId)!.score,
      }));
    return headToHeadLadder(teamIds, results, ctx.settings.matchups.tiebreakers).map((row, i) => ({
      rank: i + 1,
      teamId: row.team,
      name: byId.get(row.team)!.name,
      ownerName: byId.get(row.team)!.ownerName,
      played: row.played,
      wins: row.wins,
      draws: row.draws,
      losses: row.losses,
      pointsFor: row.pointsFor,
      pointsAgainst: row.pointsAgainst,
    }));
  }

  /**
   * The finals series, once the regular season is over: seeds from the
   * ladder, results from each finals round's scores (a game counts once its
   * round is complete).
   */
  private finals(ctx: SeasonContext) {
    const m = ctx.settings.matchups;
    if (m.mode !== "headToHead" || m.finalsTeams === 0 || ctx.range.grandFinalRound === null) return null;
    const size = m.finalsTeams as FinalsSize;
    const regularDone = this.completedRegularRounds(ctx).length === ctx.range.lastRegularRound - ctx.range.firstRound + 1;
    const finalsStart = ctx.range.lastRegularRound + 1;
    const byId = new Map(ctx.teams.map((t) => [t.id, t]));

    if (!regularDone || ctx.teams.length < size) {
      return { size, champion: null, games: [] as Array<MatchupView & { round: number }> };
    }
    const seeds = this.ladder(ctx).slice(0, size).map((r) => r.teamId);
    const scoreCache = new Map<number, Map<string, MatchupSide>>();
    const sides = (round: number) => {
      if (!scoreCache.has(round)) scoreCache.set(round, this.sidesFor(ctx, round));
      return scoreCache.get(round)!;
    };
    // Finals week w is played in round finalsStart + w - 1; a game counts once that round is over.
    const bracket = finalsBracket(size, seeds, (home, away, week) => {
      const round = finalsStart + week - 1;
      if (ctx.rounds.get(round)?.status !== "complete") return null;
      const s = sides(round);
      return [s.get(home)!.score, s.get(away)!.score] as const;
    });
    const games = bracket.games.map((g) => {
      const round = finalsStart + g.week - 1;
      const s = ctx.rounds.has(round) ? sides(round) : null;
      const side = (id: string | null): MatchupSide | null => {
        if (!id) return null;
        const t = byId.get(id)!;
        const x = s?.get(id);
        return { teamId: id, name: t.name, ownerName: t.ownerName, score: x?.score ?? 0, provisional: x?.provisional ?? true };
      };
      return { round, stage: g.id, label: g.label, home: side(g.home), away: side(g.away), winnerTeamId: g.winner };
    });
    return { size, champion: bracket.champion, games };
  }

  private checkRound(ctx: SeasonContext, roundNo: number) {
    if (!Number.isInteger(roundNo) || roundNo < ctx.range.firstRound || roundNo > ctx.range.lastRound) {
      throw new AppError(404, "not_found", `Round ${roundNo} isn't part of this league's season`);
    }
  }
}

function regularMatchup(round: number, home: MatchupSide, away: MatchupSide): MatchupView {
  const final = !home.provisional && !away.provisional;
  return {
    round,
    stage: "regular",
    label: `Round ${round}`,
    home,
    away,
    winnerTeamId: final && home.score !== away.score ? (home.score > away.score ? home.teamId : away.teamId) : null,
  };
}

