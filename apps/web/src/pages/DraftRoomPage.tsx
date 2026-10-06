import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { MIN_TEAMS, type DraftPlayer, type DraftState, type LeagueDetail, type NrlPosition } from "@nrl/shared";
import { DraftOrderList, formatDraftTime } from "../components/DraftSetup.tsx";
import { ClockBar } from "../components/draft/ClockBar.tsx";
import { BoardPanel, QueuePanel, TeamPanel, picksUntil } from "../components/draft/Panels.tsx";
import { PlayerList } from "../components/draft/PlayerList.tsx";
import { AppShell } from "../components/Layout.tsx";
import { Button, Card, ErrorText, Spinner } from "../components/ui.tsx";
import { useDraftAction, useDraftPlayers, useDraftState, useQueue } from "../lib/draft.ts";
import { useLeague } from "../lib/queries.ts";

type Tab = "players" | "queue" | "board" | "team";

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
  const [tab, setTab] = useState<Tab>("players");
  const [commishMode, setCommishMode] = useState(false);
  const { queue: savedQueue, update: updateQueue, error: queueError } = useQueue(leagueId);
  const wide = useMediaQuery("(min-width: 1024px)");
  const xl = useMediaQuery("(min-width: 1280px)");
  // Desktop below xl has room for one of players/board beside the sidebar.
  const [deskTab, setDeskTab] = useState<"players" | "board">("players");

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

  const tabs: Array<[Tab, string]> = [
    ["players", "Players"],
    ["queue", `Queue${queue.length ? ` (${queue.length})` : ""}`],
    ["board", "Board"],
    ["team", "My team"],
  ];

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
  const queuePanel = <QueuePanel queue={queue} players={byId} takenBy={takenBy} onChange={(ids) => updateQueue(() => ids)} />;
  const teamPanel = <TeamPanel state={state} players={byId} template={template} teamId={myTeamId} />;
  const board = <BoardPanel state={state} players={byId} myTeamId={myTeamId} fill={wide} />;
  const preDraft = state.status === "pending" && (
    <PreDraft league={league} onStart={() => start.mutate()} starting={start.isPending} />
  );
  const column = "flex min-h-0 flex-col gap-4 overflow-y-auto";

  return (
    // Desktop: the room fills the window and each column scrolls on its own.
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <header className="sticky top-0 z-20 shrink-0 bg-bg">
        <div className="flex items-center gap-3 border-b border-border px-4 py-2 lg:px-6">
          <Link to={`/l/${leagueId}`} className="-ml-2 rounded-lg px-2 py-1 text-muted hover:text-text" aria-label="Back to league">
            ←
          </Link>
          <h1 className="truncate font-semibold">{league.name} draft</h1>
        </div>
        <ClockBar state={state} myTeamId={myTeamId} picksUntilMine={until} connection={connection} />
        {onAutopilot && state.status !== "complete" && (
          <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2 px-4 py-2 text-sm lg:px-6">
            <span>You're on autopick: your queue, then best available.</span>
            <Button variant="secondary" className="min-h-9" onClick={() => autopilot.mutate(false)} disabled={autopilot.isPending}>
              I'm back
            </Button>
          </div>
        )}
        <nav className={`flex border-b border-border ${wide ? "hidden" : ""}`} role="tablist">
          {tabs.map(([t, label]) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`min-h-11 flex-1 text-sm font-medium ${tab === t ? "border-b-2 border-accent text-text" : "text-muted"}`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 py-4 lg:min-h-0 lg:px-6">
        {socketError && <ErrorText error={socketError} />}
        <ErrorText error={actionError} />

        {!wide && preDraft}
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

        {/* Phones: tabs. Desktop: players | board | queue + team, or players/board as tabs when narrower. */}
        {wide ? (
          <div
            className={`grid min-h-0 flex-1 gap-6 ${
              xl ? "grid-cols-[360px_minmax(0,1fr)_320px]" : "grid-cols-[minmax(0,1fr)_320px]"
            }`}
          >
            {xl ? (
              <>
                <section className={column} aria-label="Players">
                  {playerList}
                </section>
                {/* Before the draft there's no board yet: the start card takes its place. */}
                <section className="flex min-h-0 flex-col" aria-label="Draft board">
                  {preDraft ? <div className="max-w-xl">{preDraft}</div> : board}
                </section>
              </>
            ) : (
              <section className="flex min-h-0 flex-col gap-3">
                <div className="flex shrink-0 gap-2" role="tablist">
                  {(["players", "board"] as const).map((t) => (
                    <button
                      key={t}
                      role="tab"
                      aria-selected={deskTab === t}
                      onClick={() => setDeskTab(t)}
                      className={`min-h-9 rounded-full px-4 text-sm font-medium ${deskTab === t ? "bg-accent text-bg" : "bg-surface-2 text-muted"}`}
                    >
                      {t === "players" ? "Players" : "Board"}
                    </button>
                  ))}
                </div>
                {deskTab === "players" ? <div className={column}>{playerList}</div> : board}
              </section>
            )}
            <aside className={`${column} gap-6`}>
              {!xl && preDraft}
              <section>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Queue</h2>
                {queuePanel}
              </section>
              <section>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">My team</h2>
                {teamPanel}
              </section>
              {!onAutopilot && state.status === "live" && (
                <button className="self-start text-xs text-muted underline" onClick={() => autopilot.mutate(true)}>
                  Step away: autopick for me
                </button>
              )}
            </aside>
          </div>
        ) : (
          <>
            <div>
              {tab === "players" && playerList}
              {tab === "queue" && queuePanel}
              {tab === "board" && board}
              {tab === "team" && teamPanel}
            </div>
            {!onAutopilot && state.status === "live" && (
              <button className="self-start text-xs text-muted underline" onClick={() => autopilot.mutate(true)}>
                Step away: autopick for me
              </button>
            )}
          </>
        )}
      </main>
    </div>
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

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Buzz and flash the tab title when it becomes your turn. */
function useTurnAlert(myTurn: boolean) {
  const was = useRef(myTurn);
  useEffect(() => {
    if (myTurn && !was.current) {
      navigator.vibrate?.([200, 100, 200]);
      const original = document.title;
      let on = true;
      const id = setInterval(() => {
        document.title = on ? "⏰ Your pick!" : original;
        on = !on;
      }, 1000);
      const stop = () => {
        clearInterval(id);
        document.title = original;
      };
      window.addEventListener("focus", stop, { once: true });
      was.current = myTurn;
      return stop;
    }
    was.current = myTurn;
  }, [myTurn]);
}
