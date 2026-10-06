import { POSITION_GROUP_LABELS, positionGroup, type NrlPosition, type PositionGroup } from "@nrl/shared";

// Full class names (not built from parts) so Tailwind sees them.
export const GROUP_STYLES: Record<PositionGroup | "none", { badge: string; cell: string; dot: string }> = {
  half: { badge: "bg-pos-half/15 text-pos-half", cell: "border-l-pos-half bg-pos-half/10", dot: "bg-pos-half" },
  fwd: { badge: "bg-pos-fwd/15 text-pos-fwd", cell: "border-l-pos-fwd bg-pos-fwd/10", dot: "bg-pos-fwd" },
  ob: { badge: "bg-pos-ob/15 text-pos-ob", cell: "border-l-pos-ob bg-pos-ob/10", dot: "bg-pos-ob" },
  none: { badge: "bg-surface-2 text-muted", cell: "border-l-border bg-surface", dot: "bg-muted" },
};

export function groupStyle(positions: readonly NrlPosition[]) {
  return GROUP_STYLES[positionGroup(positions) ?? "none"];
}

/** "FRF/2RF" in the player's position-group colour. */
export function PositionBadge({ positions, className = "" }: { positions: readonly NrlPosition[]; className?: string }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold leading-none ${groupStyle(positions).badge} ${className}`}>
      {positions.length ? positions.join("/") : "No pos"}
    </span>
  );
}

export function PositionLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Position colours">
      {(Object.keys(POSITION_GROUP_LABELS) as PositionGroup[]).map((g) => (
        <li key={g} className="flex items-center gap-1.5">
          <span className={`size-2.5 rounded-full ${GROUP_STYLES[g].dot}`} aria-hidden />
          {POSITION_GROUP_LABELS[g]}
        </li>
      ))}
    </ul>
  );
}
