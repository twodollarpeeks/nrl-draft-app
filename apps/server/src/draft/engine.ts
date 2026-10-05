import type { Prisma, PrismaClient } from "@nrl/db";
import {
  LeagueSettings,
  checkDraftable,
  chooseAutopick,
  roundOf,
  squadSize,
  teamForPick,
  type DraftPlayer,
  type DraftState,
  type DraftStatus,
  type NrlPosition,
} from "@nrl/shared";
import type { SessionUser } from "../auth.ts";
import { AppError, conflict, forbidden, notFound } from "../errors.ts";
import { loadDraftPlayers } from "./rankings.ts";
import { DraftTimers } from "./timers.ts";

type Tx = Prisma.TransactionClient;
type DraftRow = Prisma.DraftGetPayload<object>;

/** A team on autopilot is picked for after this short pause, not its full clock. */
export const AUTOPILOT_DELAY_MS = 3000;
const RANKINGS_TTL_MS = 10 * 60_000;

export interface DraftEngineOptions {
  now?: () => Date;
  /** Called after every committed change, with the new public state. */
  onChange?: (state: DraftState) => void;
  timers?: DraftTimers;
  log?: { error(obj: unknown, msg?: string): void; info(obj: unknown, msg?: string): void };
}

/**
 * The draft room's single source of truth. Every change runs in a database
 * transaction that first bumps the draft's version, which takes a row lock:
 * concurrent picks queue up behind each other and each re-checks the state
 * the previous one left behind. Unique constraints on (draft, pickNo) and
 * (draft, player) are the last line of defence against double picks.
 */
export class DraftEngine {
  private readonly now: () => Date;
  private readonly timers: DraftTimers;
  private readonly rankings = new Map<string, { at: number; players: DraftPlayer[] }>();

  constructor(
    private readonly db: PrismaClient,
    private readonly opts: DraftEngineOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.timers =
      opts.timers ??
      new DraftTimers(
        (draftId, pickNo) => void this.autopickIfDue(draftId, pickNo),
        () => this.now().getTime(),
      );
  }

  // ---- Reads --------------------------------------------------------------

  async state(user: SessionUser, leagueId: string): Promise<DraftState> {
    await this.memberTeam(user, leagueId);
    return this.publicState(leagueId);
  }

  async players(user: SessionUser, leagueId: string): Promise<DraftPlayer[]> {
    await this.memberTeam(user, leagueId);
    return this.rankedPlayers(leagueId);
  }

  async queue(user: SessionUser, leagueId: string): Promise<number[]> {
    const team = await this.memberTeam(user, leagueId);
    const draft = await this.ensureDraft(leagueId);
    const items = await this.db.draftQueueItem.findMany({
      where: { draftId: draft.id, teamId: team.id },
      orderBy: { rank: "asc" },
    });
    return items.map((i) => i.playerId);
  }

  // ---- Manager actions ----------------------------------------------------

  async setQueue(user: SessionUser, leagueId: string, playerIds: number[]): Promise<number[]> {
    const team = await this.memberTeam(user, leagueId);
    const draft = await this.ensureDraft(leagueId);
    if (draft.status === "complete") throw conflict("draft_complete", "The draft is over");
    const unique = [...new Set(playerIds)];
    const pool = new Set((await this.rankedPlayers(leagueId)).map((p) => p.id));
    const unknown = unique.find((id) => !pool.has(id));
    if (unknown !== undefined) throw new AppError(400, "unknown_player", `Player ${unknown} isn't in this draft`);

    await this.db.$transaction([
      this.db.draftQueueItem.deleteMany({ where: { draftId: draft.id, teamId: team.id } }),
      this.db.draftQueueItem.createMany({
        data: unique.map((playerId, rank) => ({ draftId: draft.id, teamId: team.id, playerId, rank })),
      }),
    ]);
    return unique;
  }

