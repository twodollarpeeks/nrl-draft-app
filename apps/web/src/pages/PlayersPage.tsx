import { useMemo, useState } from "react";
import { useParams } from "react-router";
import {
  POSITION_GROUPS,
  POSITION_GROUP_SHORT,
  positionGroups,
  type LeaguePlayer,
  type PlayersView,
  type PositionGroup,
} from "@nrl/shared";
import { AppShell } from "../components/Layout.tsx";
import { PositionBadge } from "../components/Position.tsx";
import { Button, Card, Dialog, ErrorText, SectionTitle, Spinner, inputClass } from "../components/ui.tsx";
import {
  formatWhen,
  timeAgo,
  useActivity,
  useAddPlayer,
  useCancelClaim,
  useClaim,
  useDropPlayer,
  useOrderClaims,
  usePlayers,
} from "../lib/roster.ts";
import { formatPoints } from "../lib/season.ts";

type View = "available" | "waivers" | "all" | "mine";
const VIEWS: Array<[View, string]> = [
  ["available", "Free agents"],
  ["waivers", "On waivers"],
  ["all", "All players"],
  ["mine", "My squad"],
];
const PAGE = 50;

/** Free agents, waivers and your claims. */
export function PlayersPage() {
  const { id = "" } = useParams();
  const view = usePlayers(id);
  if (!view.data) {
    return (
      <AppShell title="Players" back={`/l/${id}`} width="wide">
        {view.error ? <ErrorText error={view.error} /> : <Spinner />}
      </AppShell>
    );
  }
  return <Players data={view.data} />;
}

type Action = { kind: "add" | "claim"; player: LeaguePlayer } | { kind: "drop"; player: LeaguePlayer };

function Players({ data }: { data: PlayersView }) {
  const leagueId = data.leagueId;
  const [show, setShow] = useState<View>("available");
  const [group, setGroup] = useState<PositionGroup | "ALL">("ALL");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"season" | "prev">("season");
  const [limit, setLimit] = useState(PAGE);
  const [action, setAction] = useState<Action | null>(null);

  const teamName = new Map(data.teams.map((t) => [t.id, t.name]));
  const mine = data.players.filter((p) => p.ownerTeamId === data.myTeamId);
  const claimed = new Set(data.claims.map((c) => c.player.id));
  const myPosition = data.waivers.order.indexOf(data.myTeamId) + 1;

  const list = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    // Averages count for more over more games (as in the draft rankings), so a one-game wonder doesn't top the list.
    const score = (avg: number | null, games: number) => (avg === null ? -1 : (avg * games) / (games + 3));
    const avg = (p: LeaguePlayer) => (sort === "season" ? score(p.seasonAvg, p.seasonGames) : score(p.prevAvg, p.prevGames));
    return data.players
      .filter((p) =>
        show === "available" ? p.availability === "free"
        : show === "waivers" ? p.availability === "waivers"
        : show === "mine" ? p.ownerTeamId === data.myTeamId
        : true,
      )
      .filter((p) => group === "ALL" || positionGroups(p.positions).includes(group))
      .filter((p) => words.every((w) => p.name.toLowerCase().includes(w) || p.club?.nickName.toLowerCase().includes(w)))
      .sort((a, b) => avg(b) - avg(a) || a.name.localeCompare(b.name));
  }, [data, show, group, q, sort]);

  const chip = (on: boolean) =>
    `min-h-9 shrink-0 rounded-full px-3 text-sm font-medium ${on ? "bg-accent text-bg" : "bg-surface-2 text-muted hover:text-text"}`;

  return (
    <AppShell title="Players" back={`/l/${leagueId}`} width="wide" league={{ id: leagueId, myTeamId: data.myTeamId }}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-3">
          <Card className="text-sm">
            <span className="text-muted">Waivers clear </span>
            <span className="font-medium">{formatWhen(data.waivers.nextClear)}</span>
            <span className="text-muted">
              . You're {ordinal(myPosition)} in line. Free agents can be added straight away, until their game kicks off.
            </span>
          </Card>
          {/* Phones: pending claims up top, not below the whole list. */}
          {data.claims.length > 0 && (
            <div className="lg:hidden">
              <Claims data={data} />
            </div>
          )}

          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0" role="group" aria-label="Show">
            {VIEWS.map(([v, label]) => (
              <button key={v} aria-pressed={show === v} className={chip(show === v)} onClick={() => { setShow(v); setLimit(PAGE); }}>
                {label}
                {v === "mine" ? ` (${mine.length}/${data.squadMax})` : ""}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-2" role="group" aria-label="Filter by position">
              {(["ALL", ...POSITION_GROUPS] as const).map((g) => (
                <button key={g} aria-pressed={group === g} className={chip(group === g)} onClick={() => setGroup(g)}>
                  {g === "ALL" ? "All" : POSITION_GROUP_SHORT[g]}
                </button>
              ))}
            </div>
            {data.prevSeason && (
              <select className={`${inputClass} min-h-9 lg:ml-auto`} value={sort} onChange={(e) => setSort(e.target.value as "season" | "prev")} aria-label="Sort by">
                <option value="season">Best {data.season} average</option>
                <option value="prev">Best {data.prevSeason} average</option>
              </select>
            )}
          </div>
          <input
            type="search"
            className={inputClass}
            placeholder="Search players or clubs"
            aria-label="Search players"
            value={q}
            onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }}
          />

          <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-surface">
            {list.slice(0, limit).map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span>{p.club?.nickName ?? "—"}</span>
                    <PositionBadge positions={p.positions} />
                    <span>
                      {p.seasonAvg !== null ? `${formatPoints(p.seasonAvg)} avg · ${p.seasonGames} gm` : `No ${data.season} games`}
                      {data.prevSeason && p.prevAvg !== null ? ` · ${data.prevSeason}: ${formatPoints(p.prevAvg)}` : ""}
                    </span>
                    <Status player={p} mine={p.ownerTeamId === data.myTeamId} owner={teamName.get(p.ownerTeamId ?? "")} />
                  </div>
                </div>
                <PlayerAction
                  player={p}
                  mine={p.ownerTeamId === data.myTeamId}
                  claimed={claimed.has(p.id)}
                  onAction={(kind) => setAction({ kind, player: p })}
                />
              </li>
            ))}
            {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No players match.</li>}
          </ul>
          {list.length > limit && (
            <button className="min-h-11 rounded-xl bg-surface-2 text-sm font-medium" onClick={() => setLimit((l) => l + PAGE)}>
              Show more ({list.length - limit} left)
            </button>
          )}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
          <div className={data.claims.length > 0 ? "hidden lg:block" : ""}>
            <Claims data={data} />
          </div>
          <WaiverOrder data={data} />
          <Activity leagueId={leagueId} />
        </aside>
      </div>

      {action && <ActionDialog data={data} action={action} mine={mine} onClose={() => setAction(null)} />}
    </AppShell>
  );
}

