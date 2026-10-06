import {
  MAX_TEAMS,
  MIN_TEAMS,
  FINALS_SIZES,
  MIN_SEASON_END_ROUND,
  fitFinalsToTeams,
  NRL_LAST_ROUND,
  seasonRounds,
  squadSize,
  POSITION_GROUPS,
  POSITION_GROUP_LABELS,
  positionGroups,
  type NrlPosition,
  type CommissionerPermissions,
  type LeagueSettings,
  type ScoringStat,
  type MatchupSettings,
} from "@nrl/shared";
import type { ReactNode } from "react";
import { ScoringEditor, scoringSummary } from "./ScoringEditor.tsx";

type FinalsSize = (typeof FINALS_SIZES)[number];
import { Card, SectionTitle, inputClass } from "./ui.tsx";

/** What the site lets this user change (from /api/league-defaults). */
export interface SettingsLimits {
  commissionerCan: CommissionerPermissions;
  commissionerStats: ScoringStat[];
}

const LOCKED = "Set by the site admin";

const PICK_TIMES: Array<[number, string]> = [
  [30, "30 seconds"],
  [60, "60 seconds"],
  [90, "90 seconds"],
  [120, "2 minutes"],
  [300, "5 minutes"],
  [3600, "1 hour (slow draft)"],
  [8 * 3600, "8 hours (slow draft)"],
];

type MatchupChoice = "h2hFinals" | "h2h" | "total";

function matchupChoice(m: MatchupSettings): MatchupChoice {
  if (m.mode === "totalPoints") return "total";
  return m.finalsTeams > 0 ? "h2hFinals" : "h2h";
}

function matchupsFor(choice: MatchupChoice, current: MatchupSettings, teamCount: number): MatchupSettings {
  const tiebreakers =
    current.mode === "headToHead" ? current.tiebreakers : (["pointsFor", "headToHead", "pointsAgainst"] as const);
  if (choice === "total") return { mode: "totalPoints" };
  if (choice === "h2h") return { mode: "headToHead", finalsTeams: 0, tiebreakers: [...tiebreakers] };
  const keep = current.mode === "headToHead" && current.finalsTeams > 0 ? current.finalsTeams : 4;
  return { mode: "headToHead", finalsTeams: fitFinalsToTeams(keep, teamCount), tiebreakers: [...tiebreakers] };
}

const FINALS_DESCRIPTIONS: Record<FinalsSize, string> = {
  4: "Semi-finals 1v4, 2v3, then the grand final",
  6: "1v6, 2v5, 3v4; the winners and the best-ranked loser play semis, then the grand final",
  8: "NRL system: top 4 get a second chance. Qualifying, elimination, semi and preliminary finals, then the grand final",
};

