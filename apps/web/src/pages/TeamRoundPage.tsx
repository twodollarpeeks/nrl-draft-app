import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  canSwap,
  lineupErrors,
  moveToBench,
  movedLockedPlayers,
  swapSpots,
  type LeagueDetail,
  type Lineup,
  type PlayerRoundView,
  type SeasonOverview,
  type Spot,
  type TeamRoundView,
} from "@nrl/shared";
import { AppShell } from "../components/Layout.tsx";
import { LeagueNav, RoundPicker } from "../components/LeagueNav.tsx";
import { Button, Card, ErrorText, SectionTitle, Spinner } from "../components/ui.tsx";
import { useLeague } from "../lib/queries.ts";
import { formatKickoff, formatPoints, useSaveLineup, useSeason, useTeamRound } from "../lib/season.ts";

export function TeamRoundPage() {
  const { id = "", teamId, round: roundParam } = useParams();
  const league = useLeague(id);
  const season = useSeason(id, league.data?.status === "inSeason" || league.data?.status === "complete");
  const round = roundParam ? Number(roundParam) : season.data?.currentRound;
  const team = useTeamRound(id, teamId, round);

  if (league.data && league.data.status !== "inSeason" && league.data.status !== "complete") {
    return (
      <AppShell title="Team" back={`/l/${id}`}>
        <Card className="text-sm text-muted">Lineups open once the draft is done.</Card>
      </AppShell>
    );
  }
  if (!league.data || !season.data || !team.data) {
    const error = league.error ?? season.error ?? team.error;
    return (
      <AppShell title="Team" back={`/l/${id}`}>
        {error ? <ErrorText error={error} /> : <Spinner />}
      </AppShell>
    );
  }
  return <TeamRound league={league.data} season={season.data} view={team.data} />;
}

