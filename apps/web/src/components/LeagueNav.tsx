import { NavLink } from "react-router";

/**
 * An in-season league's tabs: a bottom bar on phones, links in the header on
 * desktop. AppShell renders both; each shows only at its own size.
 */
export function LeagueTabs({
  leagueId,
  myTeamId,
  variant,
}: {
  leagueId: string;
  myTeamId: string;
  variant: "bottom" | "header";
}) {
  const tabs: Array<[string, string, boolean]> = [
    [`/league`, "Home", true],
    ["/myteam", "My team", false],
    [`/players`, "Players", false],
    [`/matchups`, "Matchups", false],
    [`/ladder`, "Ladder", false],
  ];
  if (variant === "header") {
    return (
      <nav aria-label="League" className="ml-4 hidden self-stretch lg:flex">
        {tabs.map(([to, label, end]) => (
          <NavLink
            key={label}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center border-b-2 px-3 text-sm font-medium ${
                isActive ? "border-accent text-text" : "border-transparent text-muted hover:text-text"
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
    );
  }
  return (
    <nav
      aria-label="League"
      className="fixed inset-x-0 bottom-0 z-20 border-t lg:hidden border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <div className="mx-auto flex max-w-2xl">
        {tabs.map(([to, label, end]) => (
          <NavLink
            key={label}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex min-h-14 flex-1 items-center justify-center text-sm font-medium ${isActive ? "text-accent" : "text-muted"}`
            }
          >
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/** ‹ Round [5 ▾] › with the round's status: step with the arrows, or jump with the dropdown. */
export function RoundPicker({
  round,
  first,
  last,
  title,
  status,
  loading = false,
  onChange,
}: {
  round: number;
  first: number;
  last: number;
  /** The round's own name; shown when it's more than "Round N" (finals weeks). */
  title: string;
  status: string;
  /** The round asked for is still on its way (the status shown is the last round's). */
  loading?: boolean;
  onChange: (round: number) => void;
}) {
  const btn = "size-11 rounded-xl bg-surface-2 text-lg disabled:opacity-30";
  const rounds = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
  const named = title && title !== `Round ${round}` ? title : null;
  return (
    <div className="flex items-center justify-between gap-2">
      <button className={btn} disabled={round <= first} onClick={() => onChange(round - 1)} aria-label="Previous round">
        ‹
      </button>
      <div className="text-center">
        <label className="inline-flex items-center gap-1.5 font-semibold">
          Round
          <select
            aria-label="Round"
            value={round}
            onChange={(e) => onChange(Number(e.target.value))}
            className="min-h-9 rounded-lg border border-border bg-surface-2 px-2 font-semibold text-text focus:border-accent focus:outline-none"
          >
            {rounds.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className={`text-xs ${status === "live" && !loading ? "text-accent" : "text-muted"}`}>
          {loading ? "Loading…" : status === "live" ? "● Live" : status === "complete" ? "Final" : "Upcoming"}
          {named && !loading ? ` · ${named}` : ""}
        </div>
      </div>
      <button className={btn} disabled={round >= last} onClick={() => onChange(round + 1)} aria-label="Next round">
        ›
      </button>
    </div>
  );
}
