import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { MIN_TEAMS, type DraftPlayer, type DraftState, type LeagueDetail, type NrlPosition } from "@nrl/shared";
import { DraftOrderList, formatDraftTime } from "../components/DraftSetup.tsx";
import { ClockBar } from "../components/draft/ClockBar.tsx";
import { DraftLayout, useTurnAlert } from "../components/draft/DraftLayout.tsx";
import { BoardPanel, QueuePanel, TeamPanel, picksUntil } from "../components/draft/Panels.tsx";
import { PlayerList } from "../components/draft/PlayerList.tsx";
import { AppShell } from "../components/Layout.tsx";
import { Button, Card, ErrorText, Spinner } from "../components/ui.tsx";
import { useDraftAction, useDraftPlayers, useDraftState, useQueue } from "../lib/draft.ts";
import { useLeague } from "../lib/queries.ts";

export function DraftRoomPage() {
  const { id = "" } = useParams();
  const league = useLeague(id);
  const draft = useDraftState(id);
  const players = useDraftPlayers(id);

  if (league.isPending || draft.isPending || players.isPending) {
    return <AppShell title="Draft" back={`/l/${id}`}><Spinner /></AppShell>;
  }
  if (!league.data || !draft.data || !players.data) {
    return (
      <AppShell title="Draft" back={`/l/${id}`}>
        <ErrorText error={league.error ?? draft.error ?? players.error} />
      </AppShell>
    );
  }
  return (
    <Room
      league={league.data}
      state={draft.data}
      players={players.data}
      connection={draft.connection}
      socketError={draft.socketError}
    />
  );
}

function Room({
  league,
  state,
  players,
  connection,
  socketError,
}: {
  league: LeagueDetail;
  state: DraftState;
  players: DraftPlayer[];
  connection: ReturnType<typeof useDraftState>["connection"];
  socketError: string | null;
}) {
  const leagueId = league.id;
  const myTeamId = league.myTeamId;
  const template = league.settings.roster;
  const [commishMode, setCommishMode] = useState(false);
  const { queue: savedQueue, update: updateQueue, error: queueError } = useQueue(leagueId);

  const pick = useDraftAction<{ pickNo: number; playerId: number }>(leagueId, "pick", (v) => v);
  const autopilot = useDraftAction<boolean>(leagueId, "autopilot", (on) => ({ on }));
  const start = useDraftAction(leagueId, "start");
  const pause = useDraftAction(leagueId, "pause");
  const resume = useDraftAction(leagueId, "resume");
  const undo = useDraftAction(leagueId, "undo");

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const teamName = useMemo(() => new Map(state.order.map((t) => [t.id, t.name])), [state.order]);
  const takenBy = useMemo(
    () => new Map(state.picks.map((p) => [p.playerId, teamName.get(p.teamId) ?? "Taken"])),
    [state.picks, teamName],
  );
  // Drafted players leave every queue.
  const queue = savedQueue.filter((id) => !takenBy.has(id));

  const onClock = state.onClockTeamId;
  const myTurn = state.status === "live" && onClock === myTeamId;
  const pickingFor = myTurn ? myTeamId : league.isCommissioner && commishMode && state.status === "live" ? onClock : null;
  const rosterOf = (teamId: string | null): NrlPosition[][] =>
    teamId ? state.picks.filter((p) => p.teamId === teamId).map((p) => byId.get(p.playerId)?.positions ?? []) : [];
  const onAutopilot = state.autopilotTeamIds.includes(myTeamId);
  const until = state.status === "live" || state.status === "paused" ? picksUntil(state, myTeamId) : null;

  useTurnAlert(myTurn);

  const toggleQueue = (pid: number) =>
    updateQueue((cur) => (cur.includes(pid) ? cur.filter((q) => q !== pid) : [...cur, pid]));
  const actionError = pick.error ?? autopilot.error ?? start.error ?? pause.error ?? resume.error ?? undo.error ?? queueError;

  const playerList = (
    <PlayerList
      players={players}
      takenBy={takenBy}
      queue={queue}
      template={template}
      myRoster={rosterOf(pickingFor ?? myTeamId)}
      canPick={!!pickingFor}
      pickLabel={pickingFor === myTeamId ? "Draft" : `Pick for ${teamName.get(pickingFor ?? "") ?? "team"}`}
      busy={pick.isPending}
      onPick={(p) => pick.mutate({ pickNo: state.currentPick, playerId: p.id })}
      onToggleQueue={toggleQueue}
    />
  );
  const stepAway = !onAutopilot && state.status === "live" && (
    <button className="self-start text-xs text-muted underline" onClick={() => autopilot.mutate(true)}>
      Step away: autopick for me
    </button>
  );

  return (
    <DraftLayout
      title={`${league.name} draft`}
      back={`/l/${leagueId}`}
      backLabel="Back to league"
      clock={<ClockBar state={state} myTeamId={myTeamId} picksUntilMine={until} connection={connection} />}
      banner={
        onAutopilot &&
        state.status !== "complete" && (
          <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2 px-4 py-2 text-sm lg:px-6">
            <span>You're on autopick: your queue, then best available.</span>
            <Button variant="secondary" className="min-h-9" onClick={() => autopilot.mutate(false)} disabled={autopilot.isPending}>
              I'm back
            </Button>
          </div>
        )
      }
      notices={
        <>
          {socketError && <ErrorText error={socketError} />}
          <ErrorText error={actionError} />
          {state.status === "complete" && (
            <Card className="flex shrink-0 items-center justify-between gap-3">
              <div>
                <div className="font-semibold">The draft is done 🏉</div>
                <div className="text-sm text-muted">Every team has its squad. Set your lineup before round 1.</div>
              </div>
              <Link to={`/l/${leagueId}`} className="text-sm font-medium text-accent">
                League →
              </Link>
            </Card>
          )}
          {league.isCommissioner && state.status !== "pending" && (
            <CommissionerBar
              state={state}
              commishMode={commishMode}
              setCommishMode={setCommishMode}
              onPause={() => pause.mutate()}
              onResume={() => resume.mutate()}
              onUndo={() => {
                if (confirm("Undo the most recent pick?")) undo.mutate();
              }}
            />
          )}
        </>
      }
      preDraft={
        state.status === "pending" && <PreDraft league={league} onStart={() => start.mutate()} starting={start.isPending} />
      }
      playerList={playerList}
      board={(fill) => <BoardPanel state={state} players={byId} myTeamId={myTeamId} fill={fill} />}
      queuePanel={<QueuePanel queue={queue} players={byId} takenBy={takenBy} onChange={(ids) => updateQueue(() => ids)} />}
      queueCount={queue.length}
      teamPanel={<TeamPanel state={state} players={byId} template={template} teamId={myTeamId} />}
      footer={stepAway}
    />
  );
}

