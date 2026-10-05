import { describe, expect, it } from "vitest";
import { DEFAULT_ROSTER_TEMPLATE, type NrlPosition } from "@nrl/shared";
import {
  playerStatus,
  scoreTeamRound,
  type Lineup,
  type PlayerRoundResult,
  type PlayerStatus,
} from "./teamScore.ts";

// Player ids encode their role to keep tests readable.
const HB = 1, FWD1 = 2, FWD2 = 3, FWD3 = 4, OB1 = 5, OB2 = 6, OB3 = 7, FLEX = 8;
const B_FWD = 11, B_OB = 12, B_HK = 13, B_FWD2 = 14, B_WG = 15, B_CE = 16;

const positions: Record<number, NrlPosition[]> = {
  [HB]: ["HB"], [FWD1]: ["FRF"], [FWD2]: ["2RF"], [FWD3]: ["LK"],
  [OB1]: ["FB"], [OB2]: ["WG"], [OB3]: ["CE"], [FLEX]: ["2RF"],
  [B_FWD]: ["FRF"], [B_OB]: ["WG"], [B_HK]: ["HK", "LK"], [B_FWD2]: ["2RF"],
  [B_WG]: ["WG"], [B_CE]: ["CE"],
};

const lineup: Lineup = {
  starters: { HB_HK: [HB], FWD: [FWD1, FWD2, FWD3], OB: [OB1, OB2, OB3], FLEX: [FLEX] },
  bench: [B_FWD, B_OB, B_HK, B_FWD2, B_WG, B_CE],
};

/** Everyone played and scored 10, except overrides. */
function results(overrides: Record<number, [PlayerStatus, number?]> = {}) {
  const map = new Map<number, PlayerRoundResult>();
  for (const id of Object.keys(positions).map(Number)) {
    const [status, points] = overrides[id] ?? ["played", 10];
    map.set(id, { status, points: points ?? (status === "played" ? 10 : 0), positions: positions[id]! });
  }
  return map;
}

const score = (r: Map<number, PlayerRoundResult>, l: Lineup = lineup) =>
  scoreTeamRound(DEFAULT_ROSTER_TEMPLATE, l, r);

describe("scoreTeamRound", () => {
  it("counts the 8 starters only, never the bench", () => {
    const s = score(results());
    expect(s.total).toBe(80);
    expect(s.provisional).toBe(false);
    expect(s.slots.every((x) => !x.viaEmergency)).toBe(true);
  });

  it("brings in the first eligible emergency for a starter who didn't play", () => {
    const s = score(results({ [OB2]: ["dnp"] }));
    const slot = s.slots.find((x) => x.starterId === OB2)!;
    expect(slot).toMatchObject({ scorerId: B_OB, viaEmergency: true, points: 10 });
    expect(s.total).toBe(80);
  });

  it("skips emergencies who aren't eligible for the slot", () => {
    // HB/HK slot: B_FWD and B_OB can't fill it; B_HK (hooker) can.
    const s = score(results({ [HB]: ["dnp"], [B_HK]: ["played", 25] }));
    expect(s.slots.find((x) => x.slotKey === "HB_HK")).toMatchObject({ scorerId: B_HK, points: 25 });
  });

  it("follows emergency order, not who scored most", () => {
    const s = score(results({ [FWD1]: ["dnp"], [B_FWD]: ["played", 2], [B_FWD2]: ["played", 50] }));
    expect(s.slots.find((x) => x.starterId === FWD1)!.scorerId).toBe(B_FWD);
  });

  it("skips emergencies who also didn't play", () => {
    const s = score(results({ [OB1]: ["dnp"], [B_OB]: ["dnp"] }));
    expect(s.slots.find((x) => x.starterId === OB1)!.scorerId).toBe(B_WG);
  });

  it("uses each emergency at most once", () => {
    const s = score(results({ [OB2]: ["dnp"], [OB3]: ["dnp"] }));
    expect(s.slots.find((x) => x.starterId === OB2)!.scorerId).toBe(B_OB);
    expect(s.slots.find((x) => x.starterId === OB3)!.scorerId).toBe(B_WG);
  });

  it("scores 0 for a slot nobody eligible can fill", () => {
    const s = score(results({ [OB1]: ["dnp"], [B_OB]: ["dnp"], [B_WG]: ["dnp"], [B_CE]: ["dnp"] }));
    expect(s.slots.find((x) => x.starterId === OB1)).toMatchObject({ scorerId: null, points: 0 });
    expect(s.total).toBe(70);
  });

  it("treats a bye like not playing", () => {
    // A starter with no result at all (no match this round) is a dnp.
    const r = results();
    r.delete(FLEX);
    const s = score(r);
    expect(s.slots.find((x) => x.slotKey === "FLEX")!.scorerId).toBe(B_FWD); // flex takes anyone
  });

  it("fills an empty starting slot from the bench", () => {
    const l = { ...lineup, starters: { ...lineup.starters, FLEX: [null] } };
    expect(score(results(), l).slots.find((x) => x.slotKey === "FLEX")!.scorerId).toBe(B_FWD);
  });

  it("is provisional while a starter's match is pending, scoring 0 for now", () => {
    const s = score(results({ [OB1]: ["pending"] }));
    expect(s.provisional).toBe(true);
    expect(s.total).toBe(70);
    expect(s.slots.find((x) => x.starterId === OB1)!.scorerId).toBe(OB1);
  });

  it("waits for a pending emergency rather than skipping ahead", () => {
    const s = score(results({ [OB1]: ["dnp"], [B_OB]: ["pending"] }));
    expect(s.provisional).toBe(true);
    expect(s.slots.find((x) => x.starterId === OB1)).toMatchObject({ scorerId: null, points: 0 });
  });
});

describe("playerStatus", () => {
  const base = { clubHasMatch: true, matchFinished: false, matchStarted: false, named: true, minutes: null };

  it("bye is dnp", () => expect(playerStatus({ ...base, clubHasMatch: false })).toBe("dnp"));
  it("before kickoff is pending", () => expect(playerStatus(base)).toBe("pending"));
  it("finished with minutes is played", () =>
    expect(playerStatus({ ...base, matchStarted: true, matchFinished: true, minutes: 80 })).toBe("played"));
  it("finished with 0 minutes (unused reserve) is dnp", () =>
    expect(playerStatus({ ...base, matchStarted: true, matchFinished: true, minutes: 0 })).toBe("dnp"));
  it("not named, once the match starts, is dnp", () =>
    expect(playerStatus({ ...base, matchStarted: true, named: false })).toBe("dnp"));
  it("on the field mid-match counts as played", () =>
    expect(playerStatus({ ...base, matchStarted: true, minutes: 30 })).toBe("played"));
  it("named but not yet on the field mid-match is pending", () =>
    expect(playerStatus({ ...base, matchStarted: true, minutes: 0 })).toBe("pending"));
});
