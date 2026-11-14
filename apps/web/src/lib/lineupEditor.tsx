import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  canSwap,
  lineupErrors,
  moveToBench,
  movedLockedPlayers,
  swapSpots,
  type Lineup,
  type RosterTemplate,
  type Spot,
  type TeamRoundView,
} from "@nrl/shared";
import { useSaveLineup } from "./season.ts";

export function spotOccupant(lineup: Lineup, spot: Spot): number | null {
  const [key, idx] = spot.split(":") as [string, string];
  return key === "bench" ? (lineup.bench[Number(idx)] ?? null) : (lineup.starters[key]?.[Number(idx)] ?? null);
}

/**
 * Editing a team's lineup for a round (My team, and your side of a
 * head-to-head): tap a player then where they go, or drag them there.
 * Changes stay local until saved.
 */
export function useLineupEditor({
  leagueId,
  template,
  view,
  loading = false,
}: {
  leagueId: string;
  template: RosterTemplate;
  view: TeamRoundView;
  loading?: boolean;
}) {
  const save = useSaveLineup(leagueId, view.teamId, view.round);
  const [draft, setDraft] = useState<Lineup | null>(null);
  const [selected, setSelected] = useState<Spot | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  // A new round or team resets local edits.
  useEffect(() => {
    setDraft(null);
    setSelected(null);
    setHint(null);
  }, [view.teamId, view.round]);

  const lineup = draft ?? view.lineup;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(view.lineup);
  const players = useMemo(() => new Map(view.players.map((p) => [p.id, p])), [view.players]);
  const squad = useMemo(() => view.players.map((p) => ({ id: p.id, positions: p.positions })), [view.players]);
  const editable = view.editable && !loading;
  const isLocked = (pid: number | null) => pid !== null && !!players.get(pid)?.locked;
  const lockedHint = (pid: number) => `${players.get(pid)?.name ?? "That player"} is locked: their game has started.`;

  /** Swap whatever is in two spots (to the end of the bench: `bench:<length>`), if the rules allow. */
  function move(from: Spot, to: Spot): boolean {
    setHint(null);
    if (!editable || from === to) return false;
    for (const pid of [spotOccupant(lineup, from), spotOccupant(lineup, to)]) {
      if (pid !== null && isLocked(pid)) {
        setHint(lockedHint(pid));
        return false;
      }
    }
    if (!canSwap(template, squad, lineup, from, to)) {
      setHint("They can't play that position.");
      return false;
    }
    const next = swapSpots(lineup, from, to);
    const moved = movedLockedPlayers(view.lineup, next, (pid) => isLocked(pid));
    if (moved.length) {
      const names = moved.map((pid) => players.get(pid)?.name ?? "a player").join(" and ");
      setHint(`That would move ${names}, whose game has started.`);
      return false;
    }
    setDraft(next);
    setSelected(null);
    return true;
  }

  function tap(spot: Spot) {
    setHint(null);
    if (!editable) return;
    const occupant = spotOccupant(lineup, spot);
    if (selected === null) {
      if (occupant !== null && isLocked(occupant)) setHint(lockedHint(occupant));
      else if (occupant !== null) setSelected(spot);
      return;
    }
    if (selected === spot) {
      setSelected(null);
      return;
    }
    move(selected, spot);
  }

  function bench() {
    if (!selected) return;
    setDraft(moveToBench(lineup, selected));
    setSelected(null);
  }

  const errors = dirty ? lineupErrors(template, squad, lineup) : [];
  return {
    lineup,
    dirty,
    players,
    editable,
    selected,
    hint,
    errors,
    saving: save.isPending,
    saveError: save.error ?? (errors.length ? errors.join(". ") : null),
    /** Would a move from `from` to `to` be allowed position-wise? (For highlighting.) */
    canMove: (from: Spot, to: Spot) => from !== to && canSwap(template, squad, lineup, from, to),
    canDrag: (spot: Spot) => {
      const pid = spotOccupant(lineup, spot);
      return editable && pid !== null && !isLocked(pid);
    },
    move,
    tap,
    bench,
    save: () => save.mutate(lineup, { onSuccess: () => setDraft(null) }),
    undo: () => {
      setDraft(null);
      setSelected(null);
      setHint(null);
    },
  };
}

export type LineupEditor = ReturnType<typeof useLineupEditor>;

/**
 * Drag a player from one spot to another. With a mouse the whole row drags;
 * on a touch screen only the grip does (marked `data-drag-handle`), so the
 * list still scrolls. Rows carry `data-drop-spot`, so anything can be a target.
 */
export function useDragMove(onDrop: (from: Spot, to: Spot) => void) {
  const [drag, setDrag] = useState<{ from: Spot; label: string; x: number; y: number; over: Spot | null } | null>(null);
  const pending = useRef<{ from: Spot; label: string; x0: number; y0: number; id: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  useEffect(() => {
    const spotAt = (x: number, y: number) =>
      document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-spot]")?.dataset.dropSpot ?? null;
    function onMove(e: PointerEvent) {
      const p = pending.current;
      if (!p || e.pointerId !== p.id) return;
      if (!p.active) {
        if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 6) return;
        p.active = true;
      }
      e.preventDefault();
      setDrag({ from: p.from, label: p.label, x: e.clientX, y: e.clientY, over: spotAt(e.clientX, e.clientY) });
    }
    function onUp(e: PointerEvent) {
      const p = pending.current;
      if (!p || e.pointerId !== p.id) return;
      pending.current = null;
      if (!p.active) return;
      // The click that follows a drag isn't a tap.
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      setDrag(null);
      const to = spotAt(e.clientX, e.clientY);
      if (to && to !== p.from) dropRef.current(p.from, to);
    }
    function onCancel() {
      pending.current = null;
      setDrag(null);
    }
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, []);

  /** Props for a row that can be dragged (when `draggable`) and dropped on. */
  function rowProps(spot: Spot, label: string, draggable: boolean) {
    return {
      "data-drop-spot": spot,
      onPointerDown: (e: ReactPointerEvent) => {
        if (!draggable || e.button !== 0) return;
        if (e.pointerType !== "mouse" && !(e.target as HTMLElement).closest("[data-drag-handle]")) return;
        pending.current = { from: spot, label, x0: e.clientX, y0: e.clientY, id: e.pointerId, active: false };
      },
      onClickCapture: (e: ReactMouseEvent) => {
        if (suppressClick.current) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
    };
  }

  const ghost = drag ? (
    <div
      aria-hidden
      className="pointer-events-none fixed z-50 rounded-lg border border-accent bg-surface px-3 py-1.5 text-sm font-medium shadow-lg"
      style={{ left: drag.x + 12, top: drag.y + 12 }}
    >
      {drag.label}
    </div>
  ) : null;

  return { drag, rowProps, ghost };
}

/** The grip a row is dragged by on touch screens (and a hint that it drags at all). */
export function DragGrip() {
  return (
    <span
      data-drag-handle
      aria-hidden
      className="-my-2 -mr-2 flex w-8 shrink-0 cursor-grab touch-none select-none items-center justify-center self-stretch text-muted"
    >
      ⠿
    </span>
  );
}
