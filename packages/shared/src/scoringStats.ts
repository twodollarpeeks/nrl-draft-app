// Every stat a league can score. Most map straight to a field in nrl.com's
// per-player match stats; a few are derived. Percentages, ratios, averages
// and times aren't here: they can't be scored "per unit".
//
// The first six keys predate the full catalogue and stay as they are, so
// existing leagues' scoring keeps working.

export type StatGroup = "Scoring" | "Attack" | "Defence" | "Kicking" | "Discipline & errors";

export interface StatDef {
  key: string;
  label: string;
  group: StatGroup;
  /** Shown next to the value, e.g. "per metre". Default "each". */
  unit?: string;
  /** Raw nrl.com fields summed for this stat (minus `subtract`). */
  from: readonly string[];
  subtract?: readonly string[];
  hint?: string;
}

export const STAT_CATALOGUE = [
  // Scoring
  { key: "tries", label: "Tries", group: "Scoring", from: ["tries"] },
  { key: "goals", label: "Goals", group: "Scoring", from: ["conversions", "penaltyGoals"], hint: "Conversions + penalty goals" },
  { key: "missedGoals", label: "Missed conversions", group: "Scoring", from: ["conversionAttempts"], subtract: ["conversions"] },
  { key: "onePointFieldGoals", label: "1-point field goals", group: "Scoring", from: ["onePointFieldGoals"] },
  { key: "twoPointFieldGoals", label: "2-point field goals", group: "Scoring", from: ["twoPointFieldGoals"] },
  // Attack
  { key: "runMetres", label: "Run metres", group: "Attack", unit: "per metre", from: ["allRunMetres"] },
  { key: "allRuns", label: "Runs", group: "Attack", from: ["allRuns"] },
  { key: "postContactMetres", label: "Post-contact metres", group: "Attack", unit: "per metre", from: ["postContactMetres"] },
  { key: "kickReturnMetres", label: "Kick return metres", group: "Attack", unit: "per metre", from: ["kickReturnMetres"] },
  { key: "lineBreaks", label: "Line breaks", group: "Attack", from: ["lineBreaks"] },
  { key: "lineBreakAssists", label: "Line break assists", group: "Attack", from: ["lineBreakAssists"] },
  { key: "tryAssists", label: "Try assists", group: "Attack", from: ["tryAssists"] },
  { key: "tackleBreaks", label: "Tackle breaks", group: "Attack", from: ["tackleBreaks"] },
  { key: "offloads", label: "Offloads", group: "Attack", from: ["offloads"] },
  { key: "hitUps", label: "Hit-ups", group: "Attack", from: ["hitUps"] },
  { key: "lineEngagedRuns", label: "Line-engaged runs", group: "Attack", from: ["lineEngagedRuns"] },
  { key: "dummyHalfRuns", label: "Dummy-half runs", group: "Attack", from: ["dummyHalfRuns"] },
  { key: "dummyHalfRunMetres", label: "Dummy-half run metres", group: "Attack", unit: "per metre", from: ["dummyHalfRunMetres"] },
  { key: "playTheBalls", label: "Play-the-balls", group: "Attack", from: ["playTheBallTotal"] },
  { key: "passes", label: "Passes", group: "Attack", from: ["passes"] },
  { key: "dummyPasses", label: "Dummy passes", group: "Attack", from: ["dummyPasses"] },
  { key: "receipts", label: "Receipts", group: "Attack", from: ["receipts"] },
  // Defence
  { key: "tackles", label: "Tackles", group: "Defence", from: ["tacklesMade"] },
  { key: "missedTackles", label: "Missed tackles", group: "Defence", from: ["missedTackles"] },
  { key: "ineffectiveTackles", label: "Ineffective tackles", group: "Defence", from: ["ineffectiveTackles"] },
  { key: "intercepts", label: "Intercepts", group: "Defence", from: ["intercepts"] },
  { key: "kicksDefused", label: "Kicks defused", group: "Defence", from: ["kicksDefused"] },
  { key: "oneOnOneSteals", label: "One-on-one steals", group: "Defence", from: ["oneOnOneSteal"] },
  // Kicking
  { key: "kicks", label: "Kicks", group: "Kicking", from: ["kicks"] },
  { key: "kickMetres", label: "Kick metres", group: "Kicking", unit: "per metre", from: ["kickMetres"] },
  { key: "forcedDropOuts", label: "Forced drop-outs", group: "Kicking", from: ["forcedDropOutKicks"] },
  { key: "fortyTwenties", label: "40/20s", group: "Kicking", from: ["fortyTwentyKicks"] },
  { key: "twentyForties", label: "20/40s", group: "Kicking", from: ["twentyFortyKicks"] },
  { key: "bombKicks", label: "Bomb kicks", group: "Kicking", from: ["bombKicks"] },
  { key: "grubberKicks", label: "Grubbers", group: "Kicking", from: ["grubberKicks"] },
  { key: "crossFieldKicks", label: "Cross-field kicks", group: "Kicking", from: ["crossFieldKicks"] },
  { key: "kicksDead", label: "Kicks dead", group: "Kicking", from: ["kicksDead"] },
  // Discipline & errors
  { key: "errors", label: "Errors", group: "Discipline & errors", from: ["errors"], hint: "All errors, including handling errors" },
  { key: "handlingErrors", label: "Handling errors", group: "Discipline & errors", from: ["handlingErrors"], hint: "Already counted in Errors" },
  { key: "oneOnOneLost", label: "One-on-ones lost", group: "Discipline & errors", from: ["oneOnOneLost"] },
  { key: "penalties", label: "Penalties conceded", group: "Discipline & errors", from: ["penalties"] },
  { key: "ruckInfringements", label: "Ruck infringements", group: "Discipline & errors", from: ["ruckInfringements"] },
  { key: "inside10Metres", label: "Inside 10 metres", group: "Discipline & errors", from: ["offsideWithinTenMetres"] },
  { key: "onReport", label: "On report", group: "Discipline & errors", from: ["onReport"] },
  { key: "sinBins", label: "Sin bins", group: "Discipline & errors", from: ["sinBins"] },
  { key: "sendOffs", label: "Send-offs", group: "Discipline & errors", from: ["sendOffs"] },
] as const satisfies readonly StatDef[];

