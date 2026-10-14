import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";

type Tab = "players" | "queue" | "board" | "team";

/**
 * The draft room's frame, shared by real and mock drafts. Phones get tabs;
 * desktop fills the window with players | board | queue + team, each
 * scrolling on its own (players and board share a column below 1280px).
 */
export function DraftLayout({
  title,
  back,
  backLabel,
  clock,
  banner,
  notices,
  preDraft,
  playerList,
  board,
  queuePanel,
  queueCount,
  teamPanel,
  footer,
}: {
  title: string;
  back: string;
  backLabel: string;
  /** The clock bar, under the title. */
  clock: ReactNode;
  /** A strip under the clock (e.g. "you're on autopick"). */
  banner?: ReactNode;
  /** Errors, status cards and controls above the draft panels. */
  notices?: ReactNode;
  /** Shown before the draft starts: above the panels on phones, in the board's place on desktop. */
  preDraft?: ReactNode;
  playerList: ReactNode;
  /** The board, told whether to fill its column (desktop) or size to its content. */
  board: (fill: boolean) => ReactNode;
  queuePanel: ReactNode;
  queueCount: number;
  teamPanel: ReactNode;
  /** Small actions under the panels (e.g. "step away"). */
  footer?: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("players");
  const wide = useMediaQuery("(min-width: 1024px)");
  const xl = useMediaQuery("(min-width: 1280px)");
  // Desktop below xl has room for one of players/board beside the sidebar.
  const [deskTab, setDeskTab] = useState<"players" | "board">("players");
  const column = "flex min-h-0 flex-col gap-4 overflow-y-auto";

  const tabs: Array<[Tab, string]> = [
    ["players", "Players"],
    ["queue", `Queue${queueCount ? ` (${queueCount})` : ""}`],
    ["board", "Board"],
    ["team", "My team"],
  ];

  return (
    // Desktop: the room fills the window and each column scrolls on its own.
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <header className="sticky top-0 z-20 shrink-0 bg-bg">
        <div className="flex items-center gap-3 border-b border-border px-4 py-2 lg:px-6">
          <Link to={back} className="-ml-2 rounded-lg px-2 py-1 text-muted hover:text-text" aria-label={backLabel}>
            ←
          </Link>
          <h1 className="truncate font-semibold">{title}</h1>
        </div>
        {clock}
        {banner}
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
        {notices}
        {!wide && preDraft}

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
                  {preDraft ? <div className="max-w-xl">{preDraft}</div> : board(true)}
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
                {deskTab === "players" ? <div className={column}>{playerList}</div> : board(true)}
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
              {footer}
            </aside>
          </div>
        ) : (
          <>
            <div>
              {tab === "players" && playerList}
              {tab === "queue" && queuePanel}
              {tab === "board" && board(false)}
              {tab === "team" && teamPanel}
            </div>
            {footer}
          </>
        )}
      </main>
    </div>
  );
}

export function useMediaQuery(query: string): boolean {
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
export function useTurnAlert(myTurn: boolean) {
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
