import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  SCORING_STAT_LABELS,
  formatStatLine,
  type LeagueDetail,
  type PlayerRoundView,
  type ScoreState,
  type ScoringStat,
  type TeamRoundView,
} from "@nrl/shared";
import { AppShell } from "../components/Layout.tsx";
import { Button, Card, ErrorText, SectionTitle, Spinner } from "../components/ui.tsx";
import { findTeam, matchupPath, teamPath, useLeagueId } from "../lib/activeLeague.tsx";
import { useDragMove, useLineupEditor, DragGrip, spotOccupant, type LineupEditor } from "../lib/lineupEditor.tsx";
import { useLeague } from "../lib/queries.ts";
import { LineupHint, SaveBar } from "./TeamRoundPage.tsx";
import { formatKickoff, formatPoints, useRound, useTeamRound } from "../lib/season.ts";
import { MatchupCard } from "./MatchupsPage.tsx";

/** Head-to-head: both lineups side by side, slot by slot, with live scores. */
export function MatchupPage() {
  const id = useLeagueId();
  const { round: roundParam = "", homeId: homeParam, awayId: awayParam } = useParams();
  const navigate = useNavigate();
  const round = Number(roundParam);
  const league = useLeague(id);
  const homeId = league.data ? findTeam(league.data, homeParam)?.id : undefined;
  const awayId = league.data ? findTeam(league.data, awayParam)?.id : undefined;
  const home = useTeamRound(id, homeId, round);
  const away = useTeamRound(id, awayId, round);

  // Tidy the address: team names rather than ids.
  useEffect(() => {
    if (!league.data || !homeId || !awayId) return;
    const tidy = matchupPath(league.data, round, homeId, awayId);
    if (tidy !== `/matchup/${roundParam}/${homeParam}/${awayParam}`) navigate(tidy, { replace: true });
  }, [league.data, homeId, awayId, round, roundParam, homeParam, awayParam, navigate]);

  if (league.data && (!homeId || !awayId)) {
    return (
      <AppShell title="Matchup" back={`/matchups/${round}`}>
        <Card className="text-sm text-muted">That matchup isn't in {league.data.name}.</Card>
      </AppShell>
    );
  }
  if (!league.data || !home.data || !away.data) {
    const error = league.error ?? home.error ?? away.error;
    return (
      <AppShell title="Matchup" back={`/matchups/${round}`}>
        {error ? <ErrorText error={error} /> : <Spinner />}
      </AppShell>
    );
  }
  return <Matchup league={league.data} myTeamId={league.data.myTeamId} home={home.data} away={away.data} />;
}

/** Short slot names for the middle column. */
const SLOT_SHORT: Record<string, string> = { HB_HK: "HF/HK", FWD: "FWD", OB: "OB", FLEX: "FLX" };
const slotShort = (key: string, label: string) => SLOT_SHORT[key] ?? label.slice(0, 5).toUpperCase();

/** Score colour: green when final, white while live, amber while stats are in review. */
const SCORE_COLOUR: Record<ScoreState, string> = {
  final: "text-accent",
  live: "text-text",
  review: "text-review",
  upcoming: "text-muted",
};

/** A team total's state: the least settled of the players it counts. */
function totalState(team: TeamRoundView, players: Map<number, PlayerRoundView>): ScoreState {
  const states = team.score.slots
    .map((s) => (s.scorerId !== null ? players.get(s.scorerId)?.scoreState : undefined))
    .filter((s): s is ScoreState => !!s);
  if (team.roundStatus === "complete") return "final";
  if (states.every((s) => s === "upcoming")) return "upcoming";
  // Still games to come or in progress: the total is live.
  if (states.some((s) => s === "live" || s === "upcoming")) return "live";
  return "review";
}

