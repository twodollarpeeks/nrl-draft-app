import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { roundOf, teamForPick, type DraftPlayer, type DraftState, type MockDraftDetail } from "@nrl/shared";
import { BoardPanel } from "../components/draft/Panels.tsx";
import { AppShell } from "../components/Layout.tsx";
import { PositionBadge } from "../components/Position.tsx";
import { Card, ErrorText, SectionTitle, Spinner } from "../components/ui.tsx";
import { useMockDraft } from "../lib/mock.ts";
import { formatPoints } from "../lib/season.ts";
import { formatDate } from "./MockDraftsPage.tsx";

/** A finished mock: your squad, how every squad compares, and the full board. */
export function MockResultPage() {
  const { id = "" } = useParams();
  const mock = useMockDraft(id);
  if (!mock.data) {
    return (
      <AppShell title="Mock draft" back="/mock">
        {mock.error ? <ErrorText error={mock.error} /> : <Spinner />}
      </AppShell>
    );
  }
  return <Result mock={mock.data} />;
}

function Result({ mock }: { mock: MockDraftDetail }) {
  const ids = useMemo(() => mock.teamNames.map((_, i) => `t${i}`), [mock.teamNames]);
  const myId = ids[mock.slot - 1]!;
  const picks = mock.picks.map((p) => ({ ...p, teamId: teamForPick(ids, p.pickNo) }));

  // The board's panels expect draft-room shapes; build them from the saved picks.
  const state: DraftState = {
    leagueId: "mock",
    status: "complete",
    pickSeconds: mock.pickSeconds,
    order: mock.teamNames.map((name, i) => ({ id: ids[i]!, name, ownerName: "", ownerImage: null })),
    rounds: mock.picks.length / mock.teamCount,
    totalPicks: mock.picks.length,
    currentPick: mock.picks.length + 1,
    onClockTeamId: null,
    deadline: null,
    pausedRemainingMs: null,
    picks: picks.map((p) => ({ pickNo: p.pickNo, round: roundOf(mock.teamCount, p.pickNo), teamId: p.teamId, playerId: p.playerId, madeBy: "manager" })),
    autopilotTeamIds: [],
    version: 0,
    serverNow: mock.createdAt,
  };
  const players = new Map<number, DraftPlayer>(
    mock.picks.map((p) => [
      p.playerId,
      { id: p.playerId, name: p.name, positions: p.positions, club: p.club ? { key: "", nickName: p.club } : null, statsSeason: mock.season, games: 0, avgPoints: p.avgPoints, rank: 0 },
    ]),
  );

  // Squads compared on the sum of their players' averages.
  const totals = ids
    .map((teamId, i) => ({
      teamId,
      name: mock.teamNames[i]!,
      total: picks.filter((p) => p.teamId === teamId).reduce((sum, p) => sum + p.avgPoints, 0),
    }))
    .sort((a, b) => b.total - a.total);
  const myRank = totals.findIndex((t) => t.teamId === myId) + 1;
  const mine = picks.filter((p) => p.teamId === myId);

  return (
    <AppShell title="Mock draft results" back="/mock" width="wide">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {formatDate(mock.createdAt)} · {mock.teamCount} teams · pick {mock.slot}
        </h2>
        <Link to="/mock" className="text-sm font-medium text-accent">
          New mock →
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <Card>
          <SectionTitle>Your squad</SectionTitle>
          <ol className="flex flex-col divide-y divide-border">
            {mine.map((p) => (
              <li key={p.pickNo} className="flex items-center gap-3 py-2">
                <span className="w-10 shrink-0 font-mono text-xs text-muted">
                  {roundOf(mock.teamCount, p.pickNo)}.{((p.pickNo - 1) % mock.teamCount) + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    <PositionBadge positions={p.positions} />
                    {p.club ?? "—"}
                  </span>
                </span>
                <span className="font-mono text-sm">{formatPoints(p.avgPoints)}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted">Average points per game in {mock.season}.</p>
        </Card>

        <Card>
          <SectionTitle>How the squads compare</SectionTitle>
          <p className="mb-3 text-sm">
            Yours ranks <span className="font-semibold text-accent">{ordinal(myRank)}</span> of {mock.teamCount} on total
            average points.
          </p>
          <ol className="flex flex-col text-sm">
            {totals.map((t, i) => (
              <li key={t.teamId} className={`flex items-center gap-3 py-1.5 ${t.teamId === myId ? "text-accent" : ""}`}>
                <span className="w-5 text-right font-mono text-xs text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="font-mono">{formatPoints(Math.round(t.total * 10) / 10)}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <section>
        <SectionTitle>Draft board</SectionTitle>
        <BoardPanel state={state} players={players} myTeamId={myId} />
      </section>
    </AppShell>
  );
}

function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}
