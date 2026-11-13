import type { Prisma, PrismaClient } from "@nrl/db";
import {
  effectivePositions,
  squadSize,
  tradesCloseRound,
  type ProposeTradeInput,
  type TradePlayer,
  type TradeStatus,
  type TradeView,
  type TradesView,
} from "@nrl/shared";
import type { SessionUser } from "../auth.ts";
import { AppError, conflict, forbidden, notFound } from "../errors.ts";
import type { RosterService } from "../roster/service.ts";
import type { SeasonContext, SeasonService } from "../season/service.ts";

type Tx = Prisma.TransactionClient;
type TradeRow = Awaited<ReturnType<PrismaClient["trade"]["findFirstOrThrow"]>>;

/** How long an accepted trade is open for review before it goes through. */
export const TRADE_REVIEW_HOURS = 24;

/**
 * Trades: one manager proposes, the other accepts or rejects. Accepted trades
 * are reviewed for a day: other managers can vote (so their view is visible),
 * the commissioner can approve straight away or veto. Without a veto the
 * trade goes through when the review ends, once none of its players are
 * mid-game. Trades close when the deadline round starts.
 */
export class TradeService {
  private readonly now: () => Date;

  constructor(
    private readonly db: PrismaClient,
    private readonly season: SeasonService,
    private readonly roster: RosterService,
    opts: { now?: () => Date } = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    roster.settlers.push((tx, leagueId) => this.settle(tx, leagueId));
  }

  // ---- Reads ---------------------------------------------------------------------

