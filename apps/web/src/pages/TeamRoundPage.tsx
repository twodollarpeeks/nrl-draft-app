import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { type LeagueDetail, type PlayerRoundView, type RosterTemplate, type SeasonOverview, type Spot, type TeamRoundView } from "@nrl/shared";
import { AppShell } from "../components/Layout.tsx";
import { PositionBadge } from "../components/Position.tsx";
import { RoundPicker } from "../components/LeagueNav.tsx";
import { Button, Card, ErrorText, SectionTitle, Spinner } from "../components/ui.tsx";
import { findTeam, teamPath, useLeagueId } from "../lib/activeLeague.tsx";
import { DragGrip, useDragMove, useLineupEditor, type LineupEditor } from "../lib/lineupEditor.tsx";
import { useLeague } from "../lib/queries.ts";
import { formatKickoff, formatPoints, usePrefetchNeighbours, useSeason, useTeamRound } from "../lib/season.ts";

/** /myteam/<round> or /team/<team name>/<round>. */
export function TeamRoundPage() {
  const id = useLeagueId();
  const { teamId: teamParam, round: roundParam } = useParams();
  const navigate = useNavigate();
  const league = useLeague(id);
  const season = useSeason(id, league.data?.status === "inSeason" || league.data?.status === "complete");
  const teamId = league.data ? (teamParam ? findTeam(league.data, teamParam)?.id : league.data.myTeamId) : undefined;
  const round = roundParam ? Number(roundParam) : season.data?.currentRound;
  const team = useTeamRound(id, teamId, round);

  // Tidy the address: /myteam for yours, team names rather than ids.
  useEffect(() => {
    if (!league.data || !teamId || !teamParam) return;
    const tidy = teamPath(league.data, teamId, roundParam ? Number(roundParam) : undefined);
    if (tidy !== `/team/${teamParam}${roundParam ? `/${roundParam}` : ""}`) navigate(tidy, { replace: true });
  }, [league.data, teamId, teamParam, roundParam, navigate]);

  if (league.data && league.data.status !== "inSeason" && league.data.status !== "complete") {
    return (
      <AppShell title="Team" back="/league">
        <Card className="text-sm text-muted">Lineups open once the draft is done.</Card>
      </AppShell>
    );
  }
  if (league.data && teamParam && !teamId) {
    return (
      <AppShell title="Team" back="/league">
        <Card className="text-sm text-muted">There's no team called that in {league.data.name}.</Card>
      </AppShell>
    );
  }
  if (!league.data || !season.data || !team.data) {
    const error = league.error ?? season.error ?? team.error;
    return (
      <AppShell title="Team" back="/league">
        {error ? <ErrorText error={error} /> : <Spinner />}
      </AppShell>
    );
  }
  return (
    <TeamRound
      league={league.data}
      season={season.data}
      view={team.data}
      round={round ?? team.data.round}
      loading={team.isPlaceholderData}
    />
  );
}

