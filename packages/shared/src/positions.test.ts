import { describe, expect, it } from "vitest";
import { DEFAULT_ROSTER_TEMPLATE } from "./leagueSettings.ts";
import { GROUP_POSITIONS, NRL_POSITIONS, groupsLabel, positionGroups } from "./positions.ts";

describe("position groups", () => {
  it("label players by the site's groups, main group first", () => {
    expect(groupsLabel(["HB"])).toBe("HF/HK");
    expect(groupsLabel(["FRF", "2RF"])).toBe("FWD");
    expect(groupsLabel(["CE", "FE", "HB"])).toBe("OB · HF/HK");
    expect(groupsLabel([])).toBe("");
    expect(positionGroups(["LK", "HK"])).toEqual(["fwd", "half"]);
  });

  it("cover every NRL position exactly once, matching the default slots", () => {
    const all = Object.values(GROUP_POSITIONS).flat();
    expect([...all].sort()).toEqual([...NRL_POSITIONS].sort());
    const slot = (key: string) => DEFAULT_ROSTER_TEMPLATE.slots.find((s) => s.key === key)!.eligible;
    expect([...slot("HB_HK")].sort()).toEqual([...GROUP_POSITIONS.half].sort());
    expect([...slot("FWD")].sort()).toEqual([...GROUP_POSITIONS.fwd].sort());
    expect([...slot("OB")].sort()).toEqual([...GROUP_POSITIONS.ob].sort());
  });
});
