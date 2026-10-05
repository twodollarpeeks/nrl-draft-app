import type { DraftOrderMode, LeagueDetail } from "@nrl/shared";
import { Button, ErrorText, inputClass } from "./ui.tsx";

/** ISO time -> the value a datetime-local input wants, in the viewer's time zone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value (viewer's time zone) -> ISO, or null when empty. */
export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

/** "Sat 14 Feb, 7:30 pm AEDT" in the viewer's time zone. */
export function formatDraftTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

const MODES: Array<[DraftOrderMode, string, string]> = [
  ["randomWhenFull", "Randomise & lock when the league is full", "Drawn the moment the last team joins, then fixed. Everyone sees it."],
  ["manual", "Set it myself", "Arrange the order, or shuffle it, any time before the draft."],
];

/** Draft date/time and how the order is decided: on the create and settings pages. */
export function DraftScheduleFields({
  draftAt,
  onDraftAt,
  mode,
  onMode,
  orderLocked = false,
}: {
  draftAt: string | null;
  onDraftAt: (iso: string | null) => void;
  mode: DraftOrderMode;
  onMode: (mode: DraftOrderMode) => void;
  orderLocked?: boolean;
}) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium" htmlFor="draft-at">
          Draft date & time
        </label>
        <div className="flex gap-2">
          <input
            id="draft-at"
            type="datetime-local"
            className={`${inputClass} min-w-0 flex-1`}
            value={toLocalInput(draftAt)}
            min={toLocalInput(new Date(Date.now() + 5 * 60_000).toISOString())}
            onChange={(e) => onDraftAt(fromLocalInput(e.target.value))}
          />
          {draftAt && (
            <Button type="button" variant="ghost" onClick={() => onDraftAt(null)}>
              Clear
            </Button>
          )}
        </div>
        <span className="text-xs text-muted">
          {draftAt
            ? `Starts by itself at ${formatDraftTime(draftAt)}. You can still start it early.`
            : "Optional. Without a time, you start the draft yourself."}{" "}
          Times are in your time zone ({zone}).
        </span>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Draft order</legend>
        {orderLocked ? (
          <p className="text-sm text-muted">Drawn when the league filled, and locked.</p>
        ) : (
          MODES.map(([m, label, hint]) => (
            <label key={m} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 has-checked:border-accent">
              <input
                type="radio"
                name="draft-order-mode"
                className="mt-1 accent-(--color-accent)"
                checked={mode === m}
                onChange={() => onMode(m)}
              />
              <span>
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-muted">{hint}</span>
              </span>
            </label>
          ))
        )}
      </fieldset>
    </div>
  );
}

/**
 * The draft order as it stands. Read-only for members (and once locked);
 * the commissioner can rearrange it in manual mode.
 */
export function DraftOrderList({
  league,
  editable = false,
  onChange,
  onRandomise,
  busy = false,
  error,
}: {
  league: LeagueDetail;
  editable?: boolean;
  onChange?: (teamIds: string[]) => void;
  onRandomise?: () => void;
  busy?: boolean;
  error?: unknown;
}) {
  const byId = new Map(league.teams.map((t) => [t.id, t]));
  const order = league.draftOrder;

  if (order.length === 0) {
    return (
      <p className="text-sm text-muted">
        {league.draftOrderMode === "randomWhenFull"
          ? `Drawn at random when the league is full (${league.teamsJoined}/${league.teamCount} so far).`
          : "Not set yet."}
      </p>
    );
  }

  const move = (i: number, by: number) => {
    const next = [...order];
    const [id] = next.splice(i, 1);
    next.splice(i + by, 0, id!);
    onChange?.(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col divide-y divide-border rounded-xl border border-border">
        {order.map((id, i) => {
          const t = byId.get(id);
          return (
            <li key={id} className={`flex items-center gap-3 px-3 py-2 ${id === league.myTeamId ? "text-accent" : ""}`}>
              <span className="w-5 text-right font-mono text-xs text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{t?.name}</div>
                <div className="truncate text-xs text-muted">{t?.owner.name}</div>
              </div>
              {editable && (
                <>
                  <button type="button" className="size-9 rounded-lg text-muted hover:text-text disabled:opacity-30" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${t?.name} up`}>
                    ↑
                  </button>
                  <button type="button" className="size-9 rounded-lg text-muted hover:text-text disabled:opacity-30" disabled={busy || i === order.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${t?.name} down`}>
                    ↓
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ol>
      {league.draftOrderLocked && <p className="text-xs text-muted">Drawn when the league filled. Locked.</p>}
      {editable && onRandomise && (
        <Button type="button" variant="secondary" className="self-start" disabled={busy} onClick={onRandomise}>
          Randomise
        </Button>
      )}
      <ErrorText error={error} />
    </div>
  );
}