export const STAT_GROUPS: readonly StatGroup[] = ["Scoring", "Attack", "Defence", "Kicking", "Discipline & errors"];

export const STAT_BY_KEY: Readonly<Record<string, StatDef>> = Object.fromEntries(STAT_CATALOGUE.map((s) => [s.key, s]));

/** Every raw nrl.com field any stat reads. */
export const RAW_STAT_FIELDS: readonly string[] = [
  ...new Set(STAT_CATALOGUE.flatMap((s: StatDef) => [...s.from, ...(s.subtract ?? [])])),
];

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Value of one catalogue stat from raw nrl.com fields (one match or summed). */
export function statValue(def: StatDef, raw: Readonly<Record<string, unknown>>): number {
  const plus = def.from.reduce((s, f) => s + num(raw[f]), 0);
  const minus = (def.subtract ?? []).reduce((s, f) => s + num(raw[f]), 0);
  return plus - minus;
}

/** Every catalogue stat from raw nrl.com fields. */
export function statLineFromRaw(raw: Readonly<Record<string, unknown>>): Record<string, number> {
  return Object.fromEntries(STAT_CATALOGUE.map((d) => [d.key, statValue(d, raw)]));
}

// ---- Stat lines ("125m, 20t, 1T, 2G") ------------------------------------

/** Short labels for a player's stat line, NFL-fantasy style. */
export const STAT_ABBR: Record<string, string> = {
  tries: "T",
  goals: "G",
  missedGoals: "MG",
  onePointFieldGoals: "FG",
  twoPointFieldGoals: "2FG",
  runMetres: "m",
  allRuns: "R",
  postContactMetres: "PCm",
  kickReturnMetres: "KRm",
  lineBreaks: "LB",
  lineBreakAssists: "LBA",
  tryAssists: "TA",
  tackleBreaks: "TB",
  offloads: "OL",
  hitUps: "HU",
  lineEngagedRuns: "LER",
  dummyHalfRuns: "DHR",
  dummyHalfRunMetres: "DHm",
  playTheBalls: "PTB",
  passes: "P",
  dummyPasses: "DP",
  receipts: "Rec",
  tackles: "t",
  missedTackles: "MT",
  ineffectiveTackles: "IT",
  intercepts: "Int",
  kicksDefused: "KD",
  oneOnOneSteals: "Stl",
  kicks: "K",
  kickMetres: "Km",
  forcedDropOuts: "FDO",
  fortyTwenties: "40/20",
  twentyForties: "20/40",
  bombKicks: "Bomb",
  grubberKicks: "Grub",
  crossFieldKicks: "CFK",
  kicksDead: "KDd",
  errors: "E",
  handlingErrors: "HE",
  oneOnOneLost: "1v1L",
  penalties: "Pen",
  ruckInfringements: "Ruck",
  inside10Metres: "10m",
  onReport: "Rep",
  sinBins: "SB",
  sendOffs: "SO",
};

// The headline stats lead the line; anything else follows in catalogue order.
const STAT_LINE_LEAD = ["runMetres", "tackles", "tries", "tryAssists", "goals"];

/** "125m, 20t, 1T, 2G" from a player's scored stats (zeros left out). */
export function formatStatLine(stats: ReadonlyArray<{ stat: string; value: number }>): string {
  const rank = (stat: string) => {
    const lead = STAT_LINE_LEAD.indexOf(stat);
    return lead >= 0 ? lead : STAT_LINE_LEAD.length + STAT_CATALOGUE.findIndex((s) => s.key === stat);
  };
  return [...stats]
    .filter((s) => s.value !== 0)
    .sort((a, b) => rank(a.stat) - rank(b.stat))
    .map((s) => `${Number.isInteger(s.value) ? s.value : s.value.toFixed(1)}${STAT_ABBR[s.stat] ?? s.stat}`)
    .join(", ");
}
