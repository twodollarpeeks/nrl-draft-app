import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { DRAFT_EVENTS, type DraftPlayer, type DraftState } from "@nrl/shared";
import { api } from "./api.ts";

export const draftKeys = {
  state: (id: string) => ["draft", id, "state"] as const,
  players: (id: string) => ["draft", id, "players"] as const,
  queue: (id: string) => ["draft", id, "queue"] as const,
};

/** Server time minus local time, so countdowns agree across devices. */
let clockOffsetMs = 0;
export const serverNow = () => Date.now() + clockOffsetMs;

function noteServerTime(state: DraftState) {
  clockOffsetMs = new Date(state.serverNow).getTime() - Date.now();
}

export type Connection = "connecting" | "live" | "reconnecting";

/**
 * Draft state, kept live over a socket. The server sends the full state on
 * join and after every change, so refreshing, reconnecting or arriving late
 * all end up showing exactly what the server has. Older versions are ignored
 * in case messages arrive out of order.
 */
export function useDraftState(leagueId: string) {
  const qc = useQueryClient();
  const [connection, setConnection] = useState<Connection>("connecting");
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: draftKeys.state(leagueId),
    queryFn: async () => {
      const s = await api<DraftState>(`/api/leagues/${leagueId}/draft`);
      noteServerTime(s);
      return s;
    },
  });

  useEffect(() => {
    const socket = io({ path: "/socket.io", withCredentials: true, transports: ["websocket", "polling"] });
    const join = () => socket.emit(DRAFT_EVENTS.join, { leagueId });
    socket.on("connect", () => {
      setConnection("live");
      join();
    });
    socket.on("disconnect", () => setConnection("reconnecting"));
    socket.on("connect_error", () => setConnection("reconnecting"));
    socket.on(DRAFT_EVENTS.state, (state: DraftState) => {
      if (state.leagueId !== leagueId) return;
      setError(null);
      acceptState(qc, state);
    });
    let retry: ReturnType<typeof setTimeout> | undefined;
    socket.on(DRAFT_EVENTS.error, (e: { message: string; retry?: boolean }) => {
      setError(e.message);
      if (e.retry) retry = setTimeout(join, 2000);
    });
    // Phones suspend sockets in the background: re-sync when the tab is visible again.
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (socket.connected) join();
        else socket.connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
      socket.disconnect();
    };
  }, [leagueId, qc]);

  return { ...query, connection, socketError: error };
}

function acceptState(qc: ReturnType<typeof useQueryClient>, state: DraftState) {
  noteServerTime(state);
  qc.setQueryData<DraftState>(draftKeys.state(state.leagueId), (prev) =>
    prev && prev.version > state.version ? prev : state,
  );
  // The queue isn't refetched here: drafted players are filtered out locally
  // (and server-side), and a refetch could clobber an edit in flight.
}

export const useDraftPlayers = (leagueId: string) =>
  useQuery({
    queryKey: draftKeys.players(leagueId),
    queryFn: () => api<DraftPlayer[]>(`/api/leagues/${leagueId}/draft/players`),
    staleTime: 5 * 60_000,
  });

export function useQueue(leagueId: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: draftKeys.queue(leagueId),
    queryFn: () => api<number[]>(`/api/leagues/${leagueId}/draft/queue`),
  });
  const save = useMutation({
    // Saves run one after another, in the order they were made.
    scope: { id: `queue:${leagueId}` },
    mutationFn: (playerIds: number[]) =>
      api<number[]>(`/api/leagues/${leagueId}/draft/queue`, { method: "PUT", body: { playerIds } }),
    // Optimistic: reorder instantly, roll back if the server refuses.
    onMutate: async (playerIds) => {
      await qc.cancelQueries({ queryKey: draftKeys.queue(leagueId) });
      const prev = qc.getQueryData<number[]>(draftKeys.queue(leagueId));
      qc.setQueryData(draftKeys.queue(leagueId), playerIds);
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(draftKeys.queue(leagueId), ctx?.prev),
  });
  /** Change the queue based on its latest value (not a stale render's copy). */
  const update = (fn: (current: number[]) => number[]) =>
    save.mutate(fn(qc.getQueryData<number[]>(draftKeys.queue(leagueId)) ?? []));
  return { queue: query.data ?? [], update, error: save.error };
}

/** A draft action that returns the new state (pick, start, pause...). */
export function useDraftAction<V = void>(leagueId: string, path: string, body?: (v: V) => unknown) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: V) =>
      api<DraftState>(`/api/leagues/${leagueId}/draft/${path}`, {
        method: "POST",
        ...(body ? { body: body(v) } : {}),
      }),
    onSuccess: (state) => acceptState(qc, state),
    onError: () => void qc.invalidateQueries({ queryKey: draftKeys.state(leagueId) }),
  });
}

/** Seconds left on the clock, ticking. Null when no clock is running. */
export function useCountdown(state: DraftState | undefined): number | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!state?.deadline) return;
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [state?.deadline]);
  if (state?.status === "paused") return Math.ceil((state.pausedRemainingMs ?? 0) / 1000);
  if (!state?.deadline) return null;
  return Math.max(0, Math.ceil((new Date(state.deadline).getTime() - serverNow()) / 1000));
}

export function formatClock(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
