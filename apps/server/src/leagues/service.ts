import { randomInt } from "node:crypto";
import type { Prisma, PrismaClient } from "@nrl/db";
import {
  LeagueSettings,
  applyCommissionerLimits,
  leagueDefaults,
  type CreateLeagueInput,
  type DraftOrderMode,
  type InvitePreview,
  type LeagueDetail,
  type LeagueStatus,
  type LeagueSummary,
  type UpdateLeagueInput,
} from "@nrl/shared";
import type { SessionUser } from "../auth.ts";
import { AppError, conflict, forbidden, notFound } from "../errors.ts";
import { getSiteConfig } from "../siteConfig.ts";

// No 0/O/1/I/L, so codes survive being read out or typed from a phone.
const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newInviteCode(length = 8): string {
  let code = "";
  for (let i = 0; i < length; i++) code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  return code;
}

export function defaultTeamName(userName: string): string {
  const first = userName.trim().split(/\s+/)[0] || "My";
  return `${first}'s Team`.slice(0, 30);
}

const leagueWithTeams = {
  teams: { include: { owner: true }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.LeagueInclude;
type LeagueWithTeams = Prisma.LeagueGetPayload<{ include: typeof leagueWithTeams }>;

export interface LeagueServiceOptions {
  now?: () => Date;
  shuffle?: (teamIds: string[]) => string[];
  /** Told whenever a league's scheduled draft time is set or cleared. */
  onDraftAtChange?: (leagueId: string, draftAt: Date | null) => void;
}

/** A draft can be scheduled no sooner than this from now. */
const MIN_DRAFT_LEAD_MS = 60_000;

export class LeagueService {
  private readonly now: () => Date;
  private readonly shuffle: (teamIds: string[]) => string[];

  constructor(
    private readonly db: PrismaClient,
    private readonly opts: LeagueServiceOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.shuffle = opts.shuffle ?? shuffleArray;
  }

  private checkDraftAt(draftAt: string | null | undefined): Date | null | undefined {
    if (draftAt === undefined || draftAt === null) return draftAt;
    const at = new Date(draftAt);
    if (at.getTime() < this.now().getTime() + MIN_DRAFT_LEAD_MS) {
      throw new AppError(400, "draft_in_past", "Pick a draft time in the future");
    }
    return at;
  }

  /**
   * Keep the draft order in step with the teams: drop teams that left, add
   * new ones at the end, and in "randomise when full" mode, draw and lock the
   * order the moment the league fills.
   */
  private async reconcileDraftOrder(tx: Prisma.TransactionClient, leagueId: string, actorId: string | null) {
    const league = await tx.league.findUniqueOrThrow({ where: { id: leagueId }, include: leagueWithTeams });
    const settings = LeagueSettings.parse(league.settings);
    const teamIds = league.teams.map((t) => t.id);
    let order = league.draftOrder.filter((id) => teamIds.includes(id));
    for (const id of teamIds) if (!order.includes(id)) order.push(id);
    let locked = league.draftOrderLocked;

    if (league.draftOrderMode === "randomWhenFull" && !locked) {
      order = [];
      if (teamIds.length >= settings.teamCount) {
        order = this.shuffle(teamIds);
        locked = true;
        await tx.auditLog.create({ data: { leagueId, actorId, action: "draft.order.drawn", payload: { order } } });
      }
    }
    if (order.join() !== league.draftOrder.join() || locked !== league.draftOrderLocked) {
      await tx.league.update({ where: { id: leagueId }, data: { draftOrder: order, draftOrderLocked: locked } });
    }
  }

  /**
   * Settings as the site allows this user to have them: anything commissioners
   * may not change comes from `base` (site defaults for a new league, the
   * league's current settings for an edit). Site admins aren't limited.
   */
  private async allowedSettings(user: SessionUser, wanted: LeagueSettings, base?: LeagueSettings) {
    if (user.isAdmin) return wanted;
    const config = await getSiteConfig(this.db);
    return applyCommissionerLimits(wanted, base ?? leagueDefaults(config).settings, config);
  }

  async create(user: SessionUser, input: CreateLeagueInput): Promise<LeagueDetail> {
    const settings = await this.allowedSettings(user, input.settings);
    const draftAt = this.checkDraftAt(input.draftAt) ?? null;
    const league = await this.db.$transaction(async (tx) => {
      const created = await tx.league.create({
        data: {
          name: input.name,
          season: input.season,
          commissionerId: user.id,
          inviteCode: await this.uniqueInviteCode(tx),
          settings,
          draftAt,
          draftOrderMode: input.draftOrderMode ?? "randomWhenFull",
          teams: { create: { ownerId: user.id, name: input.teamName ?? defaultTeamName(user.name) } },
        },
      });
      await this.reconcileDraftOrder(tx, created.id, user.id);
      await tx.auditLog.create({
        data: { leagueId: created.id, actorId: user.id, action: "league.create", payload: { name: input.name } },
      });
      return tx.league.findUniqueOrThrow({ where: { id: created.id }, include: leagueWithTeams });
    });
    if (draftAt) this.opts.onDraftAtChange?.(league.id, draftAt);
    return toDetail(league, user.id);
  }

  async listMine(user: SessionUser): Promise<LeagueSummary[]> {
    const leagues = await this.db.league.findMany({
      where: { teams: { some: { ownerId: user.id } } },
      include: leagueWithTeams,
      orderBy: { createdAt: "desc" },
    });
    return leagues.map((l) => toSummary(l, user.id));
  }

  async get(user: SessionUser, leagueId: string): Promise<LeagueDetail> {
    const league = await this.loadForMember(user, leagueId);
    return toDetail(league, user.id);
  }

  async update(user: SessionUser, leagueId: string, input: UpdateLeagueInput): Promise<LeagueDetail> {
    const league = await this.loadForMember(user, leagueId);
    if (league.commissionerId !== user.id) throw forbidden("Only the commissioner can change league settings");
    const changesDraft = input.draftAt !== undefined || input.draftOrderMode !== undefined;
    if ((input.settings || changesDraft) && league.status !== "setup") {
      throw conflict("league_started", "Settings are locked once the draft has started");
    }
    if (input.draftOrderMode === "manual" && league.draftOrderLocked) {
      throw conflict("order_locked", "The draft order was drawn when the league filled and is locked");
    }
    const draftAt = this.checkDraftAt(input.draftAt);
    if (input.settings) {
      if (input.settings.teamCount < league.teams.length) {
        throw conflict("too_many_teams", `${league.teams.length} teams have already joined`);
      }
    }
    const settings = input.settings
      ? await this.allowedSettings(user, input.settings, LeagueSettings.parse(league.settings))
      : undefined;
    await this.db.$transaction(async (tx) => {
      await tx.league.update({
        where: { id: leagueId },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(settings ? { settings } : {}),
          ...(draftAt !== undefined ? { draftAt } : {}),
          ...(input.draftOrderMode ? { draftOrderMode: input.draftOrderMode } : {}),
        },
      });
      // A smaller league or a mode change can mean the order is due to be drawn.
      await this.reconcileDraftOrder(tx, leagueId, user.id);
      await tx.auditLog.create({
        data: { leagueId, actorId: user.id, action: "league.update", payload: input as Prisma.InputJsonValue },
      });
    });
    if (draftAt !== undefined) this.opts.onDraftAtChange?.(leagueId, draftAt);
    return this.get(user, leagueId);
  }

  /** Commissioner arranges the order (manual mode, before the draft). */
  async setDraftOrder(user: SessionUser, leagueId: string, teamIds: string[]): Promise<LeagueDetail> {
    const league = await this.orderEditable(user, leagueId);
    const current = league.teams.map((t) => t.id);
    const valid = teamIds.length === current.length && new Set(teamIds).size === teamIds.length && teamIds.every((id) => current.includes(id));
    if (!valid) throw new AppError(400, "bad_order", "The order must list every team exactly once");
    await this.db.$transaction([
      this.db.league.update({ where: { id: leagueId }, data: { draftOrder: teamIds } }),
      this.db.auditLog.create({ data: { leagueId, actorId: user.id, action: "draft.order.set", payload: { teamIds } } }),
    ]);
    return this.get(user, leagueId);
  }

  /** Shuffle the order now (manual mode); the commissioner can still rearrange it. */
  async randomiseDraftOrder(user: SessionUser, leagueId: string): Promise<LeagueDetail> {
    const league = await this.orderEditable(user, leagueId);
    const order = this.shuffle(league.teams.map((t) => t.id));
    await this.db.$transaction([
      this.db.league.update({ where: { id: leagueId }, data: { draftOrder: order } }),
      this.db.auditLog.create({ data: { leagueId, actorId: user.id, action: "draft.order.randomised", payload: { order } } }),
    ]);
    return this.get(user, leagueId);
  }

  private async orderEditable(user: SessionUser, leagueId: string) {
    const league = await this.loadForMember(user, leagueId);
    if (league.commissionerId !== user.id) throw forbidden("Only the commissioner can set the draft order");
    if (league.status !== "setup") throw conflict("league_started", "The draft has already started");
    if (league.draftOrderLocked) throw conflict("order_locked", "The draft order was drawn when the league filled and is locked");
    if ((league.draftOrderMode as DraftOrderMode) !== "manual") {
      throw conflict("order_random", "Switch the draft order to manual to arrange it");
    }
    return league;
  }

  async regenerateInvite(user: SessionUser, leagueId: string): Promise<LeagueDetail> {
    const league = await this.loadForMember(user, leagueId);
    if (league.commissionerId !== user.id) throw forbidden("Only the commissioner can reset the invite link");
    await this.db.league.update({ where: { id: leagueId }, data: { inviteCode: await this.uniqueInviteCode(this.db) } });
    await this.db.auditLog.create({ data: { leagueId, actorId: user.id, action: "league.invite.reset" } });
    return this.get(user, leagueId);
  }

  async previewInvite(user: SessionUser, code: string): Promise<InvitePreview> {
    const league = await this.db.league.findUnique({
      where: { inviteCode: code.toUpperCase() },
      include: { ...leagueWithTeams, commissioner: true },
    });
    if (!league) throw notFound("Invite");
    const settings = LeagueSettings.parse(league.settings);
    const alreadyMember = league.teams.some((t) => t.ownerId === user.id);
    const reason =
      league.status !== "setup" ? "started" : league.teams.length >= settings.teamCount ? "full" : undefined;
    return {
      leagueId: league.id,
      name: league.name,
      season: league.season,
      commissionerName: league.commissioner.name,
      teamsJoined: league.teams.length,
      teamCount: settings.teamCount,
      canJoin: !alreadyMember && !reason,
      alreadyMember,
      ...(reason ? { reason } : {}),
    };
  }

  async join(user: SessionUser, code: string, teamName?: string): Promise<LeagueDetail> {
    const leagueId = await this.db.$transaction(
      async (tx) => {
        // Lock the league row (an UPDATE holds a row lock until commit) so two
        // people can't take the last spot at once.
        const locked = await tx.league.updateMany({
          where: { inviteCode: code.toUpperCase() },
          data: { updatedAt: new Date() },
        });
        if (locked.count === 0) throw notFound("Invite");
        const { id } = await tx.league.findUniqueOrThrow({
          where: { inviteCode: code.toUpperCase() },
          select: { id: true },
        });
        const league = await tx.league.findUniqueOrThrow({ where: { id }, include: leagueWithTeams });
        const settings = LeagueSettings.parse(league.settings);

        if (league.teams.some((t) => t.ownerId === user.id)) {
          throw conflict("already_member", "You're already in this league");
        }
        if (league.status !== "setup") throw conflict("league_started", "This league has already drafted");
        if (league.teams.length >= settings.teamCount) throw conflict("league_full", "This league is full");

        const name = uniqueName(teamName ?? defaultTeamName(user.name), league.teams.map((t) => t.name));
        if (teamName && name !== teamName.trim()) {
          throw conflict("team_name_taken", `There's already a team called "${teamName.trim()}"`);
        }
        await tx.team.create({ data: { leagueId: id, ownerId: user.id, name } });
        await tx.auditLog.create({ data: { leagueId: id, actorId: user.id, action: "team.join", payload: { name } } });
        await this.reconcileDraftOrder(tx, id, user.id);
        return id;
      },
    );
    return this.get(user, leagueId);
  }

  async renameTeam(user: SessionUser, teamId: string, name: string) {
    const team = await this.db.team.findUnique({ where: { id: teamId } });
    if (!team) throw notFound("Team");
    if (team.ownerId !== user.id) throw forbidden("That's not your team");
    try {
      await this.db.team.update({ where: { id: teamId }, data: { name } });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        throw conflict("team_name_taken", `There's already a team called "${name}"`);
      }
      throw err;
    }
    return this.get(user, team.leagueId);
  }

  private async loadForMember(user: SessionUser, leagueId: string): Promise<LeagueWithTeams> {
    const league = await this.db.league.findUnique({ where: { id: leagueId }, include: leagueWithTeams });
    // Non-members get a 404 rather than a 403, so league ids don't leak.
    if (!league || !league.teams.some((t) => t.ownerId === user.id)) throw notFound("League");
    return league;
  }

  private async uniqueInviteCode(tx: Prisma.TransactionClient | PrismaClient): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const code = newInviteCode();
      if (!(await tx.league.findUnique({ where: { inviteCode: code } }))) return code;
    }
    throw new AppError(500, "invite_code", "Couldn't generate an invite code");
  }
}

