import {
  MAX_TEAMS,
  MIN_TEAMS,
  SCORING_STAT_LABELS,
  SCORING_STATS,
  squadSize,
  type LeagueSettings,
  type MatchupSettings,
} from "@nrl/shared";
import type { ReactNode } from "react";
import { Card, SectionTitle, inputClass } from "./ui.tsx";

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
  return m.finalsTeams === 4 ? "h2hFinals" : "h2h";
}

function matchupsFor(choice: MatchupChoice, current: MatchupSettings): MatchupSettings {
  const tiebreakers =
    current.mode === "headToHead" ? current.tiebreakers : (["pointsFor", "headToHead", "pointsAgainst"] as const);
  if (choice === "total") return { mode: "totalPoints" };
  return { mode: "headToHead", finalsTeams: choice === "h2hFinals" ? 4 : 0, tiebreakers: [...tiebreakers] };
}

export function SettingsEditor({
  value,
  onChange,
  minTeams = MIN_TEAMS,
}: {
  value: LeagueSettings;
  onChange: (next: LeagueSettings) => void;
  minTeams?: number;
}) {
  const set = <K extends keyof LeagueSettings>(key: K, v: LeagueSettings[K]) => onChange({ ...value, [key]: v });
  const { roster } = value;

  return (
    <>
      <Card>
        <SectionTitle>League</SectionTitle>
        <div className="flex flex-col gap-4">
          <Row label="Teams" hint={`${MIN_TEAMS}–${MAX_TEAMS}`}>
            <Stepper
              label="Teams"
              value={value.teamCount}
              min={Math.max(MIN_TEAMS, minTeams)}
              max={MAX_TEAMS}
              onChange={(n) => set("teamCount", n)}
            />
          </Row>
          <Row label="Pick timer">
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
          </Row>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Format</legend>
            {(
              [
                ["h2hFinals", "Head-to-head + top 4 finals", "Weekly matchups; semis round 26, grand final round 27"],
                ["h2h", "Head-to-head, no finals", "Top of the ladder after the season wins"],
                ["total", "Total points", "No matchups; most points over the season wins"],
              ] as const
            ).map(([choice, label, hint]) => (
              <label
                key={choice}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 has-checked:border-accent"
              >
                <input
                  type="radio"
                  name="format"
                  className="mt-1 accent-(--color-accent)"
                  checked={matchupChoice(value.matchups) === choice}
                  onChange={() => set("matchups", matchupsFor(choice, value.matchups))}
                />
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
      </Card>

      <Card>
        <SectionTitle>Squad · {squadSize(roster)} players</SectionTitle>
        <div className="flex flex-col gap-3">
          {roster.slots.map((slot, i) => (
            <Row key={slot.key} label={slot.label} hint={slot.eligible.join(" · ")}>
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
      </Card>

      <Card>
        <SectionTitle>Scoring</SectionTitle>
        <div className="flex flex-col gap-3">
          {SCORING_STATS.map((stat) => (
            <Row key={stat} label={SCORING_STAT_LABELS[stat]}>
              <input
                type="number"
                inputMode="decimal"
                step={stat === "runMetres" ? 0.01 : 0.5}
                min={-50}
                max={50}
                aria-label={`${SCORING_STAT_LABELS[stat]} points`}
                className={`${inputClass} w-24 text-right font-mono`}
                value={value.scoring[stat] ?? 0}
                onChange={(e) => set("scoring", { ...value.scoring, [stat]: Number(e.target.value) })}
              />
            </Row>
          ))}
        </div>
      </Card>
    </>
  );
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
