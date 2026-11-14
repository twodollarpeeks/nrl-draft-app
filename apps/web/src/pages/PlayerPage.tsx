import { useState } from "react";
import { Link, useParams } from "react-router";
import {
  STAT_ABBR,
  STAT_CATALOGUE,
  STAT_GROUPS,
  seasonLabel,
  type LeaguePlayer,
  type PlayerSeasonRound,
  type PlayerSeasonView,
  type PlayersView,
} from "@nrl/shared";
import { AppShell } from "../components/Layout.tsx";
import { PositionBadge } from "../components/Position.tsx";
import { Card, ErrorText, SectionTitle, Spinner } from "../components/ui.tsx";
import { useLeagueId } from "../lib/activeLeague.tsx";
import { usePlayerSeason, usePlayers } from "../lib/roster.ts";
import { formatKickoff, formatPoints } from "../lib/season.ts";
import { ActionDialog, PlayerAction, Status, type Action } from "./PlayersPage.tsx";

/** /players/<club>/<surname-firstname>: a player's season, round by round. */
export function PlayerPage() {
  const id = useLeagueId();
  const { club = "", slug = "" } = useParams();
  const players = usePlayers(id);
  const player = players.data?.players.find((p) => p.slug === slug && (p.club?.key ?? "no-club") === club);
  const season = usePlayerSeason(id, player?.id);

  if (players.data && !player) {
    return (
      <AppShell title="Player" back="/players" league={{ id, myTeamId: players.data.myTeamId }}>
        <Card className="text-sm text-muted">
          No player at that address. They may have changed clubs: <Link to="/players" className="text-accent">find them in Players</Link>.
        </Card>
      </AppShell>
    );
  }
  if (!players.data || !player || !season.data) {
    return (
      <AppShell title="Player" back="/players">
        {players.error || season.error ? <ErrorText error={players.error ?? season.error} /> : <Spinner />}
      </AppShell>
    );
  }
  return <Player data={players.data} player={player} season={season.data} />;
}