function Status({ player, mine, owner }: { player: LeaguePlayer; mine: boolean; owner: string | undefined }) {
  if (player.availability === "owned") return <span className={mine ? "text-accent" : ""}>{mine ? "Your squad" : owner}</span>;
  if (player.availability === "waivers") return <span className="rounded bg-review/15 px-1.5 py-0.5 font-semibold text-review">Waivers</span>;
  return <span className="rounded bg-accent/15 px-1.5 py-0.5 font-semibold text-accent">Free agent</span>;
}

function PlayerAction({
  player,
  mine,
  claimed,
  onAction,
}: {
  player: LeaguePlayer;
  mine: boolean;
  claimed: boolean;
  onAction: (kind: "add" | "claim" | "drop") => void;
}) {
  const btn = "min-h-10 shrink-0 rounded-xl px-3 text-sm font-semibold";
  if (player.locked && (mine || player.availability === "free")) {
    return <span className="shrink-0 text-xs text-muted" title="Their game this round has started">🔒 Playing</span>;
  }
  if (mine) {
    return (
      <button className={`${btn} bg-surface-2 text-muted hover:text-danger`} onClick={() => onAction("drop")}>
        Drop
      </button>
    );
  }
  if (player.availability === "free") {
    return (
      <button className={`${btn} bg-accent text-bg`} onClick={() => onAction("add")}>
        Add
      </button>
    );
  }
  if (player.availability === "waivers") {
    return claimed ? (
      <span className="shrink-0 text-xs font-medium text-review">Claimed</span>
    ) : (
      <button className={`${btn} bg-review text-bg`} onClick={() => onAction("claim")}>
        Claim
      </button>
    );
  }
  return null;
}