function TeamRound({ league, season, view }: { league: LeagueDetail; season: SeasonOverview; view: TeamRoundView }) {
  const navigate = useNavigate();
  const template = league.settings.roster;
  const save = useSaveLineup(league.id, view.teamId, view.round);
  const [draft, setDraft] = useState<Lineup | null>(null);
  const [selected, setSelected] = useState<Spot | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  // A new round or a refreshed lineup from the server resets local edits.
  useEffect(() => {
    setDraft(null);
    setSelected(null);
    setHint(null);
  }, [view.teamId, view.round]);

  const lineup = draft ?? view.lineup;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(view.lineup);
  const players = useMemo(() => new Map(view.players.map((p) => [p.id, p])), [view.players]);
  const squad = view.players.map((p) => ({ id: p.id, positions: p.positions }));
  const roundInfo = season.rounds.find((r) => r.number === view.round);
  const isMine = view.teamId === season.myTeamId;

  function tap(spot: Spot, occupant: number | null) {
    setHint(null);
    if (!view.editable) return;
    if (occupant !== null && players.get(occupant)?.locked) {
      setHint(`${players.get(occupant)!.name} is locked: their game has started.`);
      return;
    }
    if (selected === null) {
      if (occupant !== null) setSelected(spot);
      return;
    }
    if (selected === spot) {
      setSelected(null);
      return;
    }
    if (!canSwap(template, squad, lineup, selected, spot)) {
      setHint("They can't play that position.");
      return;
    }
    const next = swapSpots(lineup, selected, spot);
    const locked = movedLockedPlayers(view.lineup, next, (pid) => !!players.get(pid)?.locked);
    if (locked.length) {
      setHint("That would move a player whose game has started.");
      return;
    }
    setDraft(next);
    setSelected(null);
  }

  function bench() {
    if (!selected) return;
    setDraft(moveToBench(lineup, selected));
    setSelected(null);
  }

  const errors = dirty ? lineupErrors(template, squad, lineup) : [];
  const selectedId = selected ? spotOccupant(lineup, selected) : null;

  return (
    <AppShell title={view.teamName} back={`/l/${league.id}`}>
      <div className="flex flex-col gap-4 pb-24">
        <RoundPicker
          round={view.round}
          first={season.firstRound}
          last={season.grandFinalRound ?? season.lastRegularRound}
          title={view.roundTitle}
          status={view.roundStatus}
          onChange={(r) => navigate(`/l/${league.id}/team/${view.teamId}/${r}`)}
        />

        <Card className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted">{isMine ? "Your score" : `${view.ownerName}'s score`}</div>
            <div className="text-xs text-muted">
              {view.score.provisional ? (view.roundStatus === "upcoming" ? "Not started" : "Live, may change") : "Final"}
              {view.editable && view.lineupSource === "carried" ? " · lineup carried over from last round" : ""}
              {view.editable && view.lineupSource === "auto" ? " · lineup picked for you: change it below" : ""}
            </div>
          </div>
          <div className="font-mono text-4xl font-bold tabular-nums">{formatPoints(view.score.total)}</div>
        </Card>

        {view.editable && (
          <p className="text-xs text-muted">
            Tap a player, then tap where they should go. Players lock when their game kicks off.
            {roundInfo?.firstKickoff ? ` First game: ${formatKickoff(roundInfo.firstKickoff)}.` : ""}
          </p>
        )}
        {hint && (
          <p role="status" className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
            {hint}
          </p>
        )}

        <section>
          <SectionTitle>Starting side</SectionTitle>
          <ul className="flex flex-col gap-2">
            {template.slots.flatMap((slot) =>
              Array.from({ length: slot.count }, (_, i) => {
                const spot = `${slot.key}:${i}`;
                const occupant = lineup.starters[slot.key]?.[i] ?? null;
                const scored = view.score.slots.find((s) => s.slotKey === slot.key && s.index === i);
                const sub = !dirty && scored?.viaEmergency ? players.get(scored.scorerId!) : undefined;
                return (
                  <li key={spot}>
                    <PlayerRow
                      label={slot.label}
                      player={occupant !== null ? players.get(occupant) : undefined}
                      selected={selected === spot}
                      target={selected !== null && selected !== spot && canSwap(template, squad, lineup, selected, spot)}
                      onTap={() => tap(spot, occupant)}
                      sub={sub ? `${sub.name} came in: ${formatPoints(scored!.points)}` : undefined}
                      showPoints={!sub}
                    />
                  </li>
                );
              }),
            )}
          </ul>
          {selected && !selected.startsWith("bench") && selectedId !== null && (
            <Button variant="secondary" className="mt-2" onClick={bench}>
              Move to bench
            </Button>
          )}
        </section>

        <section>
          <SectionTitle>Bench · emergencies in order</SectionTitle>
          <p className="mb-2 text-xs text-muted">
            If a starter doesn't play, the first emergency below who can play that position and does play comes in.
          </p>
          <ul className="flex flex-col gap-2">
            {lineup.bench.map((pid, i) => {
              const spot = `bench:${i}`;
              return (
                <li key={pid}>
                  <PlayerRow
                    label={`E${i + 1}`}
                    player={players.get(pid)}
                    selected={selected === spot}
                    target={selected !== null && selected !== spot && canSwap(template, squad, lineup, selected, spot)}
                    onTap={() => tap(spot, pid)}
                    dim
                  />
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {dirty && (
        <div className="fixed inset-x-0 bottom-16 z-30 mx-auto flex max-w-2xl flex-col gap-2 px-4">
          <ErrorText error={save.error ?? (errors.length ? errors.join(". ") : null)} />
          <div className="flex gap-2">
            <Button
              className="flex-1 shadow-lg"
              disabled={save.isPending || errors.length > 0}
              onClick={() => save.mutate(lineup, { onSuccess: () => setDraft(null) })}
            >
              {save.isPending ? "Saving…" : "Save lineup"}
            </Button>
            <Button variant="secondary" className="shadow-lg" onClick={() => setDraft(null)}>
              Undo
            </Button>
          </div>
        </div>
      )}
      <LeagueNav leagueId={league.id} myTeamId={season.myTeamId} />
    </AppShell>
  );
}

function spotOccupant(lineup: Lineup, spot: Spot): number | null {
  const [key, idx] = spot.split(":") as [string, string];
  return key === "bench" ? (lineup.bench[Number(idx)] ?? null) : (lineup.starters[key]?.[Number(idx)] ?? null);
}

const NOTE_LABEL: Record<NonNullable<PlayerRoundView["note"]>, string> = {
  bye: "Bye",
  notNamed: "Not named",
  reserve: "Reserve",
  didNotPlay: "Didn't play",
  noFixture: "No draw yet",
};

function PlayerRow({
  label,
  player,
  selected,
  target,
  onTap,
  sub,
  showPoints = true,
  dim = false,
}: {
  label: string;
  player: PlayerRoundView | undefined;
  selected: boolean;
  target: boolean;
  onTap: () => void;
  sub?: string;
  showPoints?: boolean;
  dim?: boolean;
}) {
  const border = selected ? "border-accent bg-accent/10" : target ? "border-accent/50 border-dashed" : "border-border";
  return (
    <button
      type="button"
      onClick={onTap}
      aria-pressed={selected}
      className={`flex w-full items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 text-left ${border}`}
    >
      <span className="w-12 shrink-0 text-xs font-semibold text-muted">{label}</span>
      {player ? (
        <span className="min-w-0 flex-1">
          <span className={`flex items-center gap-2 ${dim ? "" : "font-medium"}`}>
            <span className="truncate">{player.name}</span>
            {player.locked && <span aria-label="Locked">🔒</span>}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span>
              {player.club?.nickName ?? "—"} · {player.positions.join("/") || "No position"}
            </span>
            {player.match && <MatchLine match={player.match} />}
            {player.note && (
              <span className={`rounded px-1.5 py-0.5 font-semibold ${player.note === "reserve" ? "bg-surface-2" : "bg-danger/15 text-danger"}`}>
                {NOTE_LABEL[player.note]}
              </span>
            )}
          </span>
          {sub && <span className="block text-xs text-accent">↳ {sub}</span>}
        </span>
      ) : (
        <span className="flex-1 text-sm text-muted">Empty: tap a bench player to fill</span>
      )}
      {player && showPoints && (
        <span className={`w-12 shrink-0 text-right font-mono tabular-nums ${player.points === null ? "text-muted" : ""}`}>
          {formatPoints(player.points)}
        </span>
      )}
    </button>
  );
}

function MatchLine({ match }: { match: NonNullable<PlayerRoundView["match"]> }) {
  const when =
    match.state === "FullTime"
      ? "FT"
      : new Date(match.kickoffAt).getTime() <= Date.now()
        ? "Live"
        : formatKickoff(match.kickoffAt);
  return (
    <span>
      {match.home ? "v" : "@"} {match.opponent} · <span className={when === "Live" ? "text-accent" : ""}>{when}</span>
    </span>
  );
}
