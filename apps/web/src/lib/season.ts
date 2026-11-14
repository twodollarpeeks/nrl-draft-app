import { useMutation, useQuery, useQueryClient, type Query } from "@tanstack/react-query";
import { useEffect } from "react";
import type { Lineup, RoundView, SeasonOverview, TeamRoundView } from "@nrl/shared";
import { api } from "./api.ts";

// Live rounds refresh every minute so scores tick over while games are on.
const LIVE_REFRESH_MS = 60_000;

export const seasonKeys = {
  overview: (id: string) => ["season", id] as const,
  round: (id: string, round: number) => ["season", id, "round", round] as const,
  team: (id: string, teamId: string, round: number) => ["season", id, "team", teamId, round] as const,
};

export const useSeason = (leagueId: string, enabled = true) =>
  useQuery({
    queryKey: seasonKeys.overview(leagueId),
    queryFn: () => api<SeasonOverview>(`/api/leagues/${leagueId}/season`),
    enabled,
    refetchInterval: (q) => (q.state.data?.rounds.some((r) => r.status === "live") ? LIVE_REFRESH_MS : false),
  });

// A finished round's scores don't change: no need to fetch it again for a while.
const FINISHED_ROUND_STALE_MS = 10 * 60_000;

export const useRound = (leagueId: string, round: number | undefined) =>
  useQuery({
    queryKey: seasonKeys.round(leagueId, round ?? 0),
    queryFn: () => api<RoundView>(`/api/leagues/${leagueId}/rounds/${round}`),
    enabled: round !== undefined,
    staleTime: (q: Query<RoundView>) => (q.state.data?.status === "complete" ? FINISHED_ROUND_STALE_MS : 0),
    // Moving between rounds, keep the last one on screen until the next arrives.
    placeholderData: (prev) => prev,
    refetchInterval: (q) => (q.state.data?.status === "live" ? LIVE_REFRESH_MS : false),
  });

const teamRoundQuery = (leagueId: string, teamId: string, round: number) => ({
  queryKey: seasonKeys.team(leagueId, teamId, round),
  queryFn: () => api<TeamRoundView>(`/api/leagues/${leagueId}/teams/${teamId}/rounds/${round}`),
  staleTime: (q: Query<TeamRoundView>) => (q.state.data?.roundStatus === "complete" ? FINISHED_ROUND_STALE_MS : 0),
});

export const useTeamRound = (leagueId: string, teamId: string | undefined, round: number | undefined) =>
  useQuery({
    ...teamRoundQuery(leagueId, teamId ?? "", round ?? 0),
    enabled: !!teamId && round !== undefined,
    // Same team, another round: keep showing the last one until it arrives.
    placeholderData: (prev) => (prev?.teamId === teamId ? prev : undefined),
    refetchInterval: (q) => (q.state.data?.roundStatus === "live" ? LIVE_REFRESH_MS : false),
  });

/** Load the rounds either side in the background, so the arrows are instant. */
export function usePrefetchNeighbours(leagueId: string, teamId: string, round: number, first: number, last: number) {
  const qc = useQueryClient();
  useEffect(() => {
    for (const r of [round + 1, round - 1]) {
      if (r >= first && r <= last) void qc.prefetchQuery(teamRoundQuery(leagueId, teamId, r));
    }
  }, [qc, leagueId, teamId, round, first, last]);
}

export function useSaveLineup(leagueId: string, teamId: string, round: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lineup: Lineup) =>
      api<TeamRoundView>(`/api/leagues/${leagueId}/teams/${teamId}/rounds/${round}/lineup`, { method: "PUT", body: lineup }),
    onSuccess: (view) => {
      qc.setQueryData(seasonKeys.team(leagueId, teamId, round), view);
      // Later rounds may carry this lineup forward.
      void qc.invalidateQueries({ queryKey: ["season", leagueId] });
    },
  });
}

/** "Thu 7:50 pm" in the viewer's time zone. */
export function formatKickoff(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function formatPoints(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
