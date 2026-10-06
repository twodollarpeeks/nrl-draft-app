import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { Navigate } from "react-router";
import { NRL_POSITIONS, POSITION_LABELS, type AdminPlayer, type NrlPosition, type PlayerFilter } from "@nrl/shared";
import { AppShell } from "../components/Layout.tsx";
import { Button, Card, ErrorText, Spinner, inputClass } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { useMe } from "../lib/queries.ts";

const FILTERS: Array<[PlayerFilter, string]> = [
  ["missing", "No position"],
  ["overridden", "Overridden"],
  ["all", "All players"],
];

export function AdminPlayersPage() {
  const { data: me, isPending } = useMe();
  const [filter, setFilter] = useState<PlayerFilter>("missing");
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());

  const players = useQuery({
    queryKey: ["admin", "players", filter, query],
    queryFn: () =>
      api<AdminPlayer[]>(`/api/admin/players?filter=${filter}&limit=100${query ? `&q=${encodeURIComponent(query)}` : ""}`),
    enabled: !!me?.isAdmin,
  });

  if (isPending) return <AppShell back="/profile"><Spinner /></AppShell>;
  if (!me?.isAdmin) return <Navigate to="/leagues" replace />;

  return (
    <AppShell title="Player positions" back="/profile" width="wide">
      <p className="text-sm text-muted">
        Positions come from where each player started last season. Set an override for players with none, or to make
        someone dual-position. Overrides are never changed by the weekly import.
      </p>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex gap-2" role="tablist" aria-label="Filter players">
          {FILTERS.map(([f, label]) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`min-h-11 rounded-full px-4 text-sm font-medium ${filter === f ? "bg-accent text-bg" : "bg-surface-2 text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="search"
          className={`${inputClass} lg:ml-auto lg:w-80`}
          placeholder="Search players"
          aria-label="Search players"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {players.isPending && <Spinner />}
      <ErrorText error={players.error} />
      {players.data?.length === 0 && (
        <Card className="text-center text-sm text-muted">
          {filter === "missing" && !query ? "Every player has a position." : "No players found."}
        </Card>
      )}
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {players.data?.map((p) => (
          <li key={p.id}>
            <PlayerRow player={p} />
          </li>
        ))}
      </ul>
    </AppShell>
  );
}

function PlayerRow({ player }: { player: AdminPlayer }) {
  const qc = useQueryClient();
  const initial = player.positionsOverride.length ? player.positionsOverride : player.derivedPositions;
  const [selected, setSelected] = useState<NrlPosition[]>(initial);
  const save = useMutation({
    mutationFn: (positionsOverride: NrlPosition[]) =>
      api<AdminPlayer>(`/api/admin/players/${player.id}`, { method: "PATCH", body: { positionsOverride } }),
    onSuccess: (updated) => {
      setSelected(updated.positions);
      void qc.invalidateQueries({ queryKey: ["admin", "players"] });
    },
  });

  const toggle = (pos: NrlPosition) =>
    setSelected((cur) => (cur.includes(pos) ? cur.filter((p) => p !== pos) : [...cur, pos]));
  const changed = selected.join() !== player.positions.join();
  const sorted = NRL_POSITIONS.filter((p) => selected.includes(p));

  return (
    <Card className="flex h-full flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold">{player.name}</div>
          <div className="text-sm text-muted">
            {player.club?.nickName ?? "No club"} · {player.appearances} games
          </div>
        </div>
        <div className="shrink-0 text-right text-xs text-muted">
          {player.positionsOverride.length ? (
            <span className="text-accent">Override</span>
          ) : player.derivedPositions.length ? (
            "From starts"
          ) : (
            <span className="text-danger">No position</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={`Positions for ${player.name}`}>
        {NRL_POSITIONS.map((pos) => (
          <button
            key={pos}
            type="button"
            aria-pressed={selected.includes(pos)}
            title={POSITION_LABELS[pos]}
            onClick={() => toggle(pos)}
            className={`min-h-9 min-w-11 rounded-lg px-2 text-sm font-semibold ${
              selected.includes(pos) ? "bg-accent text-bg" : "bg-surface-2 text-muted hover:text-text"
            }`}
          >
            {pos}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled={!changed || sorted.length === 0 || save.isPending} onClick={() => save.mutate(sorted)}>
          {save.isPending ? "Saving…" : "Save override"}
        </Button>
        {player.positionsOverride.length > 0 && (
          <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate([])}>
            Clear override{player.derivedPositions.length ? ` (back to ${player.derivedPositions.join("/")})` : ""}
          </Button>
        )}
      </div>
      <ErrorText error={save.error} />
    </Card>
  );
}
