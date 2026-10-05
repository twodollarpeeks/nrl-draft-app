import {
  roundOf,
  startersFillable,
  starterCount,
  teamForPick,
  type DraftPlayer,
  type DraftState,
  type NrlPosition,
  type RosterTemplate,
} from "@nrl/shared";

export function QueuePanel({
  queue,
  players,
  takenBy,
  onChange,
}: {
  queue: number[];
  players: Map<number, DraftPlayer>;
  takenBy: Map<number, string>;
  onChange: (ids: number[]) => void;
}) {
  const move = (i: number, by: number) => {
    const next = [...queue];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item!);
    onChange(next);
  };
  if (queue.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted">
        Tap ☆ on players to queue them. If your time runs out, autopick takes the first one still available, then the
        best available player.
      </p>
    );
  }
  return (
    <ol className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-surface">
      {queue.map((id, i) => {
        const p = players.get(id);
        return (
          <li key={id} className={`flex items-center gap-2 px-3 py-2 ${takenBy.has(id) ? "opacity-50 line-through" : ""}`}>
            <span className="w-5 font-mono text-xs text-muted">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{p?.name ?? `Player ${id}`}</div>
              <div className="text-xs text-muted">
                {p?.positions.join("/")} · {p?.club?.nickName}
              </div>
            </div>
            <button className="size-9 rounded-lg text-muted hover:text-text disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${p?.name} up`}>
              ↑
            </button>
            <button className="size-9 rounded-lg text-muted hover:text-text disabled:opacity-30" disabled={i === queue.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${p?.name} down`}>
              ↓
            </button>
            <button className="size-9 rounded-lg text-muted hover:text-danger" onClick={() => onChange(queue.filter((q) => q !== id))} aria-label={`Remove ${p?.name}`}>
              ✕
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function BoardPanel({
  state,
  players,
  myTeamId,
}: {
  state: DraftState;
  players: Map<number, DraftPlayer>;
  myTeamId: string;
}) {
  if (state.order.length === 0 || state.rounds === 0) {
    return <p className="text-sm text-muted">The board appears once the draft starts and the order is drawn.</p>;
  }
  const byPick = new Map(state.picks.map((p) => [p.pickNo, p]));
  const n = state.order.length;
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 bg-bg" />
            {state.order.map((t) => (
              <th
                key={t.id}
                scope="col"
                className={`w-28 min-w-28 truncate rounded-lg px-2 py-1.5 text-left font-semibold ${t.id === myTeamId ? "bg-accent/15 text-accent" : "bg-surface-2"}`}
              >
                {t.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: state.rounds }, (_, r) => (
            <tr key={r}>
              <th scope="row" className="sticky left-0 bg-bg pr-1 text-right font-mono text-muted">
                {r + 1}
              </th>
              {state.order.map((t, col) => {
                // Snake: the cell's pick number depends on the round's direction.
                const inRound = (r + 1) % 2 === 1 ? col : n - 1 - col;
                const pickNo = r * n + inRound + 1;
                const pick = byPick.get(pickNo);
                const p = pick ? players.get(pick.playerId) : undefined;
                const current = pickNo === state.currentPick && state.status !== "complete";
                return (
                  <td
                    key={t.id}
                    className={`h-12 w-28 min-w-28 rounded-lg px-2 align-top ${
                      current ? "ring-2 ring-accent" : ""
                    } ${pick ? (pick.madeBy === "autopick" ? "bg-surface-2/60" : "bg-surface") : "bg-surface/40"}`}
                  >
                    <div className="font-mono text-[10px] text-muted">
                      {roundOf(n, pickNo)}.{inRound + 1}
                      {pick?.madeBy === "autopick" && " · auto"}
                    </div>
                    {p && (
                      <>
                        <div className="truncate font-medium">{p.name}</div>
                        <div className="text-[10px] text-muted">{p.positions.join("/")}</div>
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TeamPanel({
  state,
  players,
  template,
  teamId,
}: {
  state: DraftState;
  players: Map<number, DraftPlayer>;
  template: RosterTemplate;
  teamId: string;
}) {
  const mine = state.picks.filter((p) => p.teamId === teamId).map((p) => players.get(p.playerId)!).filter(Boolean);
  const roster: NrlPosition[][] = mine.map((p) => p.positions);
  const filled = startersFillable(template, roster);
  const total = starterCount(template);
  const squad = total + template.benchSize;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-2xl font-bold">
            {mine.length}/{squad}
          </div>
          <div className="text-xs text-muted">Squad</div>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <div className={`text-2xl font-bold ${filled < total ? "" : "text-accent"}`}>
            {filled}/{total}
          </div>
          <div className="text-xs text-muted">Starting spots covered</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-muted">
        {template.slots.map((s) => (
          <span key={s.key} className="rounded-full bg-surface-2 px-2 py-1">
            {s.count}× {s.label} ({s.eligible.join("/")})
          </span>
        ))}
      </div>
      {mine.length === 0 ? (
        <p className="text-sm text-muted">No players yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-surface">
          {mine.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-3 py-2">
              <span className="truncate text-sm font-medium">{p.name}</span>
              <span className="text-xs text-muted">
                {p.positions.join("/")} · {p.club?.nickName}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** How many picks until `teamId` is up (0 = now), or null if they have no picks left. */
export function picksUntil(state: DraftState, teamId: string): number | null {
  const ids = state.order.map((t) => t.id);
  for (let p = state.currentPick; p <= state.totalPicks; p++) {
    if (teamForPick(ids, p) === teamId) return p - state.currentPick;
  }
  return null;
}
