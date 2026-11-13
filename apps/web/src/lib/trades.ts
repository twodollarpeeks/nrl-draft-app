import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProposeTradeInput, TradesView } from "@nrl/shared";
import { api } from "./api.ts";

export const tradeKeys = { list: (id: string) => ["trades", id] as const };

export const useTrades = (leagueId: string, enabled = true) =>
  useQuery({ queryKey: tradeKeys.list(leagueId), queryFn: () => api<TradesView>(`/api/leagues/${leagueId}/trades`), enabled });

/** Anything to do with a trade can move players: refresh squads, lineups and the activity feed too. */
function useTradeMutation<V>(leagueId: string, fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      for (const key of ["trades", "roster", "season"]) void qc.invalidateQueries({ queryKey: [key, leagueId] });
    },
  });
}

export const useProposeTrade = (leagueId: string) =>
  useTradeMutation(leagueId, (v: ProposeTradeInput) => api(`/api/leagues/${leagueId}/trades`, { method: "POST", body: v }));

export type TradeAction = "accept" | "reject" | "cancel" | "approve" | "veto";

export const useTradeAction = (leagueId: string) =>
  useTradeMutation(leagueId, (v: { tradeId: string; action: TradeAction; note?: string }) =>
    api(`/api/leagues/${leagueId}/trades/${v.tradeId}/${v.action}`, { method: "POST", body: v.note ? { note: v.note } : {} }),
  );

export const useTradeVote = (leagueId: string) =>
  useTradeMutation(leagueId, (v: { tradeId: string; approve: boolean }) =>
    api(`/api/leagues/${leagueId}/trades/${v.tradeId}/vote`, { method: "POST", body: { approve: v.approve } }),
  );