  async pick(user: SessionUser, leagueId: string, input: { pickNo: number; playerId: number }): Promise<DraftState> {
    const team = await this.memberTeam(user, leagueId);
    const league = await this.leagueWithSettings(leagueId);
    const ranked = await this.rankedPlayers(leagueId);
    const isCommissioner = league.commissionerId === user.id;

    await this.mutate(leagueId, async (tx, draft) => {
      if (draft.status === "pending") throw conflict("draft_not_started", "The draft hasn't started");
      if (draft.status === "paused") throw conflict("draft_paused", "The draft is paused");
      if (draft.status === "complete") throw conflict("draft_complete", "The draft is over");
      if (input.pickNo !== draft.currentPick) {
        throw conflict("stale_pick", "That pick has already been made. The board has been refreshed.");
      }
      const onClock = teamForPick(draft.order, draft.currentPick);
      if (onClock !== team.id && !isCommissioner) throw conflict("not_your_turn", "It's not your turn");

      const madeBy = onClock === team.id ? "manager" : "commissioner";
      await this.recordPick(tx, draft, league.settings, ranked, onClock, input.playerId, madeBy, user.id);
      // Picking for yourself means you're here: switch autopilot off.
      const autopilotTeamIds = madeBy === "manager" ? draft.autopilotTeamIds.filter((t) => t !== onClock) : draft.autopilotTeamIds;
      return this.advance(tx, draft, league.settings, { autopilotTeamIds });
    });
    return this.publicState(leagueId);
  }

  async setAutopilot(user: SessionUser, leagueId: string, on: boolean): Promise<DraftState> {
    const team = await this.memberTeam(user, leagueId);
    await this.mutate(leagueId, async (tx, draft) => {
      const set = new Set(draft.autopilotTeamIds);
      if (on) set.add(team.id);
      else set.delete(team.id);
      const data: Prisma.DraftUpdateInput = { autopilotTeamIds: [...set] };
      // Turning it on while on the clock: pick shortly instead of waiting out the clock.
      if (on && draft.status === "live" && teamForPick(draft.order, draft.currentPick) === team.id) {
        const soon = new Date(this.now().getTime() + AUTOPILOT_DELAY_MS);
        if (!draft.deadline || draft.deadline > soon) data.deadline = soon;
      }
      return tx.draft.update({ where: { id: draft.id }, data });
    });
    return this.publicState(leagueId);
  }

  // ---- Commissioner actions -----------------------------------------------

  async start(user: SessionUser, leagueId: string, shuffle: (teamIds: string[]) => string[] = shuffleArray): Promise<DraftState> {
    const league = await this.leagueWithSettings(leagueId);
    this.requireCommissioner(user, league);
    if (league.teams.length < 2) throw conflict("not_enough_teams", "You need at least 2 teams to draft");
    if ((await this.rankedPlayers(leagueId)).length === 0) {
      throw conflict("no_players", "There's no player data for this season yet");
    }

    await this.mutate(leagueId, async (tx, draft) => {
      if (draft.status !== "pending") throw conflict("draft_started", "The draft has already started");
      const order = shuffle(league.teams.map((t) => t.id));
      const settings = { ...league.settings, teamCount: order.length };
      // Lock in the league: its size is whoever joined, and rules can't change.
      await tx.league.update({ where: { id: leagueId }, data: { status: "drafting", settings } });
      await tx.auditLog.create({ data: { leagueId, actorId: user.id, action: "draft.start", payload: { order } } });
      return tx.draft.update({
        where: { id: draft.id },
        data: {
          status: "live",
          order,
          pickSeconds: settings.draft.pickSeconds,
          totalPicks: order.length * squadSize(settings.roster),
          currentPick: 1,
          startedAt: this.now(),
          deadline: this.deadlineFor(order[0]!, settings.draft.pickSeconds, draft.autopilotTeamIds),
        },
      });
    });
    return this.publicState(leagueId);
  }

  async pause(user: SessionUser, leagueId: string): Promise<DraftState> {
    const league = await this.leagueWithSettings(leagueId);
    this.requireCommissioner(user, league);
    await this.mutate(leagueId, async (tx, draft) => {
      if (draft.status !== "live") throw conflict("not_live", "The draft isn't running");
      const remaining = Math.max(0, (draft.deadline?.getTime() ?? 0) - this.now().getTime());
      await tx.auditLog.create({ data: { leagueId, actorId: user.id, action: "draft.pause" } });
      return tx.draft.update({ where: { id: draft.id }, data: { status: "paused", deadline: null, pausedRemainingMs: remaining } });
    });
    return this.publicState(leagueId);
  }