export function SettingsEditor({
  value,
  onChange,
  minTeams = MIN_TEAMS,
  limits,
}: {
  value: LeagueSettings;
  onChange: (next: LeagueSettings) => void;
  minTeams?: number;
  limits: SettingsLimits;
}) {
  const set = <K extends keyof LeagueSettings>(key: K, v: LeagueSettings[K]) => onChange({ ...value, [key]: v });
  const { roster } = value;
  const can = limits.commissionerCan;
  const allowedStats = new Set(limits.commissionerStats);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
      <div className="flex flex-col gap-4">
        <Card>
          <SectionTitle>League</SectionTitle>
          <div className="flex flex-col gap-4">
            <Row label="Teams" hint={`${MIN_TEAMS}–${MAX_TEAMS}`}>
              <Stepper
                label="Teams"
                value={value.teamCount}
                min={Math.max(MIN_TEAMS, minTeams)}
                max={MAX_TEAMS}
                onChange={(n) =>
                  onChange({
                    ...value,
                    teamCount: n,
                    // Fewer teams than finals spots: shrink the finals to fit.
                    matchups:
                      value.matchups.mode === "headToHead"
                        ? { ...value.matchups, finalsTeams: fitFinalsToTeams(value.matchups.finalsTeams, n) }
                        : value.matchups,
                  })
                }
              />
            </Row>
            <Row label="Pick timer" hint={can.draftTimer ? undefined : LOCKED}>
              {!can.draftTimer ? (
                <span className="text-sm">{PICK_TIMES.find(([s]) => s === value.draft.pickSeconds)?.[1] ?? `${value.draft.pickSeconds}s`}</span>
              ) : (
              <select
                className={inputClass}
                value={value.draft.pickSeconds}
                onChange={(e) => set("draft", { ...value.draft, pickSeconds: Number(e.target.value) })}
              >
                {PICK_TIMES.map(([s, label]) => (
                  <option key={s} value={s}>
                    {label}
                  </option>
                ))}
              </select>
              )}
            </Row>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">Format{can.format ? "" : ` · ${LOCKED}`}</legend>
              {(
                [
                  ["h2hFinals", "Head-to-head + finals", "Weekly matchups, then a finals series"],
                  ["h2h", "Head-to-head, no finals", "Top of the ladder after the season wins"],
                  ["total", "Total points", "No matchups; most points over the season wins"],
                ] as const
              ).map(([choice, label, hint]) => (
                <label
                  key={choice}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 has-checked:border-accent has-disabled:cursor-default has-disabled:opacity-60"
                >
                  <input
                    type="radio"
                    name="format"
                    disabled={!can.format}
                    className="mt-1 accent-(--color-accent)"
                    checked={matchupChoice(value.matchups) === choice}
                    onChange={() => set("matchups", matchupsFor(choice, value.matchups, value.teamCount))}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-xs text-muted">{hint}</span>
                    {choice === "h2hFinals" && value.matchups.mode === "headToHead" && value.matchups.finalsTeams > 0 && (
                      <span className="mt-2 flex flex-col gap-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm">Finals teams</span>
                          <select
                            className={inputClass}
                            aria-label="Number of finals teams"
                            disabled={!can.format}
                            value={value.matchups.finalsTeams}
                            onChange={(e) =>
                              set("matchups", { ...value.matchups, finalsTeams: Number(e.target.value) as FinalsSize } as MatchupSettings)
                            }
                          >
                            {FINALS_SIZES.map((n) => (
                              <option key={n} value={n} disabled={n > value.teamCount}>
                                Top {n}
                                {n > value.teamCount ? ` (needs ${n}+ teams)` : ""}
                              </option>
                            ))}
                          </select>
                        </span>
                        <span className="text-xs text-muted">{FINALS_DESCRIPTIONS[value.matchups.finalsTeams as FinalsSize]}</span>
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </fieldset>
            <SeasonEnd value={value} disabled={!can.format} onChange={(seasonEndRound) => set("seasonEndRound", seasonEndRound)} />
          </div>
        </Card>

        <Card>
          <SectionTitle>Squad · {squadSize(roster)} players</SectionTitle>
          {!can.roster ? (
            <p className="text-sm">
              {roster.slots.map((s) => `${s.count} ${s.label}`).join(", ")}, {roster.benchSize} bench
              <span className="block text-xs text-muted">{LOCKED}</span>
            </p>
          ) : (
          <div className="flex flex-col gap-3">
            {roster.slots.map((slot, i) => (
              <Row key={slot.key} label={slot.label} hint={slotHint(slot.eligible)}>
                <Stepper
                  label={slot.label}
                  value={slot.count}
                  min={1}
                  max={6}
                  onChange={(count) => {
                    const slots = roster.slots.map((s, j) => (j === i ? { ...s, count } : s));
                    set("roster", { ...roster, slots });
                  }}
                />
              </Row>
            ))}
            <Row label="Bench" hint="Emergencies, in order">
              <Stepper
                label="Bench"
                value={roster.benchSize}
                min={0}
                max={10}
                onChange={(benchSize) => set("roster", { ...roster, benchSize })}
              />
            </Row>
          </div>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle>Scoring</SectionTitle>
        {!can.scoring || allowedStats.size === 0 ? (
          <p className="text-sm">
            {scoringSummary(value.scoring) || "Nothing scores"}
            <span className="block text-xs text-muted">{LOCKED}</span>
          </p>
        ) : (
          <ScoringEditor
            value={value.scoring}
            onChange={(scoring) => set("scoring", scoring)}
            canEdit={(stat) => allowedStats.has(stat)}
            lockedNote={LOCKED}
            hideLockedZero
          />
        )}
      </Card>
    </div>
  );
}

/** Which round the fantasy season finishes in (the grand final, with finals). */
function SeasonEnd({
  value,
  disabled,
  onChange,
}: {
  value: LeagueSettings;
  disabled: boolean;
  onChange: (round: number) => void;
}) {
  const r = seasonRounds(value.seasonEndRound, value.matchups);
  const hint = r.grandFinalRound
    ? `Regular season rounds 1–${r.lastRegularRound}, finals rounds ${r.finalsStartRound}–${r.grandFinalRound} (grand final round ${r.grandFinalRound})`
    : `Rounds 1–${r.lastRegularRound}`;
  const rounds = Array.from({ length: NRL_LAST_ROUND - MIN_SEASON_END_ROUND + 1 }, (_, i) => NRL_LAST_ROUND - i);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{r.grandFinalRound ? "Grand final in" : "Season ends after"}</span>
        <select
          className={inputClass}
          value={value.seasonEndRound}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {rounds.map((n) => (
            <option key={n} value={n}>
              Round {n}
              {n === NRL_LAST_ROUND ? " (last NRL round)" : ""}
            </option>
          ))}
        </select>
      </label>
      <span className="text-xs text-muted">
        {hint}. Clubs heading for the NRL finals often rest players late in the season, so you can finish early.
      </span>
    </div>
  );
}

/** Who can fill a slot, in the site's groups ("Any player" for a flex spot). */
function slotHint(eligible: readonly NrlPosition[]): string {
  const groups = positionGroups(eligible);
  return groups.length === POSITION_GROUPS.length ? "Any player" : groups.map((g) => POSITION_GROUP_LABELS[g]).join(", ");
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const btn = "size-11 rounded-xl bg-surface-2 text-lg font-semibold hover:bg-border disabled:opacity-40";
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <button type="button" className={btn} aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <output className="w-8 text-center font-mono" aria-live="polite">
        {value}
      </output>
      <button type="button" className={btn} aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}
