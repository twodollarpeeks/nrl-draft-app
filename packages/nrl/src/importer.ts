import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { Prisma, PrismaClient } from "@nrl/db";
import { HttpError, PoliteFetcher, consoleLogger, type Logger } from "./http.ts";
import {
  drawUrl,
  parseDraw,
  parseMatch,
  profilePaths,
  type ParsedMatch,
} from "./normalise.ts";
import { extractProfilePosition } from "./qdata.ts";
import { derivePositions, positionFromLabel, type Start } from "./positions.ts";

export interface ImportOptions {
  /** Re-fetch every match page, even settled ones. */
  force?: boolean;
  now?: Date;
}

export interface ImportSummary {
  season: number;
  round: number;
  found: boolean;
  matches: number;
  matchPagesFetched: number;
  appearances: number;
  playersUpdated: number;
}

// Team lists are published about a week out; stats keep being corrected for a
// few days after full time. Outside that window a match page isn't re-fetched.
const TEAM_LIST_LEAD_MS = 8 * 24 * 3600_000;
const SETTLED_AFTER_MS = 7 * 24 * 3600_000;

export class NrlImporter {
  private readonly log: Logger;

  constructor(
    private readonly db: PrismaClient,
    private readonly http: PoliteFetcher = new PoliteFetcher(),
    logger: Logger = consoleLogger,
  ) {
    this.log = logger;
  }

  /** Import (or re-import) one round. Safe to run any number of times. */
  async importRound(season: number, round: number, opts: ImportOptions = {}): Promise<ImportSummary> {
    const run = await this.db.importRun.create({ data: { season, round, status: "running" } });
    try {
      const summary = await this.doImportRound(season, round, opts);
      await this.db.importRun.update({
        where: { id: run.id },
        data: { status: "ok", finishedAt: new Date(), summary: { ...summary } },
      });
      return summary;
    } catch (err) {
      await this.db.importRun.update({
        where: { id: run.id },
        data: { status: "error", finishedAt: new Date(), error: String((err as Error).stack ?? err) },
      });
      throw err;
    }
  }

  private async doImportRound(season: number, roundNo: number, opts: ImportOptions): Promise<ImportSummary> {
    const now = opts.now ?? new Date();
    const summary: ImportSummary = {
      season, round: roundNo, found: false, matches: 0,
      matchPagesFetched: 0, appearances: 0, playersUpdated: 0,
    };

    const url = drawUrl(season, roundNo);
    this.log.info(`${season} round ${roundNo}: fetching draw`);
    const draw = parseDraw(await this.http.getText(url), season, roundNo);
    if (!draw) {
      this.log.info(`${season} round ${roundNo}: not on nrl.com, skipping`);
      return summary;
    }
    summary.found = true;
    await this.storeRaw(url, "draw", draw.rawJson);

    for (const c of draw.clubs) await this.upsertClub(c);
    const round = await this.db.round.upsert({
      where: { season_number: { season, number: roundNo } },
      create: draw.round,
      update: draw.round,
    });

    const existingByUrl = new Map(
      (await this.db.match.findMany({ where: { url: { in: draw.matches.map((m) => m.url) } } })).map(
        (m) => [m.url, m],
      ),
    );
    const touchedPlayers = new Set<number>();
    for (const m of draw.matches) {
      summary.matches++;
      const existing = existingByUrl.get(m.url);
      const kickoff = m.kickoffAt.getTime();
      const teamListOut = kickoff - now.getTime() < TEAM_LIST_LEAD_MS;
      const settled =
        existing?.state === "FullTime" &&
        existing.lastFetchedAt !== null &&
        existing.lastFetchedAt.getTime() > kickoff + SETTLED_AFTER_MS;

      if (!teamListOut || (settled && !opts.force)) {
        // Keep kickoff/state fresh from the draw without fetching the match page.
        if (existing) {
          await this.db.match.update({
            where: { id: existing.id },
            data: { kickoffAt: m.kickoffAt, state: m.state, homeScore: m.homeScore, awayScore: m.awayScore, venue: m.venue },
          });
        }
        continue;
      }

      this.log.info(`  ${m.url}`);
      const parsed = parseMatch(await this.http.getText(m.url));
      summary.matchPagesFetched++;
      await this.storeRaw(m.url, "match", parsed.rawJson);
      await this.saveMatch(round.id, parsed, now);
      summary.appearances += parsed.appearances.length;
      parsed.players.forEach((p) => touchedPlayers.add(p.id));
    }

    await this.db.round.update({ where: { id: round.id }, data: { lastImportedAt: now } });

    summary.playersUpdated = await this.refreshPlayers([...touchedPlayers]);
    this.log.info(
      `${season} round ${roundNo}: ${summary.matches} matches, ${summary.matchPagesFetched} pages fetched, ` +
        `${summary.appearances} appearances`,
    );
    return summary;
  }

  private async upsertClub(c: { id: number; key: string; nickName: string; name?: string }) {
    await this.db.club.upsert({
      where: { id: c.id },
      create: c,
      update: { key: c.key, nickName: c.nickName, ...(c.name ? { name: c.name } : {}) },
    });
  }

