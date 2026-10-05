import type { DraftState } from "@nrl/shared";
import { roundOf } from "@nrl/shared";
import { formatClock, useCountdown, type Connection } from "../../lib/draft.ts";

export function ClockBar({
  state,
  myTeamId,
  picksUntilMine,
  connection,
}: {
  state: DraftState;
  myTeamId: string;
  picksUntilMine: number | null;
  connection: Connection;
}) {
  const seconds = useCountdown(state);
  const onClock = state.order.find((t) => t.id === state.onClockTeamId);
  const mine = state.onClockTeamId === myTeamId;
  const autopilot = !!state.onClockTeamId && state.autopilotTeamIds.includes(state.onClockTeamId);
  const urgent = seconds !== null && seconds <= 10 && state.status === "live";

  return (
    <div
      className={`border-b px-4 py-3 ${mine && state.status === "live" ? "border-accent bg-accent/10" : "border-border bg-surface"}`}
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {state.status === "live" || state.status === "paused" ? (
            <>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                Round {roundOf(state.order.length, state.currentPick)} · Pick {state.currentPick} of {state.totalPicks}
              </div>
              <div className={`truncate text-lg font-bold ${mine ? "text-accent" : ""}`}>
                {mine ? "You're on the clock" : `${onClock?.name ?? "…"} is picking`}
              </div>
              <div className="text-xs text-muted">
                {state.status === "paused"
                  ? "Paused by the commissioner"
                  : autopilot
                    ? "On autopick"
                    : picksUntilMine === null
                      ? "Your squad is full"
                      : picksUntilMine === 0
                        ? "Make your pick"
                        : `Your pick in ${picksUntilMine}`}
              </div>
            </>
          ) : state.status === "complete" ? (
            <div className="text-lg font-bold">Draft complete</div>
          ) : (
            <div className="text-lg font-bold">Waiting to start</div>
          )}
        </div>
        {seconds !== null && (
          <div
            className={`shrink-0 font-mono text-3xl font-bold tabular-nums ${
              state.status === "paused" ? "text-muted" : urgent ? "text-danger" : mine ? "text-accent" : ""
            }`}
            aria-label={`${seconds} seconds left`}
          >
            {formatClock(seconds)}
          </div>
        )}
      </div>
      {connection !== "live" && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted" role="status">
          <span className="size-2 animate-pulse rounded-full bg-danger" />
          {connection === "connecting" ? "Connecting…" : "Reconnecting… the draft carries on without you"}
        </div>
      )}
    </div>
  );
}
