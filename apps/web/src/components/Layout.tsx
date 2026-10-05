import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { authClient } from "../lib/auth.ts";
import { Avatar, Spinner } from "./ui.tsx";

export function AppShell({ children, title, back }: { children: ReactNode; title?: string; back?: string }) {
  const { data: session } = authClient.useSession();
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur">
        {back ? (
          <Link to={back} className="-ml-2 rounded-lg px-2 py-1 text-muted hover:text-text" aria-label="Back">
            ←
          </Link>
        ) : (
          <Link to="/leagues" className="font-bold tracking-tight">
            NRL Draft
          </Link>
        )}
        {title && <h1 className="truncate font-semibold">{title}</h1>}
        <div className="ml-auto">
          {session && (
            <Link to="/profile" aria-label="Profile">
              <Avatar name={session.user.name} image={session.user.image ?? null} />
            </Link>
          )}
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-4 px-4 py-4">{children}</main>
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