/** Confirm an add, claim or drop; choose who to drop when needed. */
function ActionDialog({ data, action, mine, onClose }: { data: PlayersView; action: Action; mine: LeaguePlayer[]; onClose: () => void }) {
  const add = useAddPlayer(data.leagueId);
  const claim = useClaim(data.leagueId);
  const drop = useDropPlayer(data.leagueId);
  const [dropId, setDropId] = useState<number | null>(null);
  const full = mine.length >= data.squadMax;
  const p = action.player;
  const busy = add.isPending || claim.isPending || drop.isPending;
  const error = add.error ?? claim.error ?? drop.error;
  const done = { onSuccess: onClose };

  if (action.kind === "drop") {
    return (
      <Dialog title={`Drop ${p.name}?`} onClose={onClose}>
        <p className="text-sm text-muted">They go on waivers until the next clearing, then become a free agent.</p>
        <ErrorText error={error} />
        <Button disabled={busy} className="bg-danger text-text" onClick={() => drop.mutate({ teamId: data.myTeamId, playerId: p.id }, done)}>
          {busy ? "Dropping…" : `Drop ${p.name}`}
        </Button>
      </Dialog>
    );
  }

  const isClaim = action.kind === "claim";
  const droppable = mine.filter((m) => !m.locked);
  return (
    <Dialog title={isClaim ? `Claim ${p.name}` : `Add ${p.name}`} onClose={onClose}>
      <p className="text-sm text-muted">
        {isClaim
          ? `Claims are settled when waivers clear, ${formatWhen(data.waivers.nextClear)}, in waiver order.`
          : "They join your squad straight away."}
        {full ? " Your squad is full, so choose who to drop." : isClaim ? " You can choose someone to drop if you get them." : ""}
      </p>
      {(full || isClaim) && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Drop</legend>
          {!full && (
            <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
              <input type="radio" name="drop" checked={dropId === null} onChange={() => setDropId(null)} className="accent-(--color-accent)" />
              Nobody
            </label>
          )}
          {droppable.map((m) => (
            <label key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
              <input type="radio" name="drop" checked={dropId === m.id} onChange={() => setDropId(m.id)} className="accent-(--color-accent)" />
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              <PositionBadge positions={m.positions} />
              <span className="w-10 text-right font-mono text-xs text-muted">{formatPoints(m.seasonAvg ?? m.prevAvg)}</span>
            </label>
          ))}
        </fieldset>
      )}
      <ErrorText error={error} />
      <Button
        disabled={busy || (full && dropId === null)}
        onClick={() => {
          const body = { teamId: data.myTeamId, playerId: p.id, dropPlayerId: dropId };
          if (isClaim) claim.mutate(body, done);
          else add.mutate(body, done);
        }}
      >
        {busy ? "Saving…" : isClaim ? "Put in claim" : `Add ${p.name}`}
      </Button>
    </Dialog>
  );
}

function Claims({ data }: { data: PlayersView }) {
  const cancel = useCancelClaim(data.leagueId);
  const order = useOrderClaims(data.leagueId);
  const ids = data.claims.map((c) => c.id);
  const move = (i: number, by: number) => {
    const next = [...ids];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x!);
    order.mutate({ teamId: data.myTeamId, claimIds: next });
  };
  return (
    <Card>
      <SectionTitle>Your claims</SectionTitle>
      {data.claims.length === 0 ? (
        <p className="text-sm text-muted">Claim players on waivers. If you get more than one claim in, they're tried in this order.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {data.claims.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 py-2">
              <span className="w-5 font-mono text-xs text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1 text-sm">
                <div className="truncate font-medium">{c.player.name}</div>
                <div className="truncate text-xs text-muted">{c.drop ? `Drop ${c.drop.name}` : "No drop"}</div>
              </div>
              <button className="size-8 rounded-lg text-muted hover:text-text disabled:opacity-30" disabled={i === 0 || order.isPending} onClick={() => move(i, -1)} aria-label={`Move ${c.player.name} up`}>↑</button>
              <button className="size-8 rounded-lg text-muted hover:text-text disabled:opacity-30" disabled={i === ids.length - 1 || order.isPending} onClick={() => move(i, 1)} aria-label={`Move ${c.player.name} down`}>↓</button>
              <button className="size-8 rounded-lg text-muted hover:text-danger" disabled={cancel.isPending} onClick={() => cancel.mutate(c.id)} aria-label={`Cancel claim for ${c.player.name}`}>✕</button>
            </li>
          ))}
        </ol>
      )}
      <ErrorText error={cancel.error ?? order.error} />
    </Card>
  );
}

function WaiverOrder({ data }: { data: PlayersView }) {
  const name = new Map(data.teams.map((t) => [t.id, t.name]));
  return (
    <Card>
      <SectionTitle>Waiver order</SectionTitle>
      <ol className="flex flex-col text-sm">
        {data.waivers.order.map((id, i) => (
          <li key={id} className={`flex gap-3 py-1 ${id === data.myTeamId ? "text-accent" : ""}`}>
            <span className="w-5 text-right font-mono text-xs text-muted">{i + 1}</span>
            <span className="truncate">{name.get(id)}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted">Winning a claim sends you to the back of the line.</p>
    </Card>
  );
}

export function Activity({ leagueId, limit = 10 }: { leagueId: string; limit?: number }) {
  const activity = useActivity(leagueId);
  return (
    <Card>
      <SectionTitle>Recent moves</SectionTitle>
      {activity.isPending && <Spinner />}
      <ErrorText error={activity.error} />
      {activity.data?.length === 0 && <p className="text-sm text-muted">No pickups, drops or trades yet.</p>}
      <ul className="flex flex-col gap-2 text-sm">
        {activity.data?.slice(0, limit).map((a) => (
          <li key={a.id}>
            <div>{a.text}</div>
            <div className="text-xs text-muted">{timeAgo(a.at)}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}
