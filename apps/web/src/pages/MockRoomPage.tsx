import { useEffect, useMemo, useRef } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router";
import { MAX_TEAMS, MIN_TEAMS, type DraftPlayer, type MockPool } from "@nrl/shared";
import { ClockBar } from "../components/draft/ClockBar.tsx";
import { DraftLayout, useTurnAlert } from "../components/draft/DraftLayout.tsx";
import { BoardPanel, QueuePanel, TeamPanel, picksUntil } from "../components/draft/Panels.tsx";
import { PlayerList } from "../components/draft/PlayerList.tsx";
import { AppShell } from "../components/Layout.tsx";
import { Button, Card, ErrorText, Spinner } from "../components/ui.tsx";
import { CPU_SPEEDS, useMockPool, useMockRoom, useSaveMock, type MockConfig } from "../lib/mock.ts";

/** A mock draft in progress. Settings come from the URL; refreshing starts a fresh mock. */
export function MockRoomPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const pool = useMockPool();

  const teamCount = Number(params.get("teams"));
  const slot = Number(params.get("slot"));
  const pickSeconds = Number(params.get("clock") ?? 0);
  const speed = params.get("speed") === "fast" ? "fast" : "normal";
  const valid =
    Number.isInteger(teamCount) && teamCount >= MIN_TEAMS && teamCount <= MAX_TEAMS &&
    Number.isInteger(slot) && slot >= 1 && slot <= teamCount &&
    Number.isInteger(pickSeconds) && pickSeconds >= 0 && pickSeconds <= 600;
  if (!valid) return <Navigate to="/mock" replace />;

  if (!pool.data) {
    return (
      <AppShell title="Mock draft" back="/mock">
        {pool.error ? <ErrorText error={pool.error} /> : <Spinner />}
      </AppShell>
    );
  }
  // A new key per visit, so "start again" gets a fresh room.
  return (
    <MockRoom
      key={location.key}
      config={{ teamCount, slot, pickSeconds, cpuDelayMs: CPU_SPEEDS[speed] }}
      pool={pool.data}
    />
  );
}

function MockRoom({ config, pool }: { config: MockConfig; pool: MockPool }) {
  const room = useMockRoom(config, pool.players, pool.roster);
  const { state, myTeamId } = room;
  const save = useSaveMock();
  const saving = useRef(false);

  const byId = useMemo(() => new Map<number, DraftPlayer>(pool.players.map((p) => [p.id, p])), [pool.players]);
  const teamName = new Map(state.order.map((t) => [t.id, t.name]));
  const takenBy = new Map(state.picks.map((p) => [p.playerId, teamName.get(p.teamId) ?? "Taken"]));
  const myTurn = state.status === "live" && state.onClockTeamId === myTeamId;
  const myRoster = state.picks.filter((p) => p.teamId === myTeamId).map((p) => byId.get(p.playerId)?.positions ?? []);
  useTurnAlert(myTurn);

  // Save it to the history as soon as it's finished.
  useEffect(() => {
    if (state.status === "complete" && !saving.current) {
      saving.current = true;
      save.mutate(room.result());
    }
  }, [state.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving mid-draft loses it: check first.
  useEffect(() => {
    if (state.status === "complete") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.status]);

  const restart = `/mock/play?teams=${config.teamCount}&slot=${config.slot}&clock=${config.pickSeconds}&speed=${
    config.cpuDelayMs === CPU_SPEEDS.fast ? "fast" : "normal"
  }`;

  return (
    <DraftLayout
      title={`Mock draft · ${config.teamCount} teams, pick ${config.slot}`}
      back="/mock"
      backLabel="Back to mock drafts"
      clock={
        <ClockBar
          state={state}
          myTeamId={myTeamId}
          picksUntilMine={state.status === "complete" ? null : picksUntil(state, myTeamId)}
          connection="live"
          pausedText="Paused"
        />
      }
      banner={
        room.autopilot &&
        state.status !== "complete" && (
          <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2 px-4 py-2 text-sm lg:px-6">
            <span>You're on autopick: your queue, then best available.</span>
            <Button variant="secondary" className="min-h-9" onClick={() => room.setAutopilot(false)}>
              I'm back
            </Button>
          </div>
        )
      }
      notices={
        state.status === "complete" ? (
          <Card className="flex shrink-0 flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold">Mock draft done 🏉</div>
              <div className="text-sm text-muted">
                {save.isPending ? "Saving to your history…" : save.isSuccess ? "Saved to your history." : ""}
              </div>
              <ErrorText error={save.error} />
            </div>
            <div className="flex flex-wrap gap-2">
              {save.isError && (
                <Button variant="secondary" onClick={() => save.mutate(room.result())}>
                  Try saving again
                </Button>
              )}
              <Link to={restart} className="inline-flex min-h-11 items-center rounded-xl bg-surface-2 px-4 text-sm font-semibold hover:bg-border">
                Another mock
              </Link>
              {save.data && (
                <Link to={`/mock/${save.data.id}`} className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-bg">
                  See results
                </Link>
              )}
            </div>
          </Card>
        ) : (
          <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface p-2">
            <span className="px-2 text-xs font-semibold uppercase tracking-wider text-muted">Mock</span>
            {state.status === "live" ? (
              <Button variant="secondary" className="min-h-9" onClick={room.pause}>
                Pause
              </Button>
            ) : (
              <Button className="min-h-9" onClick={room.resume}>
                Resume
              </Button>
            )}
            <Link
              to={restart}
              className="inline-flex min-h-9 items-center rounded-xl px-3 text-sm font-semibold text-muted hover:text-text"
              onClick={(e) => {
                if (!confirm("Start again? This mock won't be saved.")) e.preventDefault();
              }}
            >
              Start again
            </Link>
          </div>
        )
      }
      playerList={
        <PlayerList
          players={pool.players}
          takenBy={takenBy}
          queue={room.queue}
          template={pool.roster}
          myRoster={myRoster}
          canPick={myTurn}
          pickLabel="Draft"
          busy={false}
          onPick={(p) => room.pick(p.id)}
          onToggleQueue={(id) => room.setQueue((cur) => (cur.includes(id) ? cur.filter((q) => q !== id) : [...cur, id]))}
        />
      }
      board={(fill) => <BoardPanel state={state} players={byId} myTeamId={myTeamId} fill={fill} />}
      queuePanel={<QueuePanel queue={room.queue} players={byId} takenBy={takenBy} onChange={(ids) => room.setQueue(ids)} />}
      queueCount={room.queue.length}
      teamPanel={<TeamPanel state={state} players={byId} template={pool.roster} teamId={myTeamId} />}
      footer={
        !room.autopilot &&
        state.status === "live" && (
          <button className="self-start text-xs text-muted underline" onClick={() => room.setAutopilot(true)}>
            Autopick the rest for me
          </button>
        )
      }
    />
  );
}
