import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { MAX_TRADE_PLAYERS, type TradePlayer, type TradeView, type TradesView } from "@nrl/shared";
import { AppShell } from "../components/Layout.tsx";
import { PositionBadge } from "../components/Position.tsx";
import { Button, Card, ErrorText, Field, SectionTitle, Spinner, inputClass } from "../components/ui.tsx";
import { formatWhen, timeAgo } from "../lib/roster.ts";
import { useProposeTrade, useTradeAction, useTradeVote, useTrades, type TradeAction } from "../lib/trades.ts";

const STATUS: Record<TradeView["status"], string> = {
  proposed: "Waiting for an answer",
  rejected: "Rejected",
  cancelled: "Withdrawn",
  review: "In review",
  completed: "Done",
  vetoed: "Vetoed",
  failed: "Didn't go through",
};

export function TradesPage() {
  const { id = "" } = useParams();
  const trades = useTrades(id);
  if (!trades.data) {
    return (
      <AppShell title="Trades" back={`/l/${id}`} width="wide">
        {trades.error ? <ErrorText error={trades.error} /> : <Spinner />}
      </AppShell>
    );
  }
  const data = trades.data;
  const t = data.trades;
  const forMe = t.filter((x) => x.status === "proposed" && x.receiver.teamId === data.myTeamId);
  const mine = t.filter((x) => x.status === "proposed" && x.proposer.teamId === data.myTeamId);
  const review = t.filter((x) => x.status === "review");
  const others = t.filter((x) => x.status === "proposed" && x.proposer.teamId !== data.myTeamId && x.receiver.teamId !== data.myTeamId);
  const done = t.filter((x) => !["proposed", "review"].includes(x.status));

  return (
    <AppShell title="Trades" back={`/l/${id}`} width="wide" league={{ id, myTeamId: data.myTeamId }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Accepted trades are reviewed for {data.reviewHours} hours: other managers can vote, and the commissioner approves or
          vetoes. Without a veto they go through when the review ends.
          {data.deadline &&
            (data.deadline.closed ? " Trades are closed for the season." : ` Trades close when round ${data.deadline.round} starts.`)}
        </p>
        {!data.deadline?.closed && (
          <Link to={`/l/${id}/trades/new`} className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-bg">
            Propose a trade
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-6">
          <Section title="Offers for you" trades={forMe} data={data} empty="No offers waiting for you." />
          <Section title="Under review" trades={review} data={data} empty="Nothing in review." />
          <Section title="Your offers" trades={mine} data={data} empty="You haven't any offers out." />
        </div>
        <div className="flex flex-col gap-6">
          {others.length > 0 && <Section title="Other offers around the league" trades={others} data={data} />}
          <Section title="History" trades={done.slice(0, 20)} data={data} empty="No trades yet." />
        </div>
      </div>
    </AppShell>
  );
}

function Section({ title, trades, data, empty }: { title: string; trades: TradeView[]; data: TradesView; empty?: string }) {
  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>{title}</SectionTitle>
      {trades.length === 0 && empty && <p className="text-sm text-muted">{empty}</p>}
      {trades.map((t) => (
        <TradeCard key={t.id} trade={t} data={data} />
      ))}
    </section>
  );
}

function TradeCard({ trade, data }: { trade: TradeView; data: TradesView }) {
  const action = useTradeAction(data.leagueId);
  const vote = useTradeVote(data.leagueId);
  const busy = action.isPending || vote.isPending;
  const run = (a: TradeAction, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    const note = a === "veto" ? (prompt("Reason for the veto (optional)") ?? undefined) : undefined;
    action.mutate({ tradeId: trade.id, action: a, ...(note ? { note } : {}) });
  };
  const tone =
    trade.status === "completed" ? "text-accent" : trade.status === "review" ? "text-review" : ["proposed"].includes(trade.status) ? "text-text" : "text-muted";

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={`font-semibold uppercase tracking-wider ${tone}`}>{STATUS[trade.status]}</span>
        <span className="text-muted">{timeAgo(trade.createdAt)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Side title={`${trade.proposer.name} give`} players={trade.give} />
        <Side title={`${trade.receiver.name} give`} players={trade.get} />
      </div>
      {trade.message && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm">“{trade.message}”</p>}
      {trade.status === "review" && trade.reviewEndsAt && (
        <p className="text-xs text-muted">Goes through {formatWhen(trade.reviewEndsAt)} unless the commissioner vetoes it.</p>
      )}
      {trade.note && <p className="text-xs text-muted">{trade.note}</p>}
      {(trade.votes.approve.length > 0 || trade.votes.veto.length > 0) && (
        <p className="text-xs">
          <span className="text-accent">👍 {trade.votes.approve.length}</span>
          {trade.votes.approve.length > 0 && <span className="text-muted"> ({trade.votes.approve.join(", ")})</span>}
          <span className="ml-3 text-danger">👎 {trade.votes.veto.length}</span>
          {trade.votes.veto.length > 0 && <span className="text-muted"> ({trade.votes.veto.join(", ")})</span>}
        </p>
      )}
      <ErrorText error={action.error ?? vote.error} />
      <div className="flex flex-wrap gap-2">
        {trade.can.accept && <Button disabled={busy} onClick={() => run("accept", "Accept this trade? It goes to review for a day.")}>Accept</Button>}
        {trade.can.reject && <Button variant="secondary" disabled={busy} onClick={() => run("reject")}>Reject</Button>}
        {trade.can.cancel && <Button variant="secondary" disabled={busy} onClick={() => run("cancel", "Withdraw this offer?")}>Withdraw</Button>}
        {trade.can.vote && (
          <>
            <Button variant={trade.myVote === true ? "primary" : "secondary"} disabled={busy} onClick={() => vote.mutate({ tradeId: trade.id, approve: true })}>
              👍 Fair
            </Button>
            <Button variant={trade.myVote === false ? "primary" : "secondary"} disabled={busy} onClick={() => vote.mutate({ tradeId: trade.id, approve: false })}>
              👎 Veto it
            </Button>
          </>
        )}
        {trade.can.approve && (
          <Button disabled={busy} onClick={() => run("approve", "Approve this trade now?")}>
            Approve now
          </Button>
        )}
        {trade.can.veto && (
          <Button variant="secondary" className="text-danger" disabled={busy} onClick={() => run("veto", "Veto this trade? This can't be undone.")}>
            Veto
          </Button>
        )}
      </div>
    </Card>
  );
}

function Side({ title, players }: { title: string; players: TradePlayer[] }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 truncate text-xs text-muted">{title}</div>
      <ul className="flex flex-col gap-1">
        {players.map((p) => (
          <li key={p.id} className="flex min-w-0 items-center gap-2 text-sm">
            <span className="truncate font-medium">{p.name}</span>
            <PositionBadge positions={p.positions} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Build an offer: pick a team, then players from both squads. */
export function ProposeTradePage() {
  const { id = "" } = useParams();
  const trades = useTrades(id);
  if (!trades.data) {
    return (
      <AppShell title="Propose a trade" back={`/l/${id}/trades`}>
        {trades.error ? <ErrorText error={trades.error} /> : <Spinner />}
      </AppShell>
    );
  }
  return <Builder data={trades.data} />;
}

function Builder({ data }: { data: TradesView }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const others = data.teams.filter((t) => t.id !== data.myTeamId);
  const [withTeam, setWithTeam] = useState(params.get("with") && others.some((t) => t.id === params.get("with")) ? params.get("with")! : others[0]?.id ?? "");
  const [give, setGive] = useState<number[]>([]);
  const [get, setGet] = useState<number[]>([]);
  const [message, setMessage] = useState("");
  const propose = useProposeTrade(data.leagueId);
  const mine = data.teams.find((t) => t.id === data.myTeamId)!;
  const theirs = data.teams.find((t) => t.id === withTeam);

  const toggle = (list: number[], set: (v: number[]) => void, id: number) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : list.length < MAX_TRADE_PLAYERS ? [...list, id] : list);

  return (
    <AppShell title="Propose a trade" back={`/l/${data.leagueId}/trades`} width="wide">
      <Field label="Trade with">
        <select className={`${inputClass} lg:max-w-sm`} value={withTeam} onChange={(e) => { setWithTeam(e.target.value); setGet([]); }}>
          {others.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <Picker title="You give" players={mine.squad} picked={give} onToggle={(p) => toggle(give, setGive, p)} />
        <Picker title={`You get from ${theirs?.name ?? "them"}`} players={theirs?.squad ?? []} picked={get} onToggle={(p) => toggle(get, setGet, p)} />
      </div>
      <Field label="Message" hint="Optional">
        <input className={inputClass} maxLength={200} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Make your pitch" />
      </Field>
      <ErrorText error={propose.error} />
      <Button
        className="lg:w-64 lg:self-end"
        disabled={propose.isPending || give.length === 0 || get.length === 0}
        onClick={() =>
          propose.mutate(
            { fromTeamId: data.myTeamId, toTeamId: withTeam, give, get, ...(message.trim() ? { message: message.trim() } : {}) },
            { onSuccess: () => navigate(`/l/${data.leagueId}/trades`) },
          )
        }
      >
        {propose.isPending ? "Sending…" : `Offer ${give.length} for ${get.length}`}
      </Button>
    </AppShell>
  );
}

function Picker({ title, players, picked, onToggle }: { title: string; players: TradePlayer[]; picked: number[]; onToggle: (id: number) => void }) {
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      <ul className="flex flex-col divide-y divide-border">
        {players.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-center gap-3 py-2 text-sm">
              <input type="checkbox" checked={picked.includes(p.id)} onChange={() => onToggle(p.id)} className="size-4 accent-(--color-accent)" />
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              <PositionBadge positions={p.positions} />
              <span className="w-20 truncate text-right text-xs text-muted">{p.club ?? "—"}</span>
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}
