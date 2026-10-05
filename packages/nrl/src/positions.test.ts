import { describe, expect, it } from "vitest";
import { derivePositions, positionFromLabel, type Start } from "./positions.ts";

const starts = (season: number, ...positions: Start["position"][]): Start[] =>
  positions.map((position) => ({ season, position }));

describe("positionFromLabel", () => {
  it("maps nrl.com labels", () => {
    expect(positionFromLabel("Five-Eighth")).toBe("FE");
    expect(positionFromLabel("2nd Row")).toBe("2RF");
    expect(positionFromLabel("Prop")).toBe("FRF");
    expect(positionFromLabel("Hooker")).toBe("HK");
  });

  it("returns null for bench labels", () => {
    expect(positionFromLabel("Interchange")).toBeNull();
    expect(positionFromLabel("Reserve")).toBeNull();
  });
});

describe("derivePositions", () => {
  it("is empty for a player who never started", () => {
    expect(derivePositions([])).toEqual([]);
  });

  it("gives a single position for a one-position player", () => {
    expect(derivePositions(starts(2026, "FB", "FB", "FB"))).toEqual(["FB"]);
  });

  it("ignores a one-off start in an odd position", () => {
    const s = starts(2026, ...Array<Start["position"]>(20).fill("CE"), "WG");
    expect(derivePositions(s)).toEqual(["CE"]);
  });

  it("makes a genuine utility dual-position, most-started first", () => {
    expect(derivePositions(starts(2026, "LK", "HK", "LK", "HK", "LK"))).toEqual(["LK", "HK"]);
  });

  it("uses only the latest season with starts", () => {
    const s = [...starts(2025, "WG", "WG", "WG", "WG"), ...starts(2026, "CE", "CE")];
    expect(derivePositions(s)).toEqual(["CE"]);
  });
});
