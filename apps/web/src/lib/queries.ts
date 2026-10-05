import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateLeagueInput,
  InvitePreview,
  LeagueDetail,
  LeagueSummary,
  UpdateLeagueInput,
} from "@nrl/shared";
import { api } from "./api.ts";

export const keys = {
  leagues: ["leagues"] as const,
  league: (id: string) => ["league", id] as const,
  invite: (code: string) => ["invite", code] as const,
};

export const useMyLeagues = () =>
  useQuery({ queryKey: keys.leagues, queryFn: () => api<LeagueSummary[]>("/api/leagues") });

export const useLeague = (id: string) =>
  useQuery({ queryKey: keys.league(id), queryFn: () => api<LeagueDetail>(`/api/leagues/${id}`) });

export const useInvite = (code: string) =>
  useQuery({ queryKey: keys.invite(code), queryFn: () => api<InvitePreview>(`/api/invites/${code}`), retry: false });

/** Store a league response and refresh the league list. */
function useLeagueMutation<TVars>(fn: (vars: TVars) => Promise<LeagueDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (league) => {
      qc.setQueryData(keys.league(league.id), league);
      void qc.invalidateQueries({ queryKey: keys.leagues });
    },
  });
}

export const useCreateLeague = () =>
  useLeagueMutation((input: CreateLeagueInput) => api<LeagueDetail>("/api/leagues", { method: "POST", body: input }));

export const useUpdateLeague = (id: string) =>
  useLeagueMutation((input: UpdateLeagueInput) => api<LeagueDetail>(`/api/leagues/${id}`, { method: "PATCH", body: input }));

export const useResetInvite = (id: string) =>
  useLeagueMutation(() => api<LeagueDetail>(`/api/leagues/${id}/invite/reset`, { method: "POST" }));

export const useJoinLeague = (code: string) =>
  useLeagueMutation((teamName?: string) =>
    api<LeagueDetail>(`/api/invites/${code}/join`, { method: "POST", body: teamName ? { teamName } : {} }),
  );

export const useRenameTeam = () =>
  useLeagueMutation(({ teamId, name }: { teamId: string; name: string }) =>
    api<LeagueDetail>(`/api/teams/${teamId}`, { method: "PATCH", body: { name } }),
  );