  private async saveMatch(roundId: string, p: ParsedMatch, now: Date) {
    for (const c of p.clubs) await this.upsertClub(c);
    const pl = p.players;
    await this.db.$executeRaw`
      INSERT INTO "Player" (id, "firstName", "lastName", "profileUrl", "headImage",
                            positions, "positionsOverride", "updatedAt")
      SELECT v.id, v.first_name, v.last_name, v.profile_url, v.head_image, '{}', '{}', now()
      FROM unnest(${pl.map((x) => x.id)}::int[],
                  ${pl.map((x) => x.firstName)}::text[],
                  ${pl.map((x) => x.lastName)}::text[],
                  ${pl.map((x) => x.profileUrl)}::text[],
                  ${pl.map((x) => x.headImage)}::text[])
           AS v(id, first_name, last_name, profile_url, head_image)
      ON CONFLICT (id) DO UPDATE SET
        "firstName" = EXCLUDED."firstName",
        "lastName" = EXCLUDED."lastName",
        "profileUrl" = EXCLUDED."profileUrl",
        "headImage" = EXCLUDED."headImage",
        "updatedAt" = now()`;

    const { id, ...matchData } = p.match;
    const data = { ...matchData, roundId, lastFetchedAt: now };
    await this.db.$transaction([
      this.db.match.upsert({ where: { id }, create: { id, ...data }, update: data }),
      // Replace the match's team list wholesale so late withdrawals disappear.
      this.db.appearance.deleteMany({ where: { matchId: id } }),
      this.db.appearance.createMany({
        data: p.appearances.map((a) => ({
          ...a,
          matchId: id,
          stats: (a.stats ?? undefined) as Prisma.InputJsonValue | undefined,
        })),
      }),
    ]);
  }

  /**
   * Recompute each player's current club (from their latest appearance) and
   * fantasy positions (from where they started). A player who has never
   * started keeps whatever positions they already had (see fillMissingPositions).
   */
  async refreshPlayers(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const apps = await this.db.appearance.findMany({
      where: { playerId: { in: ids } },
      select: {
        playerId: true, clubId: true, isStarter: true, positionLabel: true,
        match: { select: { kickoffAt: true, round: { select: { season: true } } } },
      },
    });

    const byPlayer = new Map<number, typeof apps>();
    for (const a of apps) {
      const list = byPlayer.get(a.playerId) ?? [];
      list.push(a);
      byPlayer.set(a.playerId, list);
    }

    const rows: { id: number; clubId: number; positions: string }[] = [];
    for (const [id, list] of byPlayer) {
      const latest = list.reduce((a, b) => (b.match.kickoffAt > a.match.kickoffAt ? b : a));
      const starts: Start[] = list.flatMap((a) => {
        const pos = a.isStarter ? positionFromLabel(a.positionLabel) : null;
        return pos ? [{ season: a.match.round.season, position: pos }] : [];
      });
      rows.push({ id, clubId: latest.clubId, positions: derivePositions(starts).join(",") });
    }

    // One statement for every player. Positions travel as comma-joined text
    // because Postgres can't unnest a ragged text[][].
    await this.db.$executeRaw`
      UPDATE "Player" AS p
      SET "clubId" = v.club_id,
          positions = CASE WHEN v.positions = '' THEN p.positions
                           ELSE string_to_array(v.positions, ',') END,
          "updatedAt" = now()
      FROM unnest(${rows.map((r) => r.id)}::int[],
                  ${rows.map((r) => r.clubId)}::int[],
                  ${rows.map((r) => r.positions)}::text[]) AS v(id, club_id, positions)
      WHERE p.id = v.id`;
    return rows.length;
  }

  /**
   * Players who have never started (e.g. bench-only forwards) have no derived
   * position, so look up the position on their nrl.com profile instead. Each
   * profile is tried once; a missing profile isn't retried on later runs.
   */
  async fillMissingPositions(season: number, maxFetches = 100): Promise<{ fetched: number; filled: number }> {
    const players = await this.db.player.findMany({
      where: {
        positions: { isEmpty: true },
        profileCheckedAt: null,
        profileUrl: { not: null },
        appearances: { some: { match: { round: { season } } } },
      },
      select: { id: true, profileUrl: true, club: { select: { key: true } } },
      take: maxFetches,
    });

    let filled = 0;
    for (const p of players) {
      const paths = p.club && p.profileUrl ? profilePaths(p.club.key, p.profileUrl) : [];
      let positions: string[] = [];
      for (const path of paths) {
        try {
          const label = extractProfilePosition(await this.http.getText(path));
          const pos = label ? positionFromLabel(label) : null;
          if (pos) positions = [pos];
          else this.log.warn(`no usable position on profile ${path} (${label ?? "none"})`);
          break;
        } catch (err) {
          if (!(err instanceof HttpError && err.status === 404)) {
            this.log.warn(`profile fetch failed for ${path}: ${(err as Error).message}`);
            break;
          }
        }
      }
      if (positions.length) filled++;
      else this.log.warn(`no profile position for player ${p.id} (tried ${paths.join(", ") || "nothing"})`);
      await this.db.player.update({ where: { id: p.id }, data: { positions, profileCheckedAt: new Date() } });
    }
    this.log.info(`profile positions: ${players.length} fetched, ${filled} filled`);
    return { fetched: players.length, filled };
  }

  private async storeRaw(url: string, kind: "draw" | "match", json: unknown) {
    const text = JSON.stringify(json);
    const contentHash = createHash("sha256").update(text).digest("hex");
    await this.db.rawScrape.createMany({
      data: [{ url, kind, contentHash, payloadGz: gzipSync(text) }],
      skipDuplicates: true,
    });
  }
}