  async resume(user: SessionUser, leagueId: string): Promise<DraftState> {
    const league = await this.leagueWithSettings(leagueId);
    this.requireCommissioner(user, league);
    await this.mutate(leagueId, async (tx, draft) => {
      if (draft.status !== "paused") throw conflict("not_paused", "The draft isn't paused");
      // At least 10 seconds, so nobody gets autopicked the instant it resumes.
      const remaining = Math.max(draft.pausedRemainingMs ?? 0, 10_000);
      await tx.auditLog.create({ data: { leagueId, actorId: user.id, action: "draft.resume" } });
      return tx.draft.update({
        where: { id: draft.id },
        data: { status: "live", deadline: new Date(this.now().getTime() + remaining), pausedRemainingMs: null },
      });
    });
    return this.publicState(leagueId);
  }

  /** Take back the most recent pick; that team is back on the clock with a full timer. */
  async undo(user: SessionUser, leagueId: string): Promise<DraftState> {
    const league = await this.leagueWithSettings(leagueId);
    this.requireCommissioner(user, league);
    await this.mutate(leagueId, async (tx, draft) => {
      if (draft.status === "pending") throw conflict("draft_not_started", "The draft hasn't started");
      const last = await tx.draftPick.findFirst({ where: { draftId: draft.id }, orderBy: { pickNo: "desc" } });
      if (!last) throw conflict("no_picks", "There are no picks to undo");
      await tx.draftPick.delete({ where: { id: last.id } });
      await tx.rosterEntry.deleteMany({
        where: { leagueId, teamId: last.teamId, playerId: last.playerId, acquiredVia: "draft" },
      });
      if (draft.status === "complete") await tx.league.update({ where: { id: leagueId }, data: { status: "drafting" } });
      await tx.auditLog.create({
        data: { leagueId, actorId: user.id, action: "draft.undo", payload: { pickNo: last.pickNo, playerId: last.playerId } },
      });
      const paused = draft.status === "paused";
      return tx.draft.update({
        where: { id: draft.id },
        data: {
          status: paused ? "paused" : "live",
          currentPick: last.pickNo,
          completedAt: null,
          // Don't autopick the undone team straight back.
          autopilotTeamIds: draft.autopilotTeamIds.filter((t) => t !== last.teamId),
          deadline: paused ? null : new Date(this.now().getTime() + draft.pickSeconds * 1000),
          pausedRemainingMs: paused ? draft.pickSeconds * 1000 : null,
        },
      });
    });
    return this.publicState(leagueId);
  }

  // ---- Clock ----------------------------------------------------------------

  /**
   * Called when a deadline passes. Re-checks everything under the lock, so a
   * late, duplicate or stale timer does nothing. A team that runs out of time
   * goes on autopilot until its manager turns it off.
   */
  async autopickIfDue(draftId: string, pickNo: number): Promise<boolean> {
    try {
      const draft = await this.db.draft.findUnique({ where: { id: draftId } });
      if (!draft) return false;
      const league = await this.leagueWithSettings(draft.leagueId);
      const ranked = await this.rankedPlayers(draft.leagueId);
      let picked = false;
      await this.mutate(draft.leagueId, async (tx, d) => {
        if (d.status !== "live" || d.currentPick !== pickNo || !d.deadline || d.deadline > this.now()) {
          throw new NoChange();
        }
        const teamId = teamForPick(d.order, d.currentPick);
        const queue = await tx.draftQueueItem.findMany({
          where: { draftId: d.id, teamId },
          orderBy: { rank: "asc" },
          select: { playerId: true },
        });
        const taken = new Set((await tx.draftPick.findMany({ where: { draftId: d.id }, select: { playerId: true } })).map((p) => p.playerId));
        const roster = await this.rosterPositions(tx, d.id, teamId, ranked);
        const positionsById = new Map(ranked.map((p) => [p.id, p.positions]));
        const choice = chooseAutopick({
          template: league.settings.roster,
          roster,
          queue: queue.map((q) => q.playerId),
          ranked: ranked.map((p) => p.id),
          isAvailable: (id) => !taken.has(id),
          positionsOf: (id) => positionsById.get(id) ?? [],
        });
        if (choice === null) {
          // Nobody fits (shouldn't happen with a real player pool): pause for the commissioner.
          this.opts.log?.error({ draftId, pickNo, teamId }, "autopick found no eligible player; pausing draft");
          return tx.draft.update({ where: { id: d.id }, data: { status: "paused", deadline: null, pausedRemainingMs: d.pickSeconds * 1000 } });
        }
        await this.recordPick(tx, d, league.settings, ranked, teamId, choice, "autopick", null);
        picked = true;
        const autopilotTeamIds = d.autopilotTeamIds.includes(teamId) ? d.autopilotTeamIds : [...d.autopilotTeamIds, teamId];
        return this.advance(tx, d, league.settings, { autopilotTeamIds });
      });
      return picked;
    } catch (err) {
      if (err instanceof NoChange) return false;
      this.opts.log?.error({ err, draftId, pickNo }, "autopick failed");
      // Try again shortly rather than leaving the draft stuck.
      const d = await this.db.draft.findUnique({ where: { id: draftId } }).catch(() => null);
      if (d?.status === "live" && d.deadline) this.timers.schedule(d.id, d.currentPick, new Date(this.now().getTime() + 5000));
      return false;
    }
  }

