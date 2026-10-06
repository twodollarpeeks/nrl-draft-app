import { Link } from "react-router";
import { AppShell } from "../components/Layout.tsx";
import { Card, ErrorText, Spinner } from "../components/ui.tsx";
import { useMyLeagues } from "../lib/queries.ts";

const STATUS_LABEL = { setup: "Pre-draft", drafting: "Drafting", inSeason: "In season", complete: "Complete" } as const;

export function LeaguesPage() {
  const { data: leagues, isPending, error } = useMyLeagues();

  return (
    <AppShell width="wide">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Your leagues</h1>
        <Link
          to="/leagues/new"
          className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-bg hover:brightness-110"
        >
          + New league
        </Link>
      </div>

      {isPending && <Spinner />}
      <ErrorText error={error} />

      {leagues?.length === 0 && (
        <Card className="text-center">
          <p className="font-medium">No leagues yet</p>
          <p className="mt-1 text-sm text-muted">Create one and send the invite link to your mates, or open a link a mate sent you.</p>
        </Card>
      )}

      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {leagues?.map((l) => (
          <li key={l.id}>
            <Link
              to={`/l/${l.id}`}
              className="flex h-full items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-accent"
            >
              <div className="min-w-0">
                <div className="truncate font-semibold">{l.name}</div>
                <div className="text-sm text-muted">
                  {l.season} · {l.teamsJoined}/{l.teamCount} teams{l.isCommissioner ? " · Commissioner" : ""}
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted">{STATUS_LABEL[l.status]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
