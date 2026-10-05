import { Link } from "react-router";
import { AppShell } from "../components/Layout.tsx";
import { Card, ErrorText, Spinner } from "../components/ui.tsx";
import { useMyLeagues } from "../lib/queries.ts";

const STATUS_LABEL = { setup: "Pre-draft", drafting: "Drafting", inSeason: "In season", complete: "Complete" } as const;

export function LeaguesPage() {
  const { data: leagues, isPending, error } = useMyLeagues();

  return (
    <AppShell>
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

      <ul className="flex flex-col gap-3">
        {leagues?.map((l) => (
          <li key={l.id}>
            <Link
              to={`/l/${l.id}`}
              className="flex items-center justify-between rounded-2xl border border-border bg-surface p-4 hover:border-accent"
            >
              <div>
                <div className="font-semibold">{l.name}</div>
                <div className="text-sm text-muted">
                  {l.season} · {l.teamsJoined}/{l.teamCount} teams{l.isCommissioner ? " · Commissioner" : ""}
                </div>
              </div>
              <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted">{STATUS_LABEL[l.status]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