function Matchup({ league, myTeamId, home, away }: { league: LeagueDetail; myTeamId: string; home: TeamRoundView; away: TeamRoundView }) {
  const [open, setOpen] = useState<number | null>(null);
  const toggle = (pid: number) => setOpen(open === pid ? null : pid);
  const homePlayers = new Map(home.players.map((p) => [p.id, p]));
  const awayPlayers = new Map(away.players.map((p) => [p.id, p]));
  const final = home.roundStatus === "complete";
  const winner = final && home.score.total !== away.score.total ? (home.score.total > away.score.total ? home.teamId : away.teamId) : null;
  const status = final ? "Final" : home.roundStatus === "live" ? "● Live" : "Upcoming";

  // Your side can be edited here too (tap or drag, then save), as on My team.
  const mySide = home.teamId === myTeamId ? home : away.teamId === myTeamId ? away : null;
  const ed = useLineupEditor({ leagueId: league.id, template: league.settings.roster, view: mySide ?? home });
  const dnd = useDragMove((from, to) => ed.move(from, to));
  const canEdit = !!mySide?.editable;
  const [editing, setEditing] = useState(false);
  const editingNow = canEdit && (editing || ed.dirty);
  const mineEditing = (team: TeamRoundView) => editingNow && team.teamId === myTeamId;

  /** A cell: your side's comes from the lineup being edited; otherwise as scored. */
  const cell = (
    team: TeamRoundView,
    spot: string,
    shown: PlayerRoundView | undefined,
    align: "left" | "right",
    greyed: boolean,
    inFor?: PlayerRoundView,
  ) => {
    if (!mineEditing(team)) return <PlayerCell player={shown} align={align} greyed={greyed} inFor={inFor} onTap={toggle} />;
    const pid = spotOccupant(ed.lineup, spot);
    const player = pid !== null ? ed.players.get(pid) : undefined;
    const source = dnd.drag?.from ?? ed.selected;
    return (
      <PlayerCell
        player={player}
        align={align}
        greyed={false}
        onTap={() => ed.tap(spot)}
        edit={{
          selected: ed.selected === spot || dnd.drag?.from === spot,
          target: source !== null && source !== spot && ed.canMove(source, spot),
          over: dnd.drag?.over === spot,
          draggable: ed.canDrag(spot),
          dropProps: dnd.rowProps(spot, player?.name ?? "", ed.canDrag(spot)),
        }}
      />
    );
  };

  // Starting spots, side by side: the player picked to start there.
  const rows = league.settings.roster.slots.flatMap((slot) =>
    Array.from({ length: slot.count }, (_, i) => ({
      key: `${slot.key}:${i}`,
      label: slotShort(slot.key, slot.label),
      h: home.score.slots.find((s) => s.slotKey === slot.key && s.index === i),
      a: away.score.slots.find((s) => s.slotKey === slot.key && s.index === i),
    })),
  );
  const benchLength = (team: TeamRoundView) => (mineEditing(team) ? ed.lineup.bench.length : team.lineup.bench.length);
  const benchRows = Math.max(benchLength(home), benchLength(away));
  const endOfBench = `bench:${ed.lineup.bench.length}`;

  // Bench players who came into the side, and who they replaced.
  const cameIn = (team: TeamRoundView, players: Map<number, PlayerRoundView>) =>
    new Map(
      team.score.slots
        .filter((s) => s.viaEmergency && s.scorerId !== null)
        .map((s) => [s.scorerId!, s.starterId !== null ? players.get(s.starterId) : undefined]),
    );
  const homeIn = cameIn(home, homePlayers);
  const awayIn = cameIn(away, awayPlayers);

  const side = (team: TeamRoundView, players: Map<number, PlayerRoundView>, align: "left" | "right") => (
    <Link to={teamPath(league, team.teamId, team.round)} className={`min-w-0 flex-1 ${align === "right" ? "text-right" : ""}`}>
      <div className={`truncate font-semibold ${team.teamId === myTeamId ? "text-accent" : ""}`}>
        {team.teamName} {winner === team.teamId && "✓"}
      </div>
      <div className="truncate text-xs text-muted">{team.ownerName}</div>
      <div
        className={`font-mono text-3xl font-bold tabular-nums lg:text-5xl ${
          winner && winner !== team.teamId ? "text-muted" : SCORE_COLOUR[totalState(team, players)]
        }`}
      >
        {formatPoints(team.score.total)}
      </div>
    </Link>
  );

  const breakdownFor = (...ids: Array<number | undefined>) =>
    open !== null && ids.includes(open) ? <Breakdown player={(homePlayers.get(open) ?? awayPlayers.get(open))!} /> : null;

  return (
    <AppShell title={home.roundTitle} back={`/matchups/${home.round}`} width="wide" league={{ id: league.id, myTeamId }}>
      {/* Desktop: the round's other matchups alongside. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="flex flex-col gap-3">
          <Card className="flex items-start gap-3">
            {side(home, homePlayers, "left")}
            <div className={`shrink-0 pt-1 text-xs ${home.roundStatus === "live" ? "text-accent" : "text-muted"}`}>{status}</div>
            {side(away, awayPlayers, "right")}
          </Card>

          {canEdit && (
            <div className="flex flex-col gap-2">
              {editingNow ? (
                <div className="flex items-center justify-between gap-3 text-xs text-muted">
                  <span>
                    <span className="lg:hidden">Tap a player of yours, then where they should go, or drag them by ⠿.</span>
                    <span className="hidden lg:inline">Drag your players to swap them, or click one and then the spot.</span> Locked
                    players have kicked off.
                  </span>
                  {!ed.dirty && (
                    <button className="shrink-0 text-sm font-medium text-accent" onClick={() => setEditing(false)}>
                      Done
                    </button>
                  )}
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit my lineup
                </Button>
              )}
              <LineupHint ed={ed} />
              {ed.dirty && <SaveBar ed={ed} />}
            </div>
          )}

          <ul className="flex flex-col gap-1.5">
            {rows.map((r) => {
              const hp = r.h?.starterId != null ? homePlayers.get(r.h.starterId) : undefined;
              const ap = r.a?.starterId != null ? awayPlayers.get(r.a.starterId) : undefined;
              return (
                <li key={r.key}>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-1.5">
                    {cell(home, r.key, hp, "left", hp?.status === "dnp")}
                    <SlotLabel>{r.label}</SlotLabel>
                    {cell(away, r.key, ap, "right", ap?.status === "dnp")}
                  </div>
                  {breakdownFor(hp?.id, ap?.id)}
                </li>
              );
            })}
          </ul>

          <div className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted">Bench · emergencies in order</div>
          <ul className="flex flex-col gap-1.5">
            {Array.from({ length: benchRows }, (_, i) => {
              const hp = homePlayers.get(home.lineup.bench[i] ?? -1);
              const ap = awayPlayers.get(away.lineup.bench[i] ?? -1);
              return (
                <li key={i}>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-1.5">
                    {cell(home, `bench:${i}`, hp, "left", !!hp && !homeIn.has(hp.id), hp ? homeIn.get(hp.id) : undefined)}
                    <SlotLabel>E{i + 1}</SlotLabel>
                    {cell(away, `bench:${i}`, ap, "right", !!ap && !awayIn.has(ap.id), ap ? awayIn.get(ap.id) : undefined)}
                  </div>
                  {breakdownFor(hp?.id, ap?.id)}
                </li>
              );
            })}
            {dnd.drag && !dnd.drag.from.startsWith("bench") && (
              <li
                data-drop-spot={endOfBench}
                className={`rounded-xl border border-dashed px-3 py-3 text-center text-sm ${
                  dnd.drag.over === endOfBench ? "border-accent bg-accent/10 text-text" : "border-border text-muted"
                }`}
              >
                Drop here to move to the end of your bench
              </li>
            )}
          </ul>
          {dnd.ghost}

          <p className="flex flex-wrap justify-center gap-x-4 text-xs text-muted">
            <span>
              <span className="text-accent">●</span> Final
            </span>
            <span>
              <span className="text-text">●</span> Live
            </span>
            <span>
              <span className="text-review">●</span> In review (stats checked for 24h after full time)
            </span>
          </p>
        </div>
        <OtherMatchups leagueId={league.id} round={home.round} myTeamId={myTeamId} current={[home.teamId, away.teamId]} />
      </div>
    </AppShell>
  );
}

function OtherMatchups({
  leagueId,
  round,
  myTeamId,
  current,
}: {
  leagueId: string;
  round: number;
  myTeamId: string;
  current: [string, string];
}) {
  const view = useRound(leagueId, round);
  const others = (view.data?.matchups ?? []).filter(
    (m) => !(m.home?.teamId === current[0] && m.away?.teamId === current[1]),
  );
  if (others.length === 0) return null;
  return (
    <aside className="hidden flex-col gap-3 lg:sticky lg:top-20 lg:flex">
      <SectionTitle>Also this round</SectionTitle>
      {others.map((m) => (
        <MatchupCard key={`${m.stage}-${m.home?.teamId}-${m.away?.teamId}`} leagueId={leagueId} matchup={m} myTeamId={myTeamId} />
      ))}
    </aside>
  );
}

function SlotLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-11 items-center justify-center text-center text-[10px] font-semibold leading-tight text-muted">
      {children}
    </div>
  );
}

const NOTE: Record<NonNullable<PlayerRoundView["note"]>, string> = {
  bye: "Bye",
  notNamed: "Not named",
  reserve: "Reserve",
  didNotPlay: "Didn't play",
  noFixture: "No draw",
};

function PlayerCell({
  player,
  align,
  greyed,
  inFor,
  onTap,
  edit,
}: {
  player: PlayerRoundView | undefined;
  align: "left" | "right";
  /** Not counting: a starter who didn't play, or a bench player who wasn't needed. */
  greyed: boolean;
  /** A bench player who came into the side, and who for. */
  inFor?: PlayerRoundView;
  onTap: (playerId: number) => void;
  /** Your side while editing: selection, drop target and drag props. */
  edit?: { selected: boolean; target: boolean; over: boolean; draggable: boolean; dropProps: object };
}) {
  const right = align === "right";
  const editBorder = edit
    ? edit.over
      ? "border-accent bg-accent/15"
      : edit.selected
        ? "border-accent bg-accent/10"
        : edit.target
          ? "border-accent/50 border-dashed bg-surface"
          : "border-border bg-surface"
    : null;
  if (!player) {
    return edit ? (
      <button
        type="button"
        onClick={() => onTap(-1)}
        {...edit.dropProps}
        className={`rounded-xl border border-dashed px-2 py-2 text-xs text-muted ${editBorder}`}
      >
        Empty
      </button>
    ) : (
      <div className="rounded-xl border border-dashed border-border px-2 py-2 text-xs text-muted">Empty</div>
    );
  }
  const statLine = formatStatLine(player.breakdown);
  // Second line: why they won't score, else their stats, else when they play.
  const detail = player.note
    ? { text: NOTE[player.note], tone: player.note === "reserve" ? "" : "text-danger" }
    : statLine
      ? { text: statLine, tone: "" }
      : player.scoreState === "upcoming" && player.match
        ? { text: formatKickoff(player.match.kickoffAt), tone: "" }
        : player.scoreState === "live"
          ? { text: "Live", tone: "text-accent" }
          : { text: "", tone: "" };

  return (
    <button
      type="button"
      onClick={() => onTap(player.id)}
      {...edit?.dropProps}
      aria-pressed={edit ? edit.selected : undefined}
      className={`flex min-w-0 select-none items-center gap-2 rounded-xl border px-2 py-2 ${right ? "flex-row-reverse text-right" : "text-left"} ${
        editBorder ?? (greyed ? "border-border/50 bg-surface/50 opacity-50" : inFor ? "border-accent/50 bg-surface" : "border-border bg-surface")
      } ${edit?.draggable ? "lg:cursor-grab" : ""}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          <span className="lg:hidden">{shortName(player.name)}</span>
          <span className="hidden lg:inline">{player.name}</span>
        </span>
        {detail.text && (
          <span className={`line-clamp-2 block text-[11px] leading-snug text-muted ${detail.tone}`}>{detail.text}</span>
        )}
        {inFor && <span className="block truncate text-[11px] text-accent">In for {shortName(inFor.name)}</span>}
      </span>
      <span className={`shrink-0 font-mono text-base font-semibold tabular-nums ${player.points === null ? "text-muted" : SCORE_COLOUR[player.scoreState]}`}>
        {formatPoints(player.points)}
      </span>
      {edit && player.locked && <span aria-label="Locked">🔒</span>}
      {edit?.draggable && <DragGrip />}
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