function TeamRound({
  league,
  season,
  view,
  round,
  loading,
}: {
  league: LeagueDetail;
  season: SeasonOverview;
  view: TeamRoundView;
  /** The round asked for: `view` is still the last one while it loads. */
  round: number;
  loading: boolean;
}) {
  const navigate = useNavigate();
  const lastRound = season.grandFinalRound ?? season.lastRegularRound;
  usePrefetchNeighbours(league.id, view.teamId, round, season.firstRound, lastRound);
  const template = league.settings.roster;
  const ed = useLineupEditor({ leagueId: league.id, template, view, loading });
  const roundInfo = season.rounds.find((r) => r.number === view.round);
  const isMine = view.teamId === season.myTeamId;

  return (
    <AppShell title={view.teamName} back="/league" width="wide" league={{ id: league.id, myTeamId: season.myTeamId }}>
      {/* Desktop: round, score and save on the left; starters and bench side by side. */}
      <div
        className={`grid grid-cols-1 gap-4 transition-opacity lg:grid-cols-[300px_minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-6 ${
          loading ? "[&>*:not(:first-child)]:opacity-50" : ""
        }`}
        aria-busy={loading}
      >
        <div className="flex flex-col gap-4 lg:sticky lg:top-20">
          <RoundPicker
            round={round}
            first={season.firstRound}
            last={lastRound}
            title={view.roundTitle}
            status={view.roundStatus}
            loading={loading}
            onChange={(r) => navigate(teamPath(league, view.teamId, r))}
          />

          <Card className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted">{isMine ? "Your score" : `${view.ownerName}'s score`}</div>
              <div className="text-xs text-muted">
                {view.score.provisional ? (view.roundStatus === "upcoming" ? "Not started" : "Live, may change") : "Final"}
                {view.editable && view.lineupSource === "carried" ? " · lineup carried over from last round" : ""}
                {view.editable && view.lineupSource === "auto" ? " · lineup picked for you: change it below" : ""}
              </div>
            </div>
            <div className="font-mono text-4xl font-bold tabular-nums">{formatPoints(view.score.total)}</div>
          </Card>

          {!isMine && view.editable && (
            <p role="status" className="rounded-xl border border-review/40 bg-review/10 px-3 py-2 text-sm text-review">
              You're editing {view.ownerName}'s lineup as commissioner.
            </p>
          )}
          {!isMine && (
            <Link
              to={`/trades/new?with=${view.teamId}`}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-surface-2 px-4 text-sm font-semibold hover:bg-border"
            >
              Propose a trade
            </Link>
          )}
          {view.editable && (
            <p className="text-xs text-muted">
              <span className="lg:hidden">Tap a player, then tap where they should go, or drag them by ⠿.</span>
              <span className="hidden lg:inline">Drag a player to where they should go, or click one and then the spot.</span>{" "}
              Players lock when their game kicks off.
              {roundInfo?.firstKickoff ? ` First game: ${formatKickoff(roundInfo.firstKickoff)}.` : ""}
            </p>
          )}
          <LineupHint ed={ed} />
          {ed.dirty && (
            <div className="hidden lg:block">
              <SaveBar ed={ed} />
            </div>
          )}
        </div>

        <LineupLists ed={ed} template={template} view={view} />
      </div>

      {/* Phones: save floats above the tab bar. */}
      {ed.dirty && (
        <div className="fixed inset-x-0 bottom-16 z-30 mx-auto max-w-2xl px-4 lg:hidden">
          <SaveBar ed={ed} floating />
        </div>
      )}
    </AppShell>
  );
}

export function LineupHint({ ed }: { ed: LineupEditor }) {
  return ed.hint ? (
    <p role="status" className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
      {ed.hint}
    </p>
  ) : null;
}

/** Save / Undo for unsaved lineup changes. */
export function SaveBar({ ed, floating = false }: { ed: LineupEditor; floating?: boolean }) {
  const shadow = floating ? "shadow-lg" : "";
  return (
    <div className="flex flex-col gap-2">
      <ErrorText error={ed.saveError} />
      <div className="flex gap-2">
        <Button className={`flex-1 ${shadow}`} disabled={ed.saving || ed.errors.length > 0} onClick={ed.save}>
          {ed.saving ? "Saving…" : "Save lineup"}
        </Button>
        <Button variant="secondary" className={shadow} onClick={ed.undo}>
          Undo
        </Button>
      </div>
    </div>
  );
}

/** Starting side and bench, editable by tap or drag. */
function LineupLists({ ed, template, view }: { ed: LineupEditor; template: RosterTemplate; view: TeamRoundView }) {
  const dnd = useDragMove((from, to) => ed.move(from, to));
  const { lineup, selected, players } = ed;
  const selectedStarter = selected !== null && !selected.startsWith("bench");
  const source = dnd.drag?.from ?? selected;
  const row = (spot: Spot, pid: number | null) => ({
    selected: selected === spot || dnd.drag?.from === spot,
    target: source !== null && source !== spot && ed.canMove(source, spot),
    over: dnd.drag?.over === spot,
    draggable: ed.canDrag(spot),
    onTap: () => ed.tap(spot),
    dropProps: dnd.rowProps(spot, (pid !== null ? players.get(pid)?.name : undefined) ?? "", ed.canDrag(spot)),
  });
  const endOfBench = `bench:${lineup.bench.length}`;
  const draggingStarter = !!dnd.drag && !dnd.drag.from.startsWith("bench");

  return (
    <>
      <section>
        <SectionTitle>Starting side</SectionTitle>
        <ul className="flex flex-col gap-2">
          {template.slots.flatMap((slot) =>
            Array.from({ length: slot.count }, (_, i) => {
              const spot = `${slot.key}:${i}`;
              const occupant = lineup.starters[slot.key]?.[i] ?? null;
              const scored = view.score.slots.find((s) => s.slotKey === slot.key && s.index === i);
              const sub = !ed.dirty && scored?.viaEmergency ? players.get(scored.scorerId!) : undefined;
              return (
                <li key={spot}>
                  <PlayerRow
                    label={slot.label}
                    player={occupant !== null ? players.get(occupant) : undefined}
                    {...row(spot, occupant)}
                    sub={sub ? `${sub.name} came in: ${formatPoints(scored!.points)}` : undefined}
                    showPoints={!sub}
                  />
                </li>
              );
            }),
          )}
        </ul>
        {selectedStarter && (
          <Button variant="secondary" className="mt-2" onClick={ed.bench}>
            Move to bench
          </Button>
        )}
      </section>

      <section className="pb-20 lg:pb-0">
        <SectionTitle>Bench · emergencies in order</SectionTitle>
        <p className="mb-2 text-xs text-muted">
          If a starter doesn't play, the first emergency below who can play that position and does play comes in.
        </p>
        <ul className="flex flex-col gap-2">
          {lineup.bench.map((pid, i) => {
            const spot = `bench:${i}`;
            return (
              <li key={pid}>
                <PlayerRow label={`E${i + 1}`} player={players.get(pid)} {...row(spot, pid)} dim />
              </li>
            );
          })}
          {draggingStarter && (
            <li
              data-drop-spot={endOfBench}
              className={`rounded-xl border border-dashed px-3 py-3 text-center text-sm ${
                dnd.drag?.over === endOfBench ? "border-accent bg-accent/10 text-text" : "border-border text-muted"
              }`}
            >
              Drop here to move to the end of the bench
            </li>
          )}
        </ul>
      </section>
      {dnd.ghost}
    </>
  );
}

