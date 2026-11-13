import { Link, useNavigate, useParams } from "react-router";
import { AppShell } from "../components/Layout.tsx";
import { Button, Card, ErrorText, Spinner } from "../components/ui.tsx";
import { ApiRequestError } from "../lib/api.ts";
import { useAcceptHandover, useHandoverPreview } from "../lib/queries.ts";

/** Opening a commissioner's link to take over a team. */
export function HandoverPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const preview = useHandoverPreview(code);
  const accept = useAcceptHandover(code);

  if (preview.isPending) return <AppShell><Spinner /></AppShell>;
  if (!preview.data) {
    const missing = preview.error instanceof ApiRequestError && preview.error.status === 404;
    return (
      <AppShell>
        <Card className="text-center">
          <p className="font-medium">{missing ? "This link doesn't work any more" : "Couldn't load the link"}</p>
          <p className="mt-1 text-sm text-muted">
            {missing ? "It's been used or taken back. Ask the commissioner for a new one." : (preview.error as Error)?.message}
          </p>
        </Card>
      </AppShell>
    );
  }
  const p = preview.data;
  return (
    <AppShell>
      <Card>
        <p className="text-sm text-muted">You've been offered a team in</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{p.leagueName}</h1>
        <p className="mt-2 text-sm">
          <span className="font-semibold">{p.teamName}</span>
          <span className="text-muted">, run by {p.currentManager} until now. You take over their squad, lineups and place on the ladder.</span>
        </p>
      </Card>
      {p.alreadyMember ? (
        <Card className="text-sm text-muted">
          You already have a team in this league, so you can't take this one too.{" "}
          <Link to={`/l/${p.leagueId}`} className="font-medium text-accent">
            Go to the league
          </Link>
        </Card>
      ) : (
        <>
          <ErrorText error={accept.error} />
          <Button disabled={accept.isPending} onClick={() => accept.mutate(undefined, { onSuccess: (l) => navigate(`/l/${l.id}`) })}>
            {accept.isPending ? "Taking over…" : `Take over ${p.teamName}`}
          </Button>
        </>
      )}
    </AppShell>
  );
}
