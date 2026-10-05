import { randomInt } from "node:crypto";
import type { Prisma, PrismaClient } from "@nrl/db";
import {
  LeagueSettings,
  applyCommissionerLimits,
  leagueDefaults,
  type CreateLeagueInput,
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

export class LeagueService {
  constructor(private readonly db: PrismaClient) {}

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
    const league = await this.db.$transaction(async (tx) => {
      const created = await tx.league.create({
        data: {
          name: input.name,
          season: input.season,
          commissionerId: user.id,
          inviteCode: await this.uniqueInviteCode(tx),
          settings,
          teams: { create: { ownerId: user.id, name: input.teamName ?? defaultTeamName(user.name) } },
        },
      });
      await tx.auditLog.create({
        data: { leagueId: created.id, actorId: user.id, action: "league.create", payload: { name: input.name } },
      });
      return tx.league.findUniqueOrThrow({ where: { id: created.id }, include: leagueWithTeams });
    });
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
    if (input.settings) {
      if (league.status !== "setup") {
        throw conflict("league_started", "Settings are locked once the draft has started");
      }
      if (input.settings.teamCount < league.teams.length) {
        throw conflict("too_many_teams", `${league.teams.length} teams have already joined`);
      }
    }
    const settings = input.settings
      ? await this.allowedSettings(user, input.settings, LeagueSettings.parse(league.settings))
      : undefined;
    await this.db.$transaction([
      this.db.league.update({
        where: { id: leagueId },
        data: { ...(input.name ? { name: input.name } : {}), ...(settings ? { settings } : {}) },
      }),
      this.db.auditLog.create({
        data: { leagueId, actorId: user.id, action: "league.update", payload: input as Prisma.InputJsonValue },
      }),
    ]);
    return this.get(user, leagueId);
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
  return {
    ...toSummary(league, userId),
    settings: LeagueSettings.parse(league.settings),
    inviteCode: league.inviteCode,
    teams: league.teams.map((t) => ({
      id: t.id,
      name: t.name,
      owner: { id: t.owner.id, name: t.owner.name, image: t.owner.image },
      isCommissioner: t.ownerId === league.commissionerId,
    })),
  };
}
