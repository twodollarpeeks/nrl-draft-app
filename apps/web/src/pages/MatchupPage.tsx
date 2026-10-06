import { useState } from "react";
import { Link, useParams } from "react-router";
import {
  SCORING_STAT_LABELS,
  type LeagueDetail,
  type PlayerRoundView,
  type ScoringStat,
  type TeamRoundView,
} from "@nrl/shared";
import { AppShell } from "../components/Layout.tsx";
import { LeagueNav } from "../components/LeagueNav.tsx";
import { PositionBadge } from "../components/Position.tsx";
import { Card, ErrorText, Spinner } from "../components/ui.tsx";
import { useLeague } from "../lib/queries.ts";
import { formatKickoff, formatPoints, useTeamRound } from "../lib/season.ts";

/** Head-to-head: both lineups side by side, slot by slot, with live scores. */
export function MatchupPage() {
  const { id = "", round: roundParam = "", homeId, awayId } = useParams();
  const round = Number(roundParam);
  const league = useLeague(id);
  const home = useTeamRound(id, homeId, round);
  const away = useTeamRound(id, awayId, round);

  if (!league.data || !home.data || !away.data) {
    const error = league.error ?? home.error ?? away.error;
    return (
      <AppShell title="Matchup" back={`/l/${id}/matchups/${round}`}>
        {error ? <ErrorText error={error} /> : <Spinner />}
      </AppShell>
    );
  }
  return <Matchup league={league.data} myTeamId={league.data.myTeamId} home={home.data} away={away.data} />;
}

