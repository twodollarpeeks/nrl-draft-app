import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  chooseAutopick,
  chooseCpuPick,
  roundOf,
  squadSize,
  teamForPick,
  type DraftPickView,
  type DraftPlayer,
  type DraftState,
  type MockDraftDetail,
  type MockDraftInput,
  type MockDraftSummary,
  type MockPool,
  type NrlPosition,
} from "@nrl/shared";
import { api } from "./api.ts";
import { serverNow } from "./draft.ts";

const keys = {
  pool: ["mock", "pool"] as const,
  history: ["mock", "history"] as const,
  detail: (id: string) => ["mock", "detail", id] as const,
};

export const useMockPool = () =>
  useQuery({ queryKey: keys.pool, queryFn: () => api<MockPool>("/api/mock/pool"), staleTime: 10 * 60_000 });

export const useMockHistory = () =>
  useQuery({ queryKey: keys.history, queryFn: () => api<MockDraftSummary[]>("/api/mock-drafts") });

export const useMockDraft = (id: string) =>
  useQuery({ queryKey: keys.detail(id), queryFn: () => api<MockDraftDetail>(`/api/mock-drafts/${id}`) });

export function useSaveMock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MockDraftInput) => api<MockDraftDetail>("/api/mock-drafts", { method: "POST", body: input }),
    onSuccess: (saved) => {
      qc.setQueryData(keys.detail(saved.id), saved);
      void qc.invalidateQueries({ queryKey: keys.history });
    },
  });
}

