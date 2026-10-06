import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { authClient } from "../lib/auth.ts";
import { LeagueTabs } from "./LeagueNav.tsx";
import { Avatar, Spinner } from "./ui.tsx";

/** Content width: forms and short pages stay narrow; the rest use a desktop's width. */
const WIDTHS = { narrow: "max-w-2xl", wide: "max-w-2xl lg:max-w-6xl" } as const;

export function AppShell({
  children,
  title,
  back,
  width = "narrow",
  league,
}: {
  children: ReactNode;
  title?: string;
  back?: string;
  width?: keyof typeof WIDTHS;
  /** Inside an in-season league: its tabs (bottom bar on phones, in the header on desktop). */
  league?: { id: string; myTeamId: string };
}) {
  const { data: session } = authClient.useSession();
  const container = `mx-auto w-full ${WIDTHS[width]}`;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
        <div className={`${container} flex items-center gap-3 px-4 py-3 lg:h-14 lg:py-0`}>
          {back && (
            <Link to={back} className="-ml-2 rounded-lg px-2 py-1 text-muted hover:text-text" aria-label="Back">
              ←
            </Link>
          )}
          <Link to="/leagues" className={`font-bold tracking-tight ${back ? "hidden lg:block" : ""}`}>
            NRL Draft
          </Link>
          {title && (
            <h1 className="truncate font-semibold lg:border-l lg:border-border lg:pl-3 lg:text-muted">{title}</h1>
          )}
          {league && <LeagueTabs leagueId={league.id} myTeamId={league.myTeamId} variant="header" />}
          <div className="ml-auto shrink-0">
            {session && (
              <Link to="/profile" aria-label="Profile">
                <Avatar name={session.user.name} image={session.user.image ?? null} />
              </Link>
            )}
          </div>
        </div>
      </header>
      {/* Bottom padding leaves room for the phone tab bar. */}
      <main className={`${container} flex flex-1 flex-col gap-4 px-4 py-4 lg:py-6 ${league ? "pb-24 lg:pb-6" : ""}`}>
        {children}
      </main>
      {league && <LeagueTabs leagueId={league.id} myTeamId={league.myTeamId} variant="bottom" />}
    </div>
  );
}

/** Renders children only for signed-in users; otherwise sends them to sign in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  const location = useLocation();
  if (isPending) return <Spinner />;
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/?next=${next}`} replace />;
  }
  return <>{children}</>;
}
