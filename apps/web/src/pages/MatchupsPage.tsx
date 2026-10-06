import { Link, useNavigate, useParams } from "react-router";
import type { MatchupSide, MatchupView } from "@nrl/shared";
import { AppShell } from "../components/Layout.tsx";
import { LeagueNav, RoundPicker } from "../components/LeagueNav.tsx";
import { Card, ErrorText, SectionTitle, Spinner } from "../components/ui.tsx";
import { formatPoints, useRound, useSeason } from "../lib/season.ts";

export function MatchupsPage() {
  const { id = "", round: roundParam } = useParams();
  const navigate = useNavigate();
  const season = useSeason(id);
  const round = roundParam ? Number(roundParam) : season.data?.currentRound;
  const view = useRound(id, round);

  if (!season.data || !view.data) {
    return (
      <AppShell title="Matchups" back={`/l/${id}`}>
        {season.error || view.error ? <ErrorText error={season.error ?? view.error} /> : <Spinner />}
      </AppShell>
    );
  }
  const s = season.data;
  const v = view.data;
  const totalPoints = s.mode === "totalPoints";

  return (
    <AppShell title={totalPoints ? "Scores" : "Matchups"} back={`/l/${id}`}>
      <div className="flex flex-col gap-4 pb-20">
        <RoundPicker
          round={v.round}
          first={s.firstRound}
          last={s.grandFinalRound ?? s.lastRegularRound}
          title={v.title}
          status={v.status}
          onChange={(r) => navigate(`/l/${id}/matchups/${r}`)}
        />

        {totalPoints ? (
          <Card>
            <SectionTitle>This round</SectionTitle>
            <ol className="flex flex-col divide-y divide-border">
              {v.scores.map((side, i) => (
                <li key={side.teamId}>
                  <TeamLine leagueId={id} round={v.round} side={side} rank={i + 1} mine={side.teamId === s.myTeamId} />
                </li>
              ))}
            </ol>
          </Card>
        ) : v.matchups.length === 0 ? (
          <Card className="text-sm text-muted">
            {v.round > s.lastRegularRound ? "Finals matchups are set once the regular season ends." : "No matchups this round."}
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {v.matchups.map((m) => (
              <li key={`${m.stage}-${m.home?.teamId}-${m.away?.teamId}`}>
                <MatchupCard leagueId={id} matchup={m} myTeamId={s.myTeamId} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <LeagueNav leagueId={id} myTeamId={s.myTeamId} />
    </AppShell>
  );
}

export function MatchupCard({ leagueId, matchup, myTeamId }: { leagueId: string; matchup: MatchupView; myTeamId: string }) {
  const mine = matchup.home?.teamId === myTeamId || matchup.away?.teamId === myTeamId;
  const both = matchup.home && matchup.away;
  return (
    <Card className={`relative ${mine ? "border-accent/60" : ""}`}>
      {both && (
        <Link
          to={`/l/${leagueId}/matchup/${matchup.round}/${matchup.home!.teamId}/${matchup.away!.teamId}`}
          className="absolute inset-0 z-0 rounded-2xl"
          aria-label={`Open ${matchup.home!.name} v ${matchup.away!.name}`}
        />
      )}
      {matchup.stage !== "regular" && <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{matchup.label}</div>}
      <div className="flex flex-col divide-y divide-border">
        {[matchup.home, matchup.away].map((side, i) =>
          side ? (
            <TeamLine
              key={side.teamId}
              leagueId={leagueId}
              round={matchup.round}
              side={side}
              mine={side.teamId === myTeamId}
              asLink={!both}
              won={matchup.winnerTeamId === side.teamId}
              lost={matchup.winnerTeamId !== null && matchup.winnerTeamId !== side.teamId}
            />
          ) : (
            <div key={i} className="py-2 text-sm text-muted">
              To be decided
            </div>
          ),
        )}
      </div>
    </Card>
  );
}

function TeamLine({
  asLink = true,
  leagueId,
  round,
  side,
  mine,
  rank,
  won,
  lost,
}: {
  leagueId: string;
  round: number;
  side: MatchupSide;
  mine: boolean;
  asLink?: boolean;
  rank?: number;
  won?: boolean;
  lost?: boolean;
}) {
  const content = (
    <>
      {rank !== undefined && <span className="w-5 text-right font-mono text-xs text-muted">{rank}</span>}
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-medium ${mine ? "text-accent" : ""} ${lost ? "text-muted" : ""}`}>
          {side.name} {won && "✓"}
        </span>
        <span className="block truncate text-xs text-muted">{side.ownerName}</span>
      </span>
      <span className={`font-mono text-2xl font-bold tabular-nums ${lost ? "text-muted" : ""}`}>{formatPoints(side.score)}</span>
    </>
  );
  // Inside a matchup card the whole card is the link, so the row is just text.
  return asLink ? (
    <Link to={`/l/${leagueId}/team/${side.teamId}/${round}`} className="flex items-center gap-3 py-2">
      {content}
    </Link>
  ) : (
    <div className="pointer-events-none relative flex items-center gap-3 py-2">{content}</div>
  );
}
