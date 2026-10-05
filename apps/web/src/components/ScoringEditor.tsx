import { useState, type ReactNode } from "react";
import { STAT_CATALOGUE, STAT_GROUPS, type ScoringRules, type ScoringStat, type StatDef } from "@nrl/shared";
import { inputClass } from "./ui.tsx";

/**
 * Points for every stat in the catalogue, grouped (Scoring, Attack, ...).
 * Groups with scored stats start open. `canEdit` locks individual stats;
 * `rowExtra` adds a control to each row (the admin's per-stat permission).
 */
export function ScoringEditor({
  value,
  onChange,
  canEdit = () => true,
  rowExtra,
  lockedNote = "Set by the site",
}: {
  value: ScoringRules;
  onChange: (next: ScoringRules) => void;
  canEdit?: (stat: ScoringStat) => boolean;
  rowExtra?: (stat: ScoringStat) => ReactNode;
  lockedNote?: string;
}) {
  const scored = (s: StatDef) => (value[s.key as ScoringStat] ?? 0) !== 0;
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(STAT_GROUPS.filter((g) => STAT_CATALOGUE.some((s) => s.group === g && scored(s)))),
  );

  const set = (stat: ScoringStat, n: number) => {
    const next = { ...value };
    if (n === 0) delete next[stat];
    else next[stat] = n;
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      {STAT_GROUPS.map((group) => {
        const stats: readonly StatDef[] = STAT_CATALOGUE.filter((s) => s.group === group);
        const count = stats.filter(scored).length;
        const isOpen = open.has(group);
        return (
          <section key={group} className="rounded-xl border border-border">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() =>
                setOpen((cur) => {
                  const next = new Set(cur);
                  if (next.has(group)) next.delete(group);
                  else next.add(group);
                  return next;
                })
              }
              className="flex min-h-11 w-full items-center justify-between px-3 text-left"
            >
              <span className="text-sm font-semibold">{group}</span>
              <span className="text-xs text-muted">
                {count ? `${count} scored` : "none scored"} {isOpen ? "▴" : "▾"}
              </span>
            </button>
            {isOpen && (
              <ul className="divide-y divide-border border-t border-border">
                {stats.map((s) => {
                  const key = s.key as ScoringStat;
                  const editable = canEdit(key);
                  const v = value[key] ?? 0;
                  return (
                    <li key={key} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm ${v ? "font-medium" : "text-muted"}`}>{s.label}</div>
                        <div className="text-xs text-muted">
                          {s.unit ?? "each"}
                          {s.hint ? ` · ${s.hint}` : ""}
                          {!editable ? ` · ${lockedNote}` : ""}
                        </div>
                      </div>
                      {rowExtra?.(key)}
                      {editable ? (
                        <PointsInput label={s.label} value={v} onCommit={(n) => set(key, n)} />
                      ) : (
                        <span className="w-24 text-right font-mono text-sm text-muted" aria-label={`${s.label}: ${v} points, locked`}>
                          🔒 {v}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * A points field that lets you type freely ("-", "0.", "") and only reports
 * real numbers between -50 and 50; it snaps back to the saved value on blur.
 */
function PointsInput({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : String(value);
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={`Points for ${label}`}
      className={`${inputClass} w-24 text-right font-mono ${value ? "" : "text-muted"}`}
      value={shown}
      onFocus={() => {
        setText(String(value));
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const t = e.target.value.replace(",", ".");
        if (!/^-?\d*\.?\d*$/.test(t)) return;
        setText(t);
        const n = Number(t);
        if (t !== "" && t !== "-" && Number.isFinite(n) && n >= -50 && n <= 50) onCommit(n);
        else if (t === "") onCommit(0);
      }}
    />
  );
}

/** "Tries +8, Run metres +0.1/m, ..." for summaries. */
export function scoringSummary(rules: ScoringRules): string {
  return (STAT_CATALOGUE as readonly StatDef[]).filter((s) => rules[s.key as ScoringStat])
    .map((s) => {
      const v = rules[s.key as ScoringStat]!;
      const per = s.unit === "per metre" ? "/m" : s.unit === "per minute" ? "/min" : "";
      return `${s.label} ${v > 0 ? "+" : ""}${v}${per}`;
    })
    .join(", ");
}
