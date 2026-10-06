import { useMemo, useState } from "react";
import {
  NRL_POSITIONS,
  checkDraftable,
  type DraftPlayer,
  type NrlPosition,
  type RosterTemplate,
} from "@nrl/shared";
import { PositionBadge } from "../Position.tsx";
import { inputClass } from "../ui.tsx";

const PAGE = 60;

export function PlayerList({
  players,
  takenBy,
  queue,
  template,
  myRoster,
  canPick,
  pickLabel,
  busy,
  onPick,
  onToggleQueue,
}: {
  players: DraftPlayer[];
  /** playerId -> team name, for drafted players */
  takenBy: Map<number, string>;
  queue: number[];
  template: RosterTemplate;
  myRoster: NrlPosition[][];
  /** Whether the Draft button is live (your turn, or commissioner picking for someone). */
  canPick: boolean;
  pickLabel: string;
  busy: boolean;
  onPick: (p: DraftPlayer) => void;
  onToggleQueue: (id: number) => void;
}) {
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<NrlPosition | "ALL">("ALL");
  const [showTaken, setShowTaken] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return players.filter(
      (p) =>
        (showTaken || !takenBy.has(p.id)) &&
        (pos === "ALL" || p.positions.includes(pos)) &&
        words.every((w) => p.name.toLowerCase().includes(w) || p.club?.nickName.toLowerCase().includes(w)),
    );
  }, [players, takenBy, q, pos, showTaken]);
  const queued = new Set(queue);

  return (
    <div className="flex flex-col gap-3">
      {/* Desktop: the list scrolls in its own column, so the filters stay put. */}
      <div className="flex flex-col gap-3 lg:sticky lg:top-0 lg:z-10 lg:bg-bg lg:pb-1">
        <input
          type="search"
          className={inputClass}
          placeholder="Search players or clubs"
          aria-label="Search players"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setLimit(PAGE);
          }}
        />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0" role="group" aria-label="Filter by position">
          {(["ALL", ...NRL_POSITIONS] as const).map((p) => (
            <button
              key={p}
              aria-pressed={pos === p}
              onClick={() => {
                setPos(p);
                setLimit(PAGE);
              }}
              className={`min-h-9 shrink-0 rounded-full px-3 text-sm font-medium ${pos === p ? "bg-accent text-bg" : "bg-surface-2 text-muted"}`}
            >
              {p === "ALL" ? "All" : p}
            </button>
          ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={showTaken} onChange={(e) => setShowTaken(e.target.checked)} className="accent-(--color-accent)" />
        Show drafted players
      </label>
      </div>

      <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-surface">
        {filtered.slice(0, limit).map((p) => {
          const taken = takenBy.get(p.id);
          const check = checkDraftable(template, myRoster, p.positions);
          return (
            <li key={p.id} className={`flex items-center gap-3 px-3 py-2.5 ${taken ? "opacity-50" : ""}`}>
              <span className="w-7 shrink-0 text-right font-mono text-xs text-muted">{p.rank}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.name}</div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  <span>{p.club?.nickName ?? "—"}</span>
                  <PositionBadge positions={p.positions} />
                  <span>
                    {p.avgPoints} avg · {p.games} gm
                  </span>
                  {taken && <span>· {taken}</span>}
                </div>
              </div>
              {!taken && (
                <>
                  <button
                    onClick={() => onToggleQueue(p.id)}
                    aria-pressed={queued.has(p.id)}
                    aria-label={queued.has(p.id) ? `Remove ${p.name} from queue` : `Queue ${p.name}`}
                    className={`size-10 shrink-0 rounded-xl text-lg ${queued.has(p.id) ? "text-accent" : "text-muted hover:text-text"}`}
                  >
                    {queued.has(p.id) ? "★" : "☆"}
                  </button>
                  {canPick && (
                    <button
                      onClick={() => onPick(p)}
                      disabled={busy || !check.ok}
                      title={check.ok ? undefined : check.reason}
                      className="min-h-10 shrink-0 rounded-xl bg-accent px-3 text-sm font-semibold text-bg disabled:bg-surface-2 disabled:text-muted"
                    >
                      {pickLabel}
                    </button>
                  )}
                </>
              )}
            </li>
          );
        })}
        {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No players match.</li>}
      </ul>
      {filtered.length > limit && (
        <button className="min-h-11 rounded-xl bg-surface-2 text-sm font-medium" onClick={() => setLimit((l) => l + PAGE)}>
          Show more ({filtered.length - limit} left)
        </button>
      )}
    </div>
  );
}