/** "Sam's Team" -> "Sam's Team 2" if taken. */
export function uniqueName(wanted: string, taken: readonly string[]): string {
  const base = wanted.trim();
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 27)} ${n}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

function toSummary(league: LeagueWithTeams, userId: string): LeagueSummary {
  const settings = LeagueSettings.parse(league.settings);
  const mine = league.teams.find((t) => t.ownerId === userId);
  if (!mine) throw notFound("League");
  return {
    id: league.id,
    name: league.name,
    season: league.season,
    status: league.status as LeagueStatus,
    teamCount: settings.teamCount,
    teamsJoined: league.teams.length,
    myTeamId: mine.id,
    isCommissioner: league.commissionerId === userId,
  };
}

function toDetail(league: LeagueWithTeams, userId: string): LeagueDetail {
  const teamIds = new Set(league.teams.map((t) => t.id));
  return {
    ...toSummary(league, userId),
    settings: LeagueSettings.parse(league.settings),
    draftAt: league.draftAt?.toISOString() ?? null,
    draftOrderMode: league.draftOrderMode as DraftOrderMode,
    draftOrder: league.draftOrder.filter((id) => teamIds.has(id)),
    draftOrderLocked: league.draftOrderLocked,
    inviteCode: league.inviteCode,
    teams: league.teams.map((t) => ({
      id: t.id,
      name: t.name,
      owner: { id: t.owner.id, name: t.owner.name, image: t.owner.image },
      isCommissioner: t.ownerId === league.commissionerId,
    })),
  };
}

export function shuffleArray<T>(xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
