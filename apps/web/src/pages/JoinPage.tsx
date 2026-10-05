import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { AppShell } from "../components/Layout.tsx";
import { Button, Card, ErrorText, Field, Spinner, inputClass } from "../components/ui.tsx";
import { ApiRequestError } from "../lib/api.ts";
import { useInvite, useJoinLeague } from "../lib/queries.ts";

export function JoinPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const { data: invite, isPending, error } = useInvite(code);
  const join = useJoinLeague(code);
  const [teamName, setTeamName] = useState("");

  if (isPending) return <AppShell><Spinner /></AppShell>;
  if (!invite) {
    const missing = error instanceof ApiRequestError && error.status === 404;
    return (
      <AppShell>
        <Card className="text-center">
          <p className="font-medium">{missing ? "This invite link doesn't work" : "Couldn't load the invite"}</p>
          <p className="mt-1 text-sm text-muted">
            {missing ? "It may have been reset. Ask your commissioner for a new link." : (error as Error)?.message}
          </p>
        </Card>
      </AppShell>
    );
  }
  if (invite.alreadyMember) return <Navigate to={`/l/${invite.leagueId}`} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const league = await join.mutateAsync(teamName.trim() || undefined);
    navigate(`/l/${league.id}`);
  }

  return (
    <AppShell>
      <Card>
        <p className="text-sm text-muted">{invite.commissionerName} invited you to</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{invite.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {invite.season} season · {invite.teamsJoined}/{invite.teamCount} teams
        </p>
      </Card>

      {invite.canJoin ? (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Card>
            <Field label="Your team name" hint="Optional, you can change it later">
              <input className={inputClass} value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={30} placeholder="Leave blank for “Your name's Team”" />
            </Field>
          </Card>
          <ErrorText error={join.error} />
          <Button type="submit" disabled={join.isPending}>
            {join.isPending ? "Joining…" : "Join league"}
          </Button>
        </form>
      ) : (
        <Card>
          <p className="text-sm text-muted">
            {invite.reason === "full" ? "This league is full." : "This league has already drafted, so it can't take new teams."}
          </p>
        </Card>
      )}
    </AppShell>
  );
}