  /** On server start: re-arm the clock for every running draft (autopicking any that expired). */
  async recover(): Promise<number> {
    const live = await this.db.draft.findMany({ where: { status: "live" } });
    for (const d of live) if (d.deadline) this.timers.schedule(d.id, d.currentPick, d.deadline);
    return live.length;
  }

  shutdown() {
    this.timers.cancelAll();
  }

  // ---- Internals --------------------------------------------------------------

  /**
   * Run a change under the draft's row lock, then re-arm the clock and tell
   * everyone. `fn` returns the updated draft row.
   */
  private async mutate(leagueId: string, fn: (tx: Tx, draft: DraftRow) => Promise<DraftRow>): Promise<DraftRow> {
    await this.ensureDraft(leagueId);
    const updated = await this.db.$transaction(
      async (tx) => {
        // Bumping the version takes the row lock for the rest of the transaction.
        const draft = await tx.draft.update({ where: { leagueId }, data: { version: { increment: 1 } } });
        return fn(tx, draft);
      },
      { timeout: 20_000, maxWait: 20_000 },
    );
    if (updated.status === "live" && updated.deadline) this.timers.schedule(updated.id, updated.currentPick, updated.deadline);
    else this.timers.cancel(updated.id);
    this.opts.onChange?.(await this.publicState(leagueId));
    return updated;
  }

  private async recordPick(
    tx: Tx,
    draft: DraftRow,
    settings: LeagueSettings,
    ranked: DraftPlayer[],
    teamId: string,
    playerId: number,
    madeBy: "manager" | "autopick" | "commissioner",
    userId: string | null,
  ) {
    const player = ranked.find((p) => p.id === playerId);
    if (!player) throw new AppError(400, "unknown_player", "That player isn't in this draft");
    if (await tx.draftPick.findUnique({ where: { draftId_playerId: { draftId: draft.id, playerId } } })) {
      throw conflict("player_taken", `${player.name} has already been drafted`);
    }
    const roster = await this.rosterPositions(tx, draft.id, teamId, ranked);
    const check = checkDraftable(settings.roster, roster, player.positions);
    if (!check.ok) throw conflict("cant_draft", check.reason);

    await tx.draftPick.create({
      data: {
        draftId: draft.id, pickNo: draft.currentPick, round: roundOf(draft.order.length, draft.currentPick),
        teamId, playerId, madeBy, userId,
      },
    });
    await tx.rosterEntry.create({ data: { leagueId: draft.leagueId, teamId, playerId, acquiredVia: "draft" } });
    await tx.draftQueueItem.deleteMany({ where: { draftId: draft.id, playerId } });
  }

  /** Move to the next pick, or finish the draft. */
  private async advance(tx: Tx, draft: DraftRow, settings: LeagueSettings, extra: { autopilotTeamIds: string[] }) {
    const next = draft.currentPick + 1;
    if (next > draft.totalPicks) {
      await tx.league.update({ where: { id: draft.leagueId }, data: { status: "inSeason" } });
      await tx.auditLog.create({ data: { leagueId: draft.leagueId, action: "draft.complete" } });
      return tx.draft.update({
        where: { id: draft.id },
        data: { status: "complete", currentPick: next, deadline: null, completedAt: this.now(), ...extra },
      });
    }
    const nextTeam = teamForPick(draft.order, next);
    return tx.draft.update({
      where: { id: draft.id },
      data: { currentPick: next, deadline: this.deadlineFor(nextTeam, settings.draft.pickSeconds, extra.autopilotTeamIds), ...extra },
    });
  }