const NOTE_LABEL: Record<NonNullable<PlayerRoundView["note"]>, string> = {
  bye: "Bye",
  notNamed: "Not named",
  reserve: "Reserve",
  didNotPlay: "Didn't play",
  noFixture: "No draw yet",
};

function PlayerRow({
  label,
  player,
  selected,
  target,
  over = false,
  draggable = false,
  dropProps,
  onTap,
  sub,
  showPoints = true,
  dim = false,
}: {
  label: string;
  player: PlayerRoundView | undefined;
  selected: boolean;
  target: boolean;
  /** Something is being dragged over this row. */
  over?: boolean;
  draggable?: boolean;
  dropProps?: object;
  onTap: () => void;
  sub?: string;
  showPoints?: boolean;
  dim?: boolean;
}) {
  const border = over
    ? "border-accent bg-accent/15"
    : selected
      ? "border-accent bg-accent/10"
      : target
        ? "border-accent/50 border-dashed"
        : "border-border";
  return (
    <button
      type="button"
      onClick={onTap}
      aria-pressed={selected}
      {...dropProps}
      className={`flex w-full select-none items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 text-left ${border} ${
        draggable ? "lg:cursor-grab" : ""
      }`}
    >
      <span className="w-12 shrink-0 text-xs font-semibold text-muted lg:w-16">{label}</span>
      {player ? (
        <span className="min-w-0 flex-1">
          <span className={`flex items-center gap-2 ${dim ? "" : "font-medium"}`}>
            <span className="truncate">{player.name}</span>
            {player.locked && <span aria-label="Locked">🔒</span>}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <PositionBadge positions={player.positions} />
            <span>{player.club?.nickName ?? "—"}</span>
            {player.match && <MatchLine match={player.match} />}
            {player.note && (
              <span className={`rounded px-1.5 py-0.5 font-semibold ${player.note === "reserve" ? "bg-surface-2" : "bg-danger/15 text-danger"}`}>
                {NOTE_LABEL[player.note]}
              </span>
            )}
          </span>
          {sub && <span className="block text-xs text-accent">↳ {sub}</span>}
        </span>
      ) : (
        <span className="flex-1 text-sm text-muted">Empty: tap or drag a bench player here</span>
      )}
      {player && showPoints && (
        <span className={`w-12 shrink-0 text-right font-mono tabular-nums ${player.points === null ? "text-muted" : ""}`}>
          {formatPoints(player.points)}
        </span>
      )}
      {draggable && <DragGrip />}
    </button>
  );
}

function MatchLine({ match }: { match: NonNullable<PlayerRoundView["match"]> }) {
  const when =
    match.state === "FullTime"
      ? "FT"
      : new Date(match.kickoffAt).getTime() <= Date.now()
        ? "Live"
        : formatKickoff(match.kickoffAt);
  return (
    <span>
      {match.home ? "v" : "@"} {match.opponent} · <span className={when === "Live" ? "text-accent" : ""}>{when}</span>
    </span>
  );
}
