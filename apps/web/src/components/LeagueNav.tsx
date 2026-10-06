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
    [`/l/${leagueId}`, "Home", true],
    [`/l/${leagueId}/team/${myTeamId}`, "My team", false],
    [`/l/${leagueId}/matchups`, "Matchups", false],
    [`/l/${leagueId}/ladder`, "Ladder", false],
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

/** ‹ Round 5 › with the round's status. */
export function RoundPicker({
  round,
  first,
  last,
  title,
  status,
  onChange,
}: {
  round: number;
  first: number;
  last: number;
  title: string;
  status: string;
  onChange: (round: number) => void;
}) {
  const btn = "size-11 rounded-xl bg-surface-2 text-lg disabled:opacity-30";
  return (
    <div className="flex items-center justify-between gap-2">
      <button className={btn} disabled={round <= first} onClick={() => onChange(round - 1)} aria-label="Previous round">
        ‹
      </button>
      <div className="text-center">
        <div className="font-semibold">{title}</div>
        <div className={`text-xs ${status === "live" ? "text-accent" : "text-muted"}`}>
          {status === "live" ? "● Live" : status === "complete" ? "Final" : "Upcoming"}
        </div>
      </div>
      <button className={btn} disabled={round >= last} onClick={() => onChange(round + 1)} aria-label="Next round">
        ›
      </button>
    </div>
  );
}