  async list(user: SessionUser, leagueId: string): Promise<TradesView> {
    await this.roster.settle(leagueId);
    const ctx = await this.season.context(leagueId);
    const me = this.roster.memberTeam(ctx, user);
    const isCommissioner = ctx.league.commissionerId === user.id;
    const trades = await this.db.trade.findMany({
      where: { leagueId },
      include: { votes: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    const ids = [...ctx.teams.flatMap((t) => t.squad.map((p) => p.id)), ...trades.flatMap((t) => [...t.givePlayerIds, ...t.getPlayerIds])];
    const players = await this.players(this.db, ids);
    const team = new Map(ctx.teams.map((t) => [t.id, t.name]));
    const closed = this.closed(ctx);
    const close = tradesCloseRound(ctx.settings);

    const view = (t: (typeof trades)[number]): TradeView => {
      // An offer still waiting at the deadline can't happen any more.
      const expired = t.status === "proposed" && closed;
      const status = (expired ? "failed" : t.status) as TradeStatus;
      const party = t.proposerTeamId === me.id || t.receiverTeamId === me.id;
      const vote = t.votes.find((v) => v.teamId === me.id);
      return {
        id: t.id,
        status,
        createdAt: t.createdAt.toISOString(),
        reviewEndsAt: t.reviewEndsAt?.toISOString() ?? null,
        completedAt: t.completedAt?.toISOString() ?? null,
        message: t.message,
        note: expired ? "Trades closed before it was answered" : t.note,
        proposer: { teamId: t.proposerTeamId, name: team.get(t.proposerTeamId) ?? "A team" },
        receiver: { teamId: t.receiverTeamId, name: team.get(t.receiverTeamId) ?? "A team" },
        give: t.givePlayerIds.map((id) => players.get(id)!).filter(Boolean),
        get: t.getPlayerIds.map((id) => players.get(id)!).filter(Boolean),
        votes: {
          approve: t.votes.filter((v) => v.approve).map((v) => team.get(v.teamId) ?? "A team"),
          veto: t.votes.filter((v) => !v.approve).map((v) => team.get(v.teamId) ?? "A team"),
        },
        myVote: vote ? vote.approve : null,
        can: {
          accept: status === "proposed" && t.receiverTeamId === me.id && !closed,
          reject: status === "proposed" && t.receiverTeamId === me.id,
          cancel: status === "proposed" && t.proposerTeamId === me.id,
          vote: status === "review" && !party,
          approve: status === "review" && isCommissioner,
          veto: status === "review" && isCommissioner,
        },
      };
    };

    return {
      leagueId,
      myTeamId: me.id,
      isCommissioner,
      deadline: close === null ? null : { round: close, closed },
      reviewHours: TRADE_REVIEW_HOURS,
      teams: ctx.teams.map((t) => ({ id: t.id, name: t.name, squad: t.squad.map((p) => players.get(p.id)!).filter(Boolean) })),
      trades: trades.map(view),
    };
  }

  // ---- Changes ------------------------------------------------------------------

  async propose(user: SessionUser, leagueId: string, input: ProposeTradeInput): Promise<void> {
    await this.roster.inLeague(leagueId, async (tx) => {
      const ctx = await this.season.context(leagueId, tx);
      const from = this.ownTeam(ctx, user, input.fromTeamId);
      const to = ctx.teams.find((t) => t.id === input.toTeamId);
      if (!to) throw notFound("Team");
      this.checkOpen(ctx);
      this.checkPlayers(ctx, from.id, to.id, input.give, input.get);
      await tx.trade.create({
        data: {
          leagueId, proposerTeamId: from.id, receiverTeamId: to.id, givePlayerIds: input.give, getPlayerIds: input.get,
          message: input.message || null, createdAt: this.now(),
        },
      });
    });
  }

  async respond(user: SessionUser, leagueId: string, tradeId: string, action: "accept" | "reject" | "cancel"): Promise<void> {
    await this.roster.inLeague(leagueId, async (tx) => {
      const ctx = await this.season.context(leagueId, tx);
      const trade = await this.trade(tx, leagueId, tradeId);
      if (trade.status !== "proposed") throw conflict("trade_not_open", "That trade has already been answered");
      const now = this.now();
      if (action === "cancel") {
        this.ownTeam(ctx, user, trade.proposerTeamId);
        await tx.trade.update({ where: { id: tradeId }, data: { status: "cancelled", respondedAt: now } });
        return;
      }
      this.ownTeam(ctx, user, trade.receiverTeamId);
      if (action === "reject") {
        await tx.trade.update({ where: { id: tradeId }, data: { status: "rejected", respondedAt: now } });
        return;
      }
      this.checkOpen(ctx);
      this.checkPlayers(ctx, trade.proposerTeamId, trade.receiverTeamId, trade.givePlayerIds, trade.getPlayerIds);
      await tx.trade.update({
        where: { id: tradeId },
        data: { status: "review", respondedAt: now, reviewEndsAt: new Date(now.getTime() + TRADE_REVIEW_HOURS * 3_600_000) },
      });
    });
  }

  /** Another manager's view on a trade in review. */
  async vote(user: SessionUser, leagueId: string, tradeId: string, approve: boolean): Promise<void> {
    await this.roster.inLeague(leagueId, async (tx) => {
      const ctx = await this.season.context(leagueId, tx);
      const me = this.roster.memberTeam(ctx, user);
      const trade = await this.trade(tx, leagueId, tradeId);
      if (trade.status !== "review") throw conflict("trade_not_in_review", "That trade isn't up for review");
      if (me.id === trade.proposerTeamId || me.id === trade.receiverTeamId) throw forbidden("You're part of this trade");
      await tx.tradeVote.upsert({
        where: { tradeId_teamId: { tradeId, teamId: me.id } },
        create: { tradeId, teamId: me.id, approve, createdAt: this.now() },
        update: { approve },
      });
    });
  }

  /** The commissioner's call: approve now, or veto. */
  async decide(user: SessionUser, leagueId: string, tradeId: string, approve: boolean, note?: string): Promise<void> {
    await this.roster.inLeague(leagueId, async (tx) => {
      const ctx = await this.season.context(leagueId, tx);
      this.roster.memberTeam(ctx, user);
      if (ctx.league.commissionerId !== user.id) throw forbidden("Only the commissioner can do that");
      const trade = await this.trade(tx, leagueId, tradeId);
      if (trade.status !== "review") throw conflict("trade_not_in_review", "That trade isn't up for review");
      if (!approve) {
        await tx.trade.update({ where: { id: tradeId }, data: { status: "vetoed", note: note || "Vetoed by the commissioner" } });
        await tx.auditLog.create({ data: { leagueId, actorId: user.id, action: "trade.veto", payload: { tradeId } } });
        return;
      }
      // Ends the review now; it goes through straight away unless a player is mid-game.
      const ready = { ...trade, reviewEndsAt: this.now() };
      await tx.trade.update({ where: { id: tradeId }, data: { reviewEndsAt: ready.reviewEndsAt } });
      await this.complete(tx, ctx, ready);
    });
  }

  // ---- Settling --------------------------------------------------------------------

  /** Trades whose review is over go through (or fail); offers die at the deadline. */
  private async settle(tx: Tx, leagueId: string) {
    const due = await tx.trade.findMany({
      where: { leagueId, OR: [{ status: "review", reviewEndsAt: { lte: this.now() } }, { status: "proposed" }] },
      orderBy: { reviewEndsAt: "asc" },
    });
    if (due.length === 0) return;
    const league = await tx.league.findUniqueOrThrow({ where: { id: leagueId }, select: { status: true } });
    if (league.status !== "inSeason") return;
    for (const trade of due) {
      const ctx = await this.season.context(leagueId, tx);
      if (trade.status === "proposed") {
        if (this.closed(ctx)) {
          await tx.trade.update({ where: { id: trade.id }, data: { status: "failed", note: "Trades closed before it was answered" } });
        }
        continue;
      }
      await this.complete(tx, ctx, trade);
    }
  }

  /** Make the trade, if it still can be. Waits while any player is mid-game this round. */
  private async complete(tx: Tx, ctx: SeasonContext, trade: TradeRow) {
    const fail = (note: string) => tx.trade.update({ where: { id: trade.id }, data: { status: "failed", note } });
    if (this.closed(ctx)) return fail("The trade deadline passed before it went through");
    try {
      this.checkPlayers(ctx, trade.proposerTeamId, trade.receiverTeamId, trade.givePlayerIds, trade.getPlayerIds);
    } catch (err) {
      return fail(err instanceof Error ? err.message : "It can't go through any more");
    }
    if ([...trade.givePlayerIds, ...trade.getPlayerIds].some((id) => this.season.isLocked(ctx, id))) return; // after the round

    // Release first (a player can only be on one team at a time), then add.
    const leagueId = ctx.league.id;
    await this.roster.changeSquad(tx, ctx, trade.proposerTeamId, { remove: trade.givePlayerIds, add: [], via: "trade" });
    await this.roster.changeSquad(tx, await this.season.context(leagueId, tx), trade.receiverTeamId, {
      remove: trade.getPlayerIds, add: trade.givePlayerIds, via: "trade",
    });
    await this.roster.changeSquad(tx, await this.season.context(leagueId, tx), trade.proposerTeamId, {
      remove: [], add: trade.getPlayerIds, via: "trade",
    });
    const now = this.now();
    await tx.trade.update({ where: { id: trade.id }, data: { status: "completed", completedAt: now } });
    // Other open trades with these players can't happen now.
    const moved = [...trade.givePlayerIds, ...trade.getPlayerIds];
    await tx.trade.updateMany({
      where: {
        leagueId, id: { not: trade.id }, status: { in: ["proposed", "review"] },
        OR: [{ givePlayerIds: { hasSome: moved } }, { getPlayerIds: { hasSome: moved } }],
      },
      data: { status: "failed", note: "Some of these players were traded elsewhere" },
    });
    await tx.auditLog.create({
      data: {
        leagueId, actorId: null, action: "trade.complete",
        payload: {
          tradeId: trade.id,
          teams: [
            { teamId: trade.proposerTeamId, gets: trade.getPlayerIds },
            { teamId: trade.receiverTeamId, gets: trade.givePlayerIds },
          ],
        },
      },
    });
  }

  // ---- Checks --------------------------------------------------------------------------

  /** Has the deadline round started? */
  private closed(ctx: SeasonContext): boolean {
    const close = tradesCloseRound(ctx.settings);
    return ctx.league.status !== "inSeason" || (close !== null && this.season.started(ctx, close));
  }

  private checkOpen(ctx: SeasonContext) {
    if (this.closed(ctx)) throw conflict("trades_closed", "Trades are closed for the season");
  }

  /** Each side owns what it gives, and neither squad ends up too big. */
  private checkPlayers(ctx: SeasonContext, fromId: string, toId: string, give: number[], get: number[]) {
    const from = ctx.teams.find((t) => t.id === fromId);
    const to = ctx.teams.find((t) => t.id === toId);
    if (!from || !to) throw notFound("Team");
    if (new Set([...give, ...get]).size !== give.length + get.length) throw new AppError(400, "bad_trade", "A player is listed twice");
    const owns = (team: typeof from, ids: number[]) => ids.every((id) => team.squad.some((p) => p.id === id));
    if (!owns(from, give)) throw conflict("not_in_squad", `A player is no longer in ${from.name}'s squad`);
    if (!owns(to, get)) throw conflict("not_in_squad", `A player is no longer in ${to.name}'s squad`);
    const max = squadSize(ctx.settings.roster);
    if (from.squad.length - give.length + get.length > max) throw conflict("squad_full", `${from.name} would have too many players: drop someone first`);
    if (to.squad.length - get.length + give.length > max) throw conflict("squad_full", `${to.name} would have too many players: they need to drop someone first`);
  }

  /** The user's own team (trades are between managers, not the commissioner). */
  private ownTeam(ctx: SeasonContext, user: SessionUser, teamId: string) {
    const team = ctx.teams.find((t) => t.id === teamId);
    if (!team) throw notFound("Team");
    if (team.ownerId !== user.id) throw forbidden("That's not your team");
    if (ctx.league.status !== "inSeason") throw conflict("season_over", "The season is over");
    return team;
  }

  private async trade(tx: Tx, leagueId: string, tradeId: string) {
    const trade = await tx.trade.findFirst({ where: { id: tradeId, leagueId } });
    if (!trade) throw notFound("Trade");
    return trade;
  }

  private async players(db: Tx | PrismaClient, ids: number[]): Promise<Map<number, TradePlayer>> {
    const rows = await db.player.findMany({ where: { id: { in: [...new Set(ids)] } }, include: { club: true } });
    return new Map(
      rows.map((p) => [p.id, { id: p.id, name: `${p.firstName} ${p.lastName}`, positions: effectivePositions(p), club: p.club?.nickName ?? null }]),
    );
  }
}