function Player({ data, player, season }: { data: PlayersView; player: LeaguePlayer; season: PlayerSeasonView }) {
  const [action, setAction] = useState<Action | null>(null);
  const mine = data.players.filter((p) => p.ownerTeamId === data.myTeamId);
  const isMine = player.ownerTeamId === data.myTeamId;
  const owner = data.teams.find((t) => t.id === player.ownerTeamId);
  const claimed = data.claims.some((c) => c.player.id === player.id);
  const t = season.totals;

  return (
    <AppShell title={player.name} back="/players" width="wide" league={{ id: data.leagueId, myTeamId: data.myTeamId }}>
      {/* Phones: summary, rounds, then every stat. Desktop: summary and stats on the left, rounds on the right. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-4 lg:col-start-1 lg:row-start-1">
          <Card className="flex flex-col gap-3">
            <div>
              <h1 className="text-xl font-bold">{player.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted">
                <span>{player.club?.nickName ?? "No club"}</span>
                <PositionBadge positions={player.positions} />
                <Status player={player} mine={isMine} owner={owner?.name} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <PlayerAction player={player} mine={isMine} claimed={claimed} onAction={(kind) => setAction({ kind, player })} />
              {owner && !isMine && (
                <Link
                  to={`/trades/new?with=${owner.id}`}
                  className="inline-flex min-h-10 items-center rounded-xl bg-surface-2 px-3 text-sm font-semibold hover:bg-border"
                >
                  Propose a trade
                </Link>
              )}
            </div>
          </Card>

          <Card>
            <SectionTitle>{seasonLabel(season.season)} season</SectionTitle>
            <dl className="grid grid-cols-3 gap-3 text-center">
              <Stat label="Average" value={formatPoints(t.avg)} big />
              <Stat label="Games" value={String(t.games)} big />
              <Stat label="Points" value={formatPoints(t.points)} big />
              <Stat label="Mins / game" value={t.games ? String(Math.round(t.minutes / t.games)) : "–"} />
              <Stat label="Best" value={formatPoints(best(season.rounds))} />
              {data.prevSeason && <Stat label={`${data.prevSeason} avg`} value={formatPoints(player.prevAvg)} />}
            </dl>
          </Card>
        </div>

        <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <RoundByRound season={season} />
        </div>
        <div className="lg:col-start-1 lg:row-start-2">
          <AllStats season={season} />
        </div>
      </div>
      {action && <ActionDialog data={data} action={action} mine={mine} onClose={() => setAction(null)} />}
    </AppShell>
  );
}

function best(rounds: PlayerSeasonRound[]): number | null {
  const pts = rounds.flatMap((r) => (r.points !== null ? [r.points] : []));
  return pts.length ? Math.max(...pts) : null;
}

function Stat({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`font-mono tabular-nums ${big ? "text-2xl font-bold" : "font-semibold"}`}>{value}</dd>
    </div>
  );
}

const STATE_LABEL: Partial<Record<PlayerSeasonRound["state"], string>> = {
  bye: "Bye",
  notNamed: "Not named",
  dnp: "Didn't play",
  noGame: "No game",
  live: "Live",
};

/** Every round: opponent, minutes, the stats the league scores, points. */
function RoundByRound({ season }: { season: PlayerSeasonView }) {
  // Scored stats, most valuable first, then the rest of the headline stats they recorded.
  const scored = Object.keys(season.scoring);
  const cols = STAT_CATALOGUE.map((s) => s.key).filter((k) => scored.includes(k));
  return (
    <Card className="overflow-hidden p-0">
      <div className="px-4 pt-4">
        <SectionTitle>Round by round</SectionTitle>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-muted">
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left font-medium">Rd</th>
              <th className="px-3 py-2 text-left font-medium">Opponent</th>
              <th className="px-2 py-2 text-right font-medium">Min</th>
              {cols.map((k) => (
                <th key={k} className="px-2 py-2 text-right font-medium" title={STAT_CATALOGUE.find((s) => s.key === k)?.label}>
                  {STAT_ABBR[k] ?? k}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">Pts</th>
            </tr>
          </thead>
          <tbody>
            {season.rounds.map((r) => {
              const note = STATE_LABEL[r.state];
              const played = r.state === "played" || (r.state === "live" && r.points !== null);
              return (
                <tr key={r.round} className={`border-b border-border/60 last:border-0 ${played ? "" : "text-muted"}`}>
                  <td className="px-3 py-2 font-mono">{r.round}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {r.opponent ? `${r.home ? "v" : "@"} ${r.opponent}` : "—"}
                    {r.state === "upcoming" && r.kickoffAt && <span className="ml-2 text-xs">{formatKickoff(r.kickoffAt)}</span>}
                  </td>
                  {played ? (
                    <>
                      <td className="px-2 py-2 text-right font-mono">{r.minutes ?? "–"}</td>
                      {cols.map((k) => (
                        <td key={k} className="px-2 py-2 text-right font-mono">
                          {formatPoints(r.stats[k] ?? 0)}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-mono font-semibold text-accent">{formatPoints(r.points)}</td>
                    </>
                  ) : (
                    <td colSpan={cols.length + 2} className="px-3 py-2 text-right text-xs">
                      {r.state === "upcoming" ? "" : note}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Season totals for every stat they've recorded, grouped, with per-game averages. */
function AllStats({ season }: { season: PlayerSeasonView }) {
  const { games, stats } = season.totals;
  if (!games) return null;
  return (
    <Card>
      <SectionTitle>Season stats</SectionTitle>
      <div className="flex flex-col gap-3">
        {STAT_GROUPS.map((group) => {
          const rows = STAT_CATALOGUE.filter((s) => s.group === group && stats[s.key]);
          if (!rows.length) return null;
          return (
            <div key={group}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{group}</div>
              <dl className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-0.5 text-sm">
                {rows.map((s) => (
                  <div key={s.key} className="contents">
                    <dt className={season.scoring[s.key] ? "" : "text-muted"}>{s.label}</dt>
                    <dd className="text-right font-mono tabular-nums">{formatPoints(stats[s.key]!)}</dd>
                    <dd className="w-14 text-right font-mono text-xs tabular-nums text-muted">{formatPoints(Math.round((stats[s.key]! / games) * 10) / 10)}/g</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
        <p className="text-xs text-muted">Stats in white count for points in this league.</p>
      </div>
    </Card>
  );
}