export function useDeleteMock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<null>(`/api/mock-drafts/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.history }),
  });
}

export interface MockConfig {
  teamCount: number;
  /** Your round-1 position, 1-based. */
  slot: number;
  /** 0 = no clock. */
  pickSeconds: number;
  /** How long a CPU takes over its pick. */
  cpuDelayMs: number;
}

export const CPU_SPEEDS = { fast: 400, normal: 1800 } as const;

const CPU_NAMES = [
  "Bondi Bulldozers", "Cronulla Sharknado", "Brookvale Bombers", "Redfern Rabbits", "Parramatta Powerhouse",
  "Townsville Tremors", "Canberra Cannons", "Wollongong Wave", "Newcastle Knockers", "Gold Coast Gliders",
  "Melbourne Muscle", "Auckland Avalanche", "Leichhardt Legends", "Brisbane Bruisers", "Redcliffe Rippers",
  "Perth Prowlers", "Penrith Panthers Fan Club",
];

const MY_TEAM = "Your team";

/** Ids are "t0".. by round-1 position. */
const teamId = (index: number) => `t${index}`;

/**
 * A solo mock draft, run entirely in the browser: CPUs pick for every other
 * team, your clock (if any) autopicks from your queue, and the state is shaped
 * like a real draft's so the real draft room's panels can show it.
 */
export function useMockRoom(config: MockConfig, players: DraftPlayer[], roster: MockPool["roster"]) {
  const { teamCount, slot, pickSeconds, cpuDelayMs } = config;
  const myId = teamId(slot - 1);
  // CPU names are drawn once per mock.
  const [names] = useState(() => {
    const cpu = [...CPU_NAMES].sort(() => Math.random() - 0.5);
    return Array.from({ length: teamCount }, (_, i) => (i === slot - 1 ? MY_TEAM : cpu[i % cpu.length]!));
  });
  const order = useMemo(
    () => names.map((name, i) => ({ id: teamId(i), name, ownerName: i === slot - 1 ? "You" : "CPU", ownerImage: null })),
    [names, slot],
  );
  const ids = useMemo(() => order.map((t) => t.id), [order]);
  const totalPicks = teamCount * squadSize(roster);

  const [picks, setPicks] = useState<DraftPickView[]>([]);
  const [paused, setPaused] = useState<{ remainingMs: number | null } | null>(null);
  // Time left on your clock when you paused, used once on resume.
  const resumeMs = useRef<number | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [autopilot, setAutopilot] = useState(false);
  const [queue, setQueue] = useState<number[]>([]);

  const ranked = useMemo(() => players.map((p) => p.id), [players]);
  const positions = useMemo(() => new Map(players.map((p) => [p.id, p.positions])), [players]);
  const taken = useMemo(() => new Set(picks.map((p) => p.playerId)), [picks]);
  const rosterOf = (team: string): NrlPosition[][] =>
    picks.filter((p) => p.teamId === team).map((p) => positions.get(p.playerId) ?? []);

  const currentPick = picks.length + 1;
  const complete = picks.length >= totalPicks;
  const onClock = complete ? null : teamForPick(ids, currentPick);
  const status: DraftState["status"] = complete ? "complete" : paused ? "paused" : "live";

  const add = (playerId: number, madeBy: DraftPickView["madeBy"]) =>
    setPicks((cur) => {
      // Ignore a late timer for a pick that's already been made.
      if (cur.length + 1 !== currentPick || cur.some((p) => p.playerId === playerId)) return cur;
      return [...cur, { pickNo: currentPick, round: roundOf(teamCount, currentPick), teamId: onClock!, playerId, madeBy }];
    });

  const autopickFor = (team: string, useQueue: boolean) =>
    (team === myId ? chooseAutopick : chooseCpuPick)({
      template: roster,
      roster: rosterOf(team),
      queue: useQueue ? queue : [],
      ranked,
      isAvailable: (id) => !taken.has(id),
      positionsOf: (id) => positions.get(id) ?? [],
    });

  // Keep the latest picker in a ref so the timer below always sees current state.
  const runPick = useRef<() => void>(() => {});
  runPick.current = () => {
    if (!onClock) return;
    const id = autopickFor(onClock, onClock === myId);
    if (id !== null) add(id, onClock === myId ? "autopick" : "manager");
  };

  // Each new pick: CPUs take a moment, you get the clock (or a quick autopick on autopilot).
  useEffect(() => {
    if (status !== "live" || !onClock) {
      setDeadline(null);
      return;
    }
    const mine = onClock === myId;
    const left = resumeMs.current;
    resumeMs.current = null;
    const waitMs = !mine ? cpuDelayMs : autopilot ? 1000 : pickSeconds > 0 ? (left ?? pickSeconds * 1000) : null;
    if (waitMs === null) {
      setDeadline(null);
      return;
    }
    if (mine && !autopilot) setDeadline(serverNow() + waitMs);
    else setDeadline(null);
    const t = setTimeout(() => runPick.current(), waitMs);
    return () => clearTimeout(t);
    // Re-arm on each pick, pause/resume and autopilot change.
  }, [currentPick, status, autopilot]); // eslint-disable-line react-hooks/exhaustive-deps

  const state: DraftState = {
    leagueId: "mock",
    status,
    pickSeconds,
    order,
    rounds: squadSize(roster),
    totalPicks,
    currentPick: Math.min(currentPick, totalPicks + 1),
    onClockTeamId: onClock,
    deadline: deadline && status === "live" ? new Date(deadline).toISOString() : null,
    pausedRemainingMs: paused?.remainingMs ?? null,
    picks,
    autopilotTeamIds: autopilot ? [myId] : [],
    version: picks.length,
    serverNow: new Date(serverNow()).toISOString(),
  };

  return {
    state,
    myTeamId: myId,
    teamNames: names,
    queue: queue.filter((id) => !taken.has(id)),
    setQueue,
    autopilot,
    setAutopilot,
    pick: (playerId: number) => {
      if (onClock === myId && status === "live") add(playerId, "manager");
    },
    pause: () => {
      if (status !== "live") return;
      setPaused({ remainingMs: deadline ? Math.max(0, deadline - serverNow()) : null });
    },
    resume: () => {
      resumeMs.current = paused?.remainingMs ?? null;
      setPaused(null);
    },
    /** What to save once it's done. */
    result: (): MockDraftInput => ({
      teamCount,
      slot,
      pickSeconds,
      teamNames: names,
      picks: picks.map((p) => p.playerId),
    }),
  };
}
