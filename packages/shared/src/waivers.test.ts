import { describe, expect, it } from "vitest";
import { resolveWaivers, waiverClearings, type ClaimInput } from "./waivers.ts";

describe("waiver clearing times", () => {
  it("is Wednesday 6am Sydney time: 8pm UTC Tuesday in winter (AEST)", () => {
    // Friday 15 May 2026, midday Sydney.
    const { last, next } = waiverClearings(new Date("2026-05-15T02:00:00Z"));
    expect(last.toISOString()).toBe("2026-05-12T20:00:00.000Z"); // Wed 13 May 6am AEST
    expect(next.toISOString()).toBe("2026-05-19T20:00:00.000Z");
  });

  it("follows daylight saving: 7pm UTC Tuesday in March (AEDT)", () => {
    const { last, next } = waiverClearings(new Date("2027-03-12T00:00:00Z"));
    expect(last.toISOString()).toBe("2027-03-09T19:00:00.000Z"); // Wed 10 Mar 6am AEDT
    expect(next.toISOString()).toBe("2027-03-16T19:00:00.000Z");
  });

  it("counts the clearing moment as passed, and is right just before it", () => {
    const at = new Date("2026-05-12T20:00:00Z");
    expect(waiverClearings(at).last.toISOString()).toBe(at.toISOString());
    const before = waiverClearings(new Date(at.getTime() - 1000));
    expect(before.last.toISOString()).toBe("2026-05-05T20:00:00.000Z");
    expect(before.next.toISOString()).toBe(at.toISOString());
  });

  it("handles the week daylight saving ends (April)", () => {
    // DST ends Sunday 4 April 2027: Wed 7 Apr 6am is AEST again.
    const { last } = waiverClearings(new Date("2027-04-08T00:00:00Z"));
    expect(last.toISOString()).toBe("2027-04-06T20:00:00.000Z");
  });
});

describe("resolveWaivers", () => {
  const base = {
    order: ["A", "B", "C"],
    owners: new Map<number, string>([[100, "A"], [200, "B"], [300, "C"]]),
    squadSizes: new Map([["A", 2], ["B", 2], ["C", 2]]),
    maxSquad: 3,
    isLocked: () => false,
  };
  const claim = (id: string, teamId: string, playerId: number, rank = 1, dropPlayerId: number | null = null): ClaimInput => ({
    id, teamId, playerId, rank, dropPlayerId,
  });

  it("gives a contested player to the team first in line, which then goes to the back", () => {
    const r = resolveWaivers({ ...base, claims: [claim("c1", "C", 1), claim("b1", "B", 1), claim("a1", "A", 1)] });
    expect(r.outcomes.get("a1")).toEqual({ status: "won" });
    expect(r.outcomes.get("b1")?.status).toBe("lost");
    expect(r.outcomes.get("c1")?.status).toBe("lost");
    expect(r.order).toEqual(["B", "C", "A"]);
  });

  it("takes turns: after winning, a team waits behind everyone else's next claim", () => {
    const r = resolveWaivers({
      ...base,
      claims: [claim("a1", "A", 1, 1), claim("a2", "A", 2, 2), claim("b1", "B", 1, 1), claim("b2", "B", 2, 2)],
    });
    // A gets 1; then B (now first) gets its next live claim, 2; A's second claim is lost.
    expect(r.outcomes.get("a1")).toEqual({ status: "won" });
    expect(r.outcomes.get("b2")).toEqual({ status: "won" });
    expect(r.outcomes.get("a2")?.status).toBe("lost");
    expect(r.order).toEqual(["C", "A", "B"]);
  });

  it("needs room in the squad, or a drop", () => {
    const full = { ...base, squadSizes: new Map([["A", 3], ["B", 2], ["C", 2]]) };
    const r = resolveWaivers({ ...full, claims: [claim("a1", "A", 1), claim("a2", "A", 2, 2, 100)] });
    expect(r.outcomes.get("a1")).toMatchObject({ status: "failed", note: expect.stringMatching(/full/) });
    expect(r.outcomes.get("a2")).toEqual({ status: "won" });
  });

  it("fails a claim whose drop player has already gone, or whose players are locked", () => {
    const r = resolveWaivers({
      ...base,
      isLocked: (id) => id === 3,
      claims: [claim("a1", "A", 1, 1, 100), claim("a2", "A", 2, 2, 100), claim("b1", "B", 3)],
    });
    expect(r.outcomes.get("a1")).toEqual({ status: "won" });
    expect(r.outcomes.get("a2")).toMatchObject({ status: "failed", note: expect.stringMatching(/no longer in your squad/) });
    expect(r.outcomes.get("b1")).toMatchObject({ status: "failed", note: expect.stringMatching(/game has started/) });
  });

  it("fails claims on players who are already owned", () => {
    const r = resolveWaivers({ ...base, claims: [claim("a1", "A", 200)] });
    expect(r.outcomes.get("a1")).toMatchObject({ status: "failed", note: expect.stringMatching(/already on a team/) });
    expect(r.order).toEqual(base.order);
  });
});
