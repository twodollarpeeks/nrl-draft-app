import { describe, expect, it } from "vitest";
import {
  checkDraftable,
  chooseAutopick,
  picksForTeam,
  roundOf,
  snakeIndex,
  startersFillable,
  teamForPick,
} from "./draft.ts";
import { DEFAULT_ROSTER_TEMPLATE as T, type RosterTemplate } from "./leagueSettings.ts";
import type { NrlPosition } from "./positions.ts";

describe("snake order", () => {
  const order = ["A", "B", "C", "D"];

  it("goes forward in odd rounds and backward in even rounds", () => {
    const picks = Array.from({ length: 12 }, (_, i) => teamForPick(order, i + 1));
    expect(picks.join("")).toBe("ABCDDCBAABCD");
  });

  it("knows the round", () => {
    expect([1, 4, 5, 8, 9].map((p) => roundOf(4, p))).toEqual([1, 1, 2, 2, 3]);
  });

  it("lists each team's pick numbers consistently with snakeIndex", () => {
    for (let i = 0; i < 4; i++) {
      const picks = picksForTeam(4, 14, i);
      expect(picks).toHaveLength(14);
      expect(picks.every((p) => snakeIndex(4, p) === i)).toBe(true);
    }
    expect(picksForTeam(4, 3, 0)).toEqual([1, 8, 9]);
  });
});

const HB: NrlPosition[] = ["HB"];
const FWD: NrlPosition[] = ["FRF"];
const OB: NrlPosition[] = ["WG"];
const NONE: NrlPosition[] = [];

describe("startersFillable", () => {
  it("counts slots filled with each player used once", () => {
    expect(startersFillable(T, [HB, FWD, FWD, FWD, OB, OB, OB, FWD])).toBe(8); // 4th FWD goes to FLEX
    expect(startersFillable(T, [HB, HB])).toBe(2); // second half to FLEX
    expect(startersFillable(T, [HB, HB, HB])).toBe(2);
    expect(startersFillable(T, [NONE, NONE])).toBe(0);
  });

  it("re-arranges dual-position players to fill more slots", () => {
    // A hooker/lock can fill HB/HK, letting the second lock-only player
    // take a forward slot... order of arrival shouldn't matter.
    const dual: NrlPosition[] = ["HK", "LK"];
    const tpl: RosterTemplate = {
      benchSize: 0,
      slots: [
        { key: "HB_HK", label: "HB/HK", count: 1, eligible: ["HB", "HK"] },
        { key: "FWD", label: "FWD", count: 1, eligible: ["LK"] },
      ],
    };
    expect(startersFillable(tpl, [dual, ["LK"]])).toBe(2);
  });
});

describe("checkDraftable", () => {
  it("allows anyone early: they can go on the bench", () => {
    expect(checkDraftable(T, [HB], HB)).toEqual({ ok: true });
    expect(checkDraftable(T, [], NONE)).toEqual({ ok: true });
  });

  it("forces late picks to fill starting gaps", () => {
    // 13 picks made: 7 starters filled + 6 forwards on the bench, no outside
    // back slot filled yet... last pick must be an OB (or a FLEX-capable one
    // won't help since FLEX is taken).
    const roster = [HB, FWD, FWD, FWD, OB, OB, FWD, FWD, FWD, FWD, FWD, FWD, FWD];
    expect(startersFillable(T, roster)).toBe(7);
    expect(checkDraftable(T, roster, FWD)).toMatchObject({ ok: false });
    expect(checkDraftable(T, roster, ["CE"])).toEqual({ ok: true });
  });

  it("rejects picks once the squad is full", () => {
    const full = Array.from({ length: 14 }, () => FWD);
    expect(checkDraftable(T, full, OB)).toEqual({ ok: false, reason: "Your squad is full" });
  });
});

describe("chooseAutopick", () => {
  const positions: Record<number, NrlPosition[]> = { 1: HB, 2: FWD, 3: OB, 4: OB, 5: FWD };
  const base = {
    template: T,
    roster: [] as NrlPosition[][],
    queue: [] as number[],
    ranked: [2, 3, 1, 4, 5],
    isAvailable: () => true,
    positionsOf: (id: number) => positions[id] ?? [],
  };

  it("takes the first available player in the queue", () => {
    expect(chooseAutopick({ ...base, queue: [4, 1] })).toBe(4);
  });

  it("skips queued players already taken", () => {
    expect(chooseAutopick({ ...base, queue: [4, 1], isAvailable: (id) => id !== 4 })).toBe(1);
  });

  it("falls back to best available when the queue is empty or exhausted", () => {
    expect(chooseAutopick(base)).toBe(2);
    expect(chooseAutopick({ ...base, queue: [4], isAvailable: (id) => id !== 4 })).toBe(2);
  });

  it("skips players who don't fit what the team still needs", () => {
    const roster = [HB, FWD, FWD, FWD, OB, OB, FWD, FWD, FWD, FWD, FWD, FWD, FWD];
    expect(chooseAutopick({ ...base, roster, queue: [5] })).toBe(3); // queued FWD doesn't fit
  });

  it("returns null when nobody fits", () => {
    expect(chooseAutopick({ ...base, isAvailable: () => false })).toBeNull();
  });
});
