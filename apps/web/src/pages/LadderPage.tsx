import { useParams } from "react-router";
import { AppShell } from "../components/Layout.tsx";
import { Card, ErrorText, SectionTitle, Spinner } from "../components/ui.tsx";
import { formatPoints, useSeason } from "../lib/season.ts";
import { MatchupCard } from "./MatchupsPage.tsx";

export function LadderPage() {
  const { id = "" } = useParams();
  const season = useSeason(id);
  if (!season.data) {
    return (
      <AppShell title="Ladder" back={`/l/${id}`}>
        {season.error ? <ErrorText error={season.error} /> : <Spinner />}
      </AppShell>
    );
  }
  const s = season.data;
  const h2h = s.mode === "headToHead";
  const finalsSpots = s.finals?.size ?? 0;
  const weeks = [...new Set(s.finals?.games.map((g) => g.round) ?? [])];

  return (
    <AppShell title="Ladder" back={`/l/${id}`} width="wide" league={{ id, myTeamId: s.myTeamId }}>
      <div className="flex flex-col gap-4 lg:gap-6">
        <Card className="overflow-x-auto p-0 lg:mx-auto lg:w-full lg:max-w-3xl">
          <table className="w-full text-xs sm:text-sm lg:text-base">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-2 py-2 font-medium">#</th>
                <th className="py-2 font-medium">Team</th>
                {h2h && <th className="px-2 py-2 text-right font-medium">P</th>}
                {h2h && <th className="px-2 py-2 text-right font-medium">W-D-L</th>}
                <th className="px-2 py-2 text-right font-medium">PF</th>
                {h2h && <th className="px-2 py-2 text-right font-medium">PA</th>}
              </tr>
            </thead>
            <tbody>
              {s.ladder.map((r) => (
                <tr
                  key={r.teamId}
                  className={`border-t border-border ${r.teamId === s.myTeamId ? "text-accent" : ""} ${r.rank === finalsSpots ? "border-b-2 border-b-accent/50" : ""}`}
                >
                  <td className="px-2 py-2 font-mono text-xs text-muted">{r.rank}</td>
                  <td className="py-2">
                    <div className="max-w-28 truncate font-medium sm:max-w-40 lg:max-w-none">{r.name}</div>
                    <div className="max-w-28 truncate text-xs text-muted sm:max-w-40 lg:max-w-none">{r.ownerName}</div>
                  </td>
                  {h2h && <td className="px-2 py-2 text-right font-mono">{r.played}</td>}
                  {h2h && (
                    <td className="px-2 py-2 text-right font-mono">
                      {r.wins}-{r.draws}-{r.losses}
                    </td>
                  )}
                  <td className="px-2 py-2 text-right font-mono">{formatPoints(r.pointsFor)}</td>
                  {h2h && <td className="px-2 py-2 text-right font-mono text-muted">{formatPoints(r.pointsAgainst)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-2 py-2 text-xs text-muted">
            Counts finished rounds only.
            {finalsSpots ? ` Top ${finalsSpots} make the finals.` : ""}
          </p>
        </Card>

        {s.finals && (
          <section>
            <SectionTitle>Finals{s.finals.champion ? "" : ` · top ${s.finals.size}`}</SectionTitle>
            {s.finals.champion && (
              <Card className="mb-3 border-accent text-center lg:mx-auto lg:max-w-md">
                <div className="text-xs uppercase tracking-wider text-muted">Champion</div>
                <div className="text-xl font-bold text-accent">
                  🏆 {s.ladder.find((r) => r.teamId === s.finals!.champion)?.name}
                </div>
              </Card>
            )}
            {s.finals.games.length === 0 ? (
              <Card className="text-sm text-muted">
                The finals are drawn from the ladder after round {s.lastRegularRound}.
              </Card>
            ) : (
              // Desktop: a bracket, one column per finals week.
              <div className="flex flex-col gap-4 lg:grid lg:auto-cols-fr lg:grid-flow-col lg:items-center">
                {weeks.map((round) => (
                  <div key={round} className="flex flex-col gap-2 lg:gap-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted">Round {round}</div>
                    {s.finals!.games
                      .filter((g) => g.round === round)
                      .map((g) => (
                        <MatchupCard key={g.stage} leagueId={id} matchup={g} myTeamId={s.myTeamId} />
                      ))}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