function PreDraft({ league, onStart, starting }: { league: LeagueDetail; onStart: () => void; starting: boolean }) {
  const commissioner = league.teams.find((t) => t.isCommissioner)?.owner.name ?? "the commissioner";
  return (
    <Card className="flex flex-col gap-3">
      <div>
        <div className="font-semibold">The draft hasn't started</div>
        {league.draftAt && (
          <p className="font-medium text-accent">Starts {formatDraftTime(league.draftAt)}</p>
        )}
        <p className="text-sm text-muted">
          {league.teamsJoined} teams · {league.settings.draft.pickSeconds}s per pick · snake order. Queue players now: if
          your clock runs out, autopick uses your queue first.
        </p>
      </div>
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Draft order</div>
        <DraftOrderList league={league} />
      </div>
      {league.isCommissioner ? (
        <>
          {league.teamsJoined < MIN_TEAMS ? (
            <p className="text-sm text-muted">
              You need at least {MIN_TEAMS} teams to draft. {league.teamsJoined} of {league.teamCount} have joined.
            </p>
          ) : (
            league.teamsJoined < league.teamCount && (
              <p className="text-sm text-muted">
                Only {league.teamsJoined} of {league.teamCount} spots are filled. Starting now drafts with {league.teamsJoined} teams.
              </p>
            )
          )}
          <Button
            onClick={() => {
              if (confirm(`Start the draft with ${league.teamsJoined} teams? Rules lock and nobody else can join.`)) onStart();
            }}
            disabled={starting || league.teamsJoined < MIN_TEAMS}
          >
            {starting ? "Starting…" : "Start the draft"}
          </Button>
        </>
      ) : (
        <p className="text-sm text-muted">Waiting for {commissioner} to start it. This page updates by itself.</p>
      )}
    </Card>
  );
}

function CommissionerBar({
  state,
  commishMode,
  setCommishMode,
  onPause,
  onResume,
  onUndo,
}: {
  state: DraftState;
  commishMode: boolean;
  setCommishMode: (on: boolean) => void;
  onPause: () => void;
  onResume: () => void;
  onUndo: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface p-2">
      <span className="px-2 text-xs font-semibold uppercase tracking-wider text-muted">Commissioner</span>
      {state.status === "live" && <Button variant="secondary" className="min-h-9" onClick={onPause}>Pause</Button>}
      {state.status === "paused" && <Button className="min-h-9" onClick={onResume}>Resume</Button>}
      {state.picks.length > 0 && <Button variant="secondary" className="min-h-9" onClick={onUndo}>Undo last pick</Button>}
      {state.status === "live" && (
        <label className="flex items-center gap-2 px-2 text-sm">
          <input type="checkbox" checked={commishMode} onChange={(e) => setCommishMode(e.target.checked)} className="accent-(--color-accent)" />
          Pick for the team on the clock
        </label>
      )}
    </div>
  );
}