  private deadlineFor(teamId: string, pickSeconds: number, autopilot: readonly string[]): Date {
    const ms = autopilot.includes(teamId) ? Math.min(AUTOPILOT_DELAY_MS, pickSeconds * 1000) : pickSeconds * 1000;
    return new Date(this.now().getTime() + ms);
  }

  private async rosterPositions(tx: Tx, draftId: string, teamId: string, ranked: DraftPlayer[]): Promise<NrlPosition[][]> {
    const picks = await tx.draftPick.findMany({ where: { draftId, teamId }, select: { playerId: true } });
    const byId = new Map(ranked.map((p) => [p.id, p.positions]));
    return picks.map((p) => byId.get(p.playerId) ?? []);
  }

  async publicState(leagueId: string): Promise<DraftState> {
    const draft = await this.ensureDraft(leagueId);
    const [teams, picks] = await Promise.all([
      this.db.team.findMany({ where: { leagueId }, include: { owner: true } }),
      this.db.draftPick.findMany({ where: { draftId: draft.id }, orderBy: { pickNo: "asc" } }),
    ]);
    const byId = new Map(teams.map((t) => [t.id, t]));
    const orderIds = draft.order.length ? draft.order : teams.map((t) => t.id);
    const status = draft.status as DraftStatus;
    const rounds = draft.order.length ? draft.totalPicks / draft.order.length : 0;
    return {
      leagueId,
      status,
      pickSeconds: draft.pickSeconds,
      order: orderIds.flatMap((id) => {
        const t = byId.get(id);
        return t ? [{ id: t.id, name: t.name, ownerName: t.owner.name, ownerImage: t.owner.image }] : [];
      }),
      rounds,
      totalPicks: draft.totalPicks,
      currentPick: draft.currentPick,
      onClockTeamId: status === "live" || status === "paused" ? teamForPick(draft.order, draft.currentPick) : null,
      deadline: draft.deadline?.toISOString() ?? null,
      pausedRemainingMs: draft.pausedRemainingMs,
      picks: picks.map((p) => ({
        pickNo: p.pickNo, round: p.round, teamId: p.teamId, playerId: p.playerId,
        madeBy: p.madeBy as "manager" | "autopick" | "commissioner",
      })),
      autopilotTeamIds: draft.autopilotTeamIds,
      version: draft.version,
      serverNow: this.now().toISOString(),
    };
  }

  /** The league's draft row, created (pending) on first use so queues work before the draft. */
  private async ensureDraft(leagueId: string): Promise<DraftRow> {
    const existing = await this.db.draft.findUnique({ where: { leagueId } });
    if (existing) return existing;
    const league = await this.leagueWithSettings(leagueId);
    return this.db.draft.upsert({
      where: { leagueId },
      create: { leagueId, status: "pending", pickSeconds: league.settings.draft.pickSeconds, order: [], totalPicks: 0 },
      update: {},
    });
  }

  private async rankedPlayers(leagueId: string): Promise<DraftPlayer[]> {
    const cached = this.rankings.get(leagueId);
    if (cached && this.now().getTime() - cached.at < RANKINGS_TTL_MS) return cached.players;
    const league = await this.leagueWithSettings(leagueId);
    const players = await loadDraftPlayers(this.db, league.season, league.settings.scoring);
    this.rankings.set(leagueId, { at: this.now().getTime(), players });
    return players;
  }

  async memberTeam(user: SessionUser, leagueId: string) {
    const team = await this.db.team.findUnique({ where: { leagueId_ownerId: { leagueId, ownerId: user.id } } });
    if (!team) throw notFound("League");
    return team;
  }

  private async leagueWithSettings(leagueId: string) {
    const league = await this.db.league.findUnique({ where: { id: leagueId }, include: { teams: { orderBy: { createdAt: "asc" } } } });
    if (!league) throw notFound("League");
    return { ...league, settings: LeagueSettings.parse(league.settings) };
  }

  private requireCommissioner(user: SessionUser, league: { commissionerId: string }) {
    if (league.commissionerId !== user.id) throw forbidden("Only the commissioner can do that");
  }
}

class NoChange extends Error {}

export function shuffleArray<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

