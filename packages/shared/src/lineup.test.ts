import { describe, expect, it } from "vitest";
import { DEFAULT_ROSTER_TEMPLATE as T } from "./leagueSettings.ts";
import {
  autoLineup,
  canSwap,
  lineupErrors,
  moveToBench,
  movedLockedPlayers,
  reconcileLineup,
  swapSpots,
  type Lineup,
  type SquadPlayer,
} from "./lineup.ts";

// 14-man squad, best first: ids encode position.
const squad: SquadPlayer[] = [
  { id: 1, positions: ["FRF"] },
  { id: 2, positions: ["WG"] },
  { id: 3, positions: ["HB"] },
  { id: 4, positions: ["2RF"] },
  { id: 5, positions: ["CE"] },
  { id: 6, positions: ["LK", "HK"] },
  { id: 7, positions: ["FB"] },
  { id: 8, positions: ["FRF"] },
  { id: 9, positions: ["WG"] },
  { id: 10, positions: ["2RF"] },
  { id: 11, positions: ["FE"] },
  { id: 12, positions: ["CE"] },
  { id: 13, positions: [] },
  { id: 14, positions: ["HK"] },
];

describe("autoLineup", () => {
  const l = autoLineup(T, squad);

  it("fills every slot with the best eligible players, most restrictive slot first", () => {
    expect(l.starters).toEqual({ HB_HK: [3], FWD: [1, 4, 6], OB: [2, 5, 7], FLEX: [8] });
  });

  it("benches everyone else in ranking order", () => {
    expect(l.bench).toEqual([9, 10, 11, 12, 13, 14]);
  });

  it("is a valid lineup", () => {
    expect(lineupErrors(T, squad, l)).toEqual([]);
  });
});

describe("lineupErrors", () => {
  const base = autoLineup(T, squad);

  it("rejects a player in a slot they can't play", () => {
    const bad: Lineup = { ...base, starters: { ...base.starters, HB_HK: [1] }, bench: [...base.bench.filter((x) => x !== 1), 3] };
    expect(lineupErrors(T, squad, bad).join()).toMatch(/can't play HF\/HK/);
  });

  it("rejects missing, duplicated and unknown players", () => {
    expect(lineupErrors(T, squad, { ...base, bench: base.bench.slice(1) }).join()).toMatch(/missing/);
    expect(lineupErrors(T, squad, { ...base, bench: [...base.bench, 9] }).join()).toMatch(/twice/);
    expect(lineupErrors(T, squad, { ...base, bench: [...base.bench, 99] }).join()).toMatch(/isn't in your squad/);
  });

  it("allows an empty starting spot (that player goes to the bench)", () => {
    const l: Lineup = { starters: { ...base.starters, FLEX: [null] }, bench: [8, ...base.bench] };
    expect(lineupErrors(T, squad, l)).toEqual([]);
  });

  it("rejects too many players in a slot", () => {
    expect(lineupErrors(T, squad, { ...base, starters: { ...base.starters, FLEX: [8, 9] }, bench: base.bench.filter((x) => x !== 9) }).join()).toMatch(/room for 1/);
  });
});

describe("movedLockedPlayers", () => {
  const base = autoLineup(T, squad);
  // Swap 8 (FLEX) and 9 (bench 1).
  const swapped: Lineup = { starters: { ...base.starters, FLEX: [9] }, bench: [8, ...base.bench.filter((x) => x !== 9)] };

  it("allows moving unlocked players", () => {
    expect(movedLockedPlayers(base, swapped, () => false)).toEqual([]);
  });

  it("stops a locked player being moved, or their spot being taken", () => {
    expect(movedLockedPlayers(base, swapped, (id) => id === 8)).toEqual([8]);
    expect(movedLockedPlayers(base, swapped, (id) => id === 9)).toEqual([9]);
  });

  it("counts a change of bench order for a locked player", () => {
    const reordered: Lineup = { ...base, bench: [base.bench[1]!, base.bench[0]!, ...base.bench.slice(2)] };
    expect(movedLockedPlayers(base, reordered, (id) => id === base.bench[0])).toEqual([base.bench[0]]);
  });
});

describe("reconcileLineup", () => {
  it("drops departed players and adds new ones to the end of the bench", () => {
    const base = autoLineup(T, squad);
    const newSquad = [...squad.filter((p) => p.id !== 2 && p.id !== 9), { id: 20, positions: ["WG" as const] }];
    const r = reconcileLineup(T, newSquad, base);
    expect(r.starters.OB).toEqual([null, 5, 7]);
    expect(r.bench).toEqual([10, 11, 12, 13, 14, 20]);
    expect(lineupErrors(T, newSquad, r)).toEqual([]);
  });
});

describe("swapSpots / moveToBench / canSwap", () => {
  const base = autoLineup(T, squad); // FLEX: [8], bench [9..14]

  it("swaps a starter with a bench player", () => {
    const l = swapSpots(base, "FLEX:0", "bench:0");
    expect(l.starters.FLEX).toEqual([9]);
    expect(l.bench).toEqual([8, 10, 11, 12, 13, 14]);
    expect(lineupErrors(T, squad, l)).toEqual([]);
  });

  it("reorders the bench (emergency order)", () => {
    expect(swapSpots(base, "bench:0", "bench:2").bench).toEqual([11, 10, 9, 12, 13, 14]);
  });

  it("fills an empty starting spot from the bench without leaving a gap", () => {
    const emptied = moveToBench(base, "FLEX:0");
    expect(emptied.starters.FLEX).toEqual([null]);
    expect(emptied.bench).toEqual([9, 10, 11, 12, 13, 14, 8]);
    const filled = swapSpots(emptied, "bench:1", "FLEX:0");
    expect(filled.starters.FLEX).toEqual([10]);
    expect(filled.bench).toEqual([9, 11, 12, 13, 14, 8]);
    expect(lineupErrors(T, squad, filled)).toEqual([]);
  });

  it("checks both players can play their new spots", () => {
    expect(canSwap(T, squad, base, "FWD:0", "bench:0")).toBe(false); // winger 9 can't play FWD
    expect(canSwap(T, squad, base, "FWD:0", "bench:1")).toBe(true); // 2RF 10 can
    expect(canSwap(T, squad, base, "HB_HK:0", "bench:5")).toBe(true); // hooker 14 for HB 3
    expect(canSwap(T, squad, base, "bench:0", "bench:3")).toBe(true);
  });
});
