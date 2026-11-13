import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActivityItem, AddPlayerInput, PlayersView } from "@nrl/shared";
import { api } from "./api.ts";

export const rosterKeys = {
  players: (id: string) => ["roster", id, "players"] as const,
  activity: (id: string) => ["roster", id, "activity"] as const,
};

export const usePlayers = (leagueId: string) =>
  useQuery({ queryKey: rosterKeys.players(leagueId), queryFn: () => api<PlayersView>(`/api/leagues/${leagueId}/players`) });

export const useActivity = (leagueId: string, enabled = true) =>
  useQuery({
    queryKey: rosterKeys.activity(leagueId),
    queryFn: () => api<ActivityItem[]>(`/api/leagues/${leagueId}/activity`),
    enabled,
  });

/** A squad change: afterwards players, activity, lineups and scores may all have changed. */
function useRosterMutation<V>(leagueId: string, fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["roster", leagueId] });
      void qc.invalidateQueries({ queryKey: ["season", leagueId] });
    },
  });
}

export const useAddPlayer = (leagueId: string) =>
  useRosterMutation(leagueId, (v: AddPlayerInput) => api(`/api/leagues/${leagueId}/roster/add`, { method: "POST", body: v }));

export const useDropPlayer = (leagueId: string) =>
  useRosterMutation(leagueId, (v: { teamId: string; playerId: number }) =>
    api(`/api/leagues/${leagueId}/roster/drop`, { method: "POST", body: v }),
  );

export const useClaim = (leagueId: string) =>
  useRosterMutation(leagueId, (v: AddPlayerInput) => api(`/api/leagues/${leagueId}/waivers/claims`, { method: "POST", body: v }));

export const useCancelClaim = (leagueId: string) =>
  useRosterMutation(leagueId, (claimId: string) => api(`/api/leagues/${leagueId}/waivers/claims/${claimId}`, { method: "DELETE" }));

export const useOrderClaims = (leagueId: string) =>
  useRosterMutation(leagueId, (v: { teamId: string; claimIds: string[] }) =>
    api(`/api/leagues/${leagueId}/waivers/claims`, { method: "PUT", body: v }),
  );

/** "Wed 13 May, 6:00 am" in the viewer's time zone. */
export function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(
    new Date(iso),
  );
}

/** "3h ago", "2d ago". */
export function timeAgo(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