function Matchup({ league, myTeamId, home, away }: { league: LeagueDetail; myTeamId: string; home: TeamRoundView; away: TeamRoundView }) {
  const [open, setOpen] = useState<number | null>(null);
  const homePlayers = new Map(home.players.map((p) => [p.id, p]));
  const awayPlayers = new Map(away.players.map((p) => [p.id, p]));
  const final = home.roundStatus === "complete";
  const winner = final && home.score.total !== away.score.total ? (home.score.total > away.score.total ? home.teamId : away.teamId) : null;
  const status = home.roundStatus === "live" ? "● Live" : final ? "Final" : "Upcoming";

  // One row per starting spot: who scored there for each team (an emergency if one came in).
  const rows = league.settings.roster.slots.flatMap((slot) =>
    Array.from({ length: slot.count }, (_, i) => {
      const h = home.score.slots.find((s) => s.slotKey === slot.key && s.index === i);
      const a = away.score.slots.find((s) => s.slotKey === slot.key && s.index === i);
      return { key: `${slot.key}:${i}`, label: slot.label, h, a };
    }),
  );
  const benchRows = Math.max(home.lineup.bench.length, away.lineup.bench.length);
  // Bench players who came into the side: who they replaced.
  const cameIn = (team: TeamRoundView, players: Map<number, PlayerRoundView>) =>
    new Map(
      team.score.slots
        .filter((s) => s.viaEmergency && s.scorerId !== null)
        .map((s) => [s.scorerId!, s.starterId !== null ? players.get(s.starterId) : undefined]),
    );
  const homeIn = cameIn(home, homePlayers);
  const awayIn = cameIn(away, awayPlayers);

  const side = (team: TeamRoundView, align: "left" | "right") => (
    <Link
      to={`/l/${league.id}/team/${team.teamId}/${team.round}`}
      className={`min-w-0 flex-1 ${align === "right" ? "text-right" : ""}`}
    >
      <div className={`truncate font-semibold ${team.teamId === myTeamId ? "text-accent" : ""}`}>
        {team.teamName} {winner === team.teamId && "✓"}
      </div>
      <div className="truncate text-xs text-muted">{team.ownerName}</div>
      <div className={`font-mono text-3xl font-bold tabular-nums ${winner && winner !== team.teamId ? "text-muted" : ""}`}>
        {formatPoints(team.score.total)}
      </div>
    </Link>
  );

  return (
    <AppShell title={home.roundTitle} back={`/l/${league.id}/matchups/${home.round}`}>
      <div className="flex flex-col gap-3 pb-20">
        <Card className="flex items-start gap-3">
          {side(home, "left")}
          <div className={`shrink-0 pt-1 text-xs ${home.roundStatus === "live" ? "text-accent" : "text-muted"}`}>{status}</div>
          {side(away, "right")}
        </Card>

        <ul className="flex flex-col gap-1.5">
          {rows.map((r) => {
            const hp = r.h?.scorerId != null ? homePlayers.get(r.h.scorerId) : undefined;
            const ap = r.a?.scorerId != null ? awayPlayers.get(r.a.scorerId) : undefined;
            const hStarter = r.h?.starterId != null ? homePlayers.get(r.h.starterId) : undefined;
            const aStarter = r.a?.starterId != null ? awayPlayers.get(r.a.starterId) : undefined;
            return (
              <li key={r.key}>
                <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-1.5">
                  <PlayerCell
                    player={hp ?? hStarter}
                    points={r.h?.points ?? null}
                    subFor={r.h?.viaEmergency ? hStarter : undefined}
                    align="left"
                    onTap={(pid) => setOpen(open === pid ? null : pid)}
                  />
                  <div className="flex w-12 items-center justify-center text-center text-[10px] font-semibold uppercase leading-tight text-muted">
                    {r.label}
                  </div>
                  <PlayerCell
                    player={ap ?? aStarter}
                    points={r.a?.points ?? null}
                    subFor={r.a?.viaEmergency ? aStarter : undefined}
                    align="right"
                    onTap={(pid) => setOpen(open === pid ? null : pid)}
                  />
                </div>
                {open !== null && (open === (hp ?? hStarter)?.id || open === (ap ?? aStarter)?.id) && (
                  <Breakdown player={(homePlayers.get(open) ?? awayPlayers.get(open))!} />
                )}
              </li>
            );
          })}
        </ul>

        <div className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted">Bench · emergencies in order</div>
        <ul className="flex flex-col gap-1.5 opacity-75">
          {Array.from({ length: benchRows }, (_, i) => {
            const hp = homePlayers.get(home.lineup.bench[i] ?? -1);
            const ap = awayPlayers.get(away.lineup.bench[i] ?? -1);
            return (
              <li key={i}>
                <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-1.5">
                  <PlayerCell player={hp} points={hp?.points ?? null} align="left" bench inFor={hp ? homeIn.get(hp.id) : undefined} onTap={(pid) => setOpen(open === pid ? null : pid)} />
                  <div className="flex w-12 items-center justify-center text-[10px] font-semibold text-muted">E{i + 1}</div>
                  <PlayerCell player={ap} points={ap?.points ?? null} align="right" bench inFor={ap ? awayIn.get(ap.id) : undefined} onTap={(pid) => setOpen(open === pid ? null : pid)} />
                </div>
                {open !== null && (open === hp?.id || open === ap?.id) && (
                  <Breakdown player={(homePlayers.get(open) ?? awayPlayers.get(open))!} />
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <LeagueNav leagueId={league.id} myTeamId={myTeamId} />
    </AppShell>
  );
}

const NOTE: Record<NonNullable<PlayerRoundView["note"]>, string> = {
  bye: "Bye",
  notNamed: "Not named",
  reserve: "Reserve",
  didNotPlay: "DNP",
  noFixture: "No draw",
};

function PlayerCell({
  player,
  points,
  subFor,
  inFor,
  align,
  bench = false,
  onTap,
}: {
  player: PlayerRoundView | undefined;
  points: number | null;
  subFor?: PlayerRoundView;
  /** A bench player who came into the side, and who for. */
  inFor?: PlayerRoundView;
  align: "left" | "right";
  bench?: boolean;
  onTap: (playerId: number) => void;
}) {
  const right = align === "right";
  if (!player) {
    return <div className="rounded-xl border border-dashed border-border px-2 py-2 text-xs text-muted">Empty</div>;
  }
  // A starter who didn't play and wasn't replaced scores nothing.
  const shown = bench ? player.points : points;
  const game = player.match
    ? player.match.state === "FullTime"
      ? "FT"
      : new Date(player.match.kickoffAt).getTime() <= Date.now()
        ? "Live"
        : formatKickoff(player.match.kickoffAt)
    : null;
  return (
    <button
      type="button"
      onClick={() => onTap(player.id)}
      className={`flex min-w-0 items-center gap-2 rounded-xl border border-border bg-surface px-2 py-2 ${right ? "flex-row-reverse text-right" : "text-left"}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{shortName(player.name)}</span>
        <span className={`flex flex-wrap items-center gap-1 text-[11px] text-muted ${right ? "justify-end" : ""}`}>
          <PositionBadge positions={player.positions} />
          {player.note ? (
            <span className={player.note === "reserve" ? "" : "font-semibold text-danger"}>{NOTE[player.note]}</span>
          ) : (
            game && <span className={game === "Live" ? "text-accent" : ""}>{game}</span>
          )}
        </span>
        {subFor && <span className="block truncate text-[11px] text-accent">↳ for {shortName(subFor.name)}</span>}
        {inFor && <span className="block truncate text-[11px] text-accent">In for {shortName(inFor.name)}</span>}
      </span>
      <span className={`shrink-0 font-mono text-base font-semibold tabular-nums ${shown === null ? "text-muted" : ""}`}>
        {formatPoints(shown)}
      </span>
    </button>
  );
}

function Breakdown({ player }: { player: PlayerRoundView }) {
  return (
    <div className="mt-1.5 rounded-xl bg-surface-2 px-3 py-2 text-xs">
      <div className="mb-1 font-semibold">
        {player.name} · {player.club?.nickName ?? "—"}
        {player.match ? ` ${player.match.home ? "v" : "@"} ${player.match.opponent}` : ""}
      </div>
      {player.breakdown.length ? (
        <ul className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-0.5">
          {player.breakdown.map((b) => (
            <li key={b.stat} className="contents">
              <span className="text-muted">{SCORING_STAT_LABELS[b.stat as ScoringStat] ?? b.stat}</span>
              <span className="text-right font-mono">{formatPoints(b.value)}</span>
              <span className={`text-right font-mono ${b.points < 0 ? "text-danger" : "text-accent"}`}>
                {b.points > 0 ? "+" : ""}
                {formatPoints(b.points)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-muted">No points yet.</span>
      )}
    </div>
  );
}

/** "Nathan Cleary" -> "N. Cleary", so two columns fit on a phone. */
function shortName(name: string): string {
  const parts = name.split(" ");
  return parts.length > 1 ? `${parts[0]![0]}. ${parts.slice(1).join(" ")}` : name;
}
