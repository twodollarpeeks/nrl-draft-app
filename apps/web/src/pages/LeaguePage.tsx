import { useState } from "react";
import { Link, useParams } from "react-router";
import { seasonRounds, squadSize, type LeagueDetail } from "@nrl/shared";
import { DraftOrderList, formatDraftTime } from "../components/DraftSetup.tsx";
import { formatPoints, useRound, useSeason } from "../lib/season.ts";
import { MatchupCard } from "./MatchupsPage.tsx";
import { scoringSummary } from "../components/ScoringEditor.tsx";
import { AppShell } from "../components/Layout.tsx";
import { Avatar, Button, Card, ErrorText, SectionTitle, Spinner, inputClass } from "../components/ui.tsx";
import { useLeague, useRenameTeam } from "../lib/queries.ts";

export function LeaguePage() {
  const { id = "" } = useParams();
  const { data: league, isPending, error } = useLeague(id);

  if (isPending) return <AppShell back="/leagues"><Spinner /></AppShell>;
  if (!league) return <AppShell back="/leagues"><ErrorText error={error} /></AppShell>;

  const open = league.teamCount - league.teamsJoined;
  const inSeason = league.status === "inSeason" || league.status === "complete";
  return (
    <AppShell title={league.name} back="/leagues" width="wide" league={inSeason ? { id: league.id, myTeamId: league.myTeamId } : undefined}>
      {/* Desktop: what to do now on the left; who's in it and the rules on the right. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-4">
          {inSeason && <ThisRoundCard league={league} />}
          <DraftCard league={league} />
          {league.status === "setup" && <InviteCard league={league} spotsLeft={open} />}
          {league.status === "setup" && (
            <Card>
              <SectionTitle>Draft order</SectionTitle>
              <DraftOrderList league={league} />
            </Card>
          )}
          <SettingsSummary league={league} className="hidden lg:block" />
        </div>

        <div className="flex flex-col gap-4">
          {inSeason && <LadderSnapshot league={league} />}
          <Card>
            <SectionTitle>
              Teams · {league.teamsJoined}/{league.teamCount}
            </SectionTitle>
            <ul className="flex flex-col divide-y divide-border">
              {league.teams.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-3">
                  <Avatar name={t.owner.name} image={t.owner.image} size={36} />
                  <div className="min-w-0 flex-1">
                    {t.id === league.myTeamId ? <MyTeamName league={league} /> : <div className="truncate font-medium">{t.name}</div>}
                    <div className="truncate text-sm text-muted">
                      {t.owner.name}
                      {t.isCommissioner ? " · Commissioner" : ""}
                    </div>
                  </div>
                </li>
              ))}
              {Array.from({ length: open }, (_, i) => (
                <li key={`open-${i}`} className="flex items-center gap-3 py-3 text-muted">
                  <span className="size-9 rounded-full border border-dashed border-border" aria-hidden />
                  Open spot
                </li>
              ))}
            </ul>
          </Card>
          <SettingsSummary league={league} className="lg:hidden" />
        </div>
      </div>
    </AppShell>
  );
}

/** Desktop sidebar: the top of the ladder, linking to the full one. */
function LadderSnapshot({ league }: { league: LeagueDetail }) {
  const season = useSeason(league.id);
  if (!season.data) return null;
  const s = season.data;
  const h2h = s.mode === "headToHead";
  return (
    <Card className="hidden lg:block">
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle>Ladder</SectionTitle>
        <Link to={`/l/${league.id}/ladder`} className="text-sm font-medium text-accent">
          Full ladder →
        </Link>
      </div>
      <ol className="flex flex-col text-sm">
        {s.ladder.slice(0, 8).map((r) => (
          <li key={r.teamId} className={`flex items-center gap-3 py-1.5 ${r.teamId === s.myTeamId ? "text-accent" : ""}`}>
            <span className="w-5 text-right font-mono text-xs text-muted">{r.rank}</span>
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            {h2h && <span className="font-mono text-xs text-muted">{r.wins}-{r.draws}-{r.losses}</span>}
            <span className="w-14 text-right font-mono">{formatPoints(r.pointsFor)}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** In season: this round's matchup (or score) for the viewer's team. */
function ThisRoundCard({ league }: { league: LeagueDetail }) {
  const season = useSeason(league.id);
  const round = useRound(league.id, season.data?.currentRound);
  if (!season.data || !round.data) {
    return <Card>{season.error || round.error ? <ErrorText error={season.error ?? round.error} /> : <Spinner />}</Card>;
  }
  const s = season.data;
  const r = round.data;
  const mine = r.matchups.find((m) => m.home?.teamId === s.myTeamId || m.away?.teamId === s.myTeamId);
  const myRank = s.ladder.find((row) => row.teamId === s.myTeamId)?.rank;
  return (
    <>
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">
          {r.title} {r.status === "live" && <span className="text-sm text-accent">● Live</span>}
        </h2>
        {myRank && <span className="text-sm text-muted">You're {ordinal(myRank)} on the ladder</span>}
      </div>
      {mine ? (
        <MatchupCard leagueId={league.id} matchup={mine} myTeamId={s.myTeamId} />
      ) : (
        <Card className="text-sm text-muted">
          {s.mode === "totalPoints"
            ? `You've scored ${formatPoints(r.scores.find((x) => x.teamId === s.myTeamId)?.score)} this round.`
            : r.round > s.lastRegularRound
              ? "You're not in a final this round."
              : "You have the bye this round."}
        </Card>
      )}
      <Link
        to={`/l/${league.id}/team/${s.myTeamId}/${r.round}`}
        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-4 text-sm font-semibold text-bg"
      >
        {r.status === "complete" ? "See your team" : "Set your lineup"}
      </Link>
    </>
  );
}

function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

function DraftCard({ league }: { league: LeagueDetail }) {
  const when = league.draftAt && league.status === "setup" ? `Draft ${formatDraftTime(league.draftAt)}` : null;
  const [title, hint] = {
    setup: [
      "Draft room",
      league.isCommissioner
        ? "Queue players, then start the draft when everyone's in."
        : "Queue players before the draft starts.",
    ],
    drafting: ["The draft is live", "Jump in: the clock is running."],
    inSeason: ["Draft results", "See who went where."],
    complete: ["Draft results", "See who went where."],
  }[league.status];
  return (
    <Link
      to={`/l/${league.id}/draft`}
      className={`flex items-center justify-between rounded-2xl border p-4 ${
        league.status === "drafting" ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-accent"
      }`}
    >
      <div>
        <div className="font-semibold">{title}</div>
        {when && <div className="text-sm font-medium text-accent">{when}</div>}
        <div className="text-sm text-muted">{hint}</div>
      </div>
      <span aria-hidden className="text-accent">
        →
      </span>
    </Link>
  );
}

function InviteCard({ league, spotsLeft }: { league: LeagueDetail; spotsLeft: number }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/join/${league.inviteCode}`;

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: league.name, text: `Join my NRL Draft league "${league.name}"`, url: link });
        return;
      } catch {
        // cancelled: fall back to copying
      }
    }
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <SectionTitle>Invite your mates</SectionTitle>
      {spotsLeft > 0 ? (
        <>
          <p className="mb-3 text-sm text-muted">
            {spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left. Anyone with this link can join.
          </p>
          <div className="flex gap-2">
            <code className="flex min-h-11 min-w-0 flex-1 items-center truncate rounded-xl bg-surface-2 px-3 text-sm">{link}</code>
            <Button onClick={share}>{copied ? "Copied!" : "Share"}</Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">The league is full. Time to draft.</p>
      )}
    </Card>
  );
}

function MyTeamName({ league }: { league: LeagueDetail }) {
  const mine = league.teams.find((t) => t.id === league.myTeamId)!;
  const rename = useRenameTeam();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(mine.name);

  if (!editing) {
    return (
      <button className="truncate text-left font-medium hover:text-accent" onClick={() => setEditing(true)}>
        {mine.name} <span className="text-xs text-muted">(you · rename)</span>
      </button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        await rename.mutateAsync({ teamId: mine.id, name: name.trim() });
        setEditing(false);
      }}
    >
      <div className="flex gap-2">
        <input className={`${inputClass} min-w-0 flex-1`} value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoFocus aria-label="Team name" />
        <Button type="submit" disabled={rename.isPending}>Save</Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
      <ErrorText error={rename.error} />
    </form>
  );
}

function SettingsSummary({ league, className }: { league: LeagueDetail; className?: string }) {
  const s = league.settings;
  const format =
    s.matchups.mode === "totalPoints"
      ? "Total points"
      : s.matchups.finalsTeams > 0
        ? `Head-to-head, top ${s.matchups.finalsTeams} finals`
        : "Head-to-head, no finals";
  return (
    <Card className={className}>
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle>Rules</SectionTitle>
        {league.isCommissioner && league.status === "setup" && (
          <Link to={`/l/${league.id}/settings`} className="text-sm font-medium text-accent">
            Edit
          </Link>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">NRL season</dt>
        <dd>{league.season}</dd>
        <dt className="text-muted">Format</dt>
        <dd>{format}</dd>
        <dt className="text-muted">Fantasy rounds</dt>
        <dd>{seasonText(s)}</dd>
        <dt className="text-muted">Draft</dt>
        <dd>Snake, {formatSeconds(s.draft.pickSeconds)} per pick</dd>
        <dt className="text-muted">Squad</dt>
        <dd>
          {s.roster.slots.map((x) => `${x.count} ${x.label}`).join(", ")}, {s.roster.benchSize} bench ({squadSize(s.roster)})
        </dd>
        <dt className="text-muted">Scoring</dt>
        <dd>{scoringSummary(s.scoring) || "Nothing scores"}</dd>
      </dl>
    </Card>
  );
}


function seasonText(s: LeagueDetail["settings"]) {
  const r = seasonRounds(s.seasonEndRound, s.matchups);
  return r.grandFinalRound
    ? `Rounds 1–${r.lastRegularRound}, finals rounds ${r.finalsStartRound}–${r.grandFinalRound} (grand final round ${r.grandFinalRound})`
    : `Rounds 1–${r.lastRegularRound}`;
}

function formatSeconds(s: number) {
  if (s < 120) return `${s}s`;
  if (s < 3600) return `${s / 60} min`;
  return `${s / 3600} h`;
}
