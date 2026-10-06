import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useState } from "react";
import { Navigate } from "react-router";
import {
  DEFAULT_SCORING,
  SCORING_STATS,
  type CommissionerPermissions,
  type ScoringPreview,
  type ScoringRules,
  type SiteConfig,
} from "@nrl/shared";
import { AppShell } from "../components/Layout.tsx";
import { ScoringEditor } from "../components/ScoringEditor.tsx";
import { Button, Card, ErrorText, SectionTitle, Spinner } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { useMe } from "../lib/queries.ts";

const PERMISSIONS: Array<[keyof CommissionerPermissions, string, string]> = [
  ["scoring", "Scoring", "Change points for the stats you allow below"],
  ["roster", "Squad structure", "Slot counts and bench size"],
  ["draftTimer", "Pick timer", "Seconds per pick"],
  ["format", "Format", "Head-to-head, finals or total points"],
];

export function AdminScoringPage() {
  const { data: me, isPending } = useMe();
  const config = useQuery({
    queryKey: ["admin", "site-config"],
    queryFn: () => api<SiteConfig>("/api/admin/site-config"),
    enabled: !!me?.isAdmin,
  });

  if (isPending || (me?.isAdmin && config.isPending)) {
    return <AppShell title="Scoring & permissions" back="/profile"><Spinner /></AppShell>;
  }
  if (!me?.isAdmin) return <Navigate to="/leagues" replace />;
  if (!config.data) return <AppShell title="Scoring & permissions" back="/profile"><ErrorText error={config.error} /></AppShell>;
  return <Editor saved={config.data} />;
}

function Editor({ saved }: { saved: SiteConfig }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<SiteConfig>(saved);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const save = useMutation({
    mutationFn: (c: SiteConfig) => api<SiteConfig>("/api/admin/site-config", { method: "PUT", body: c }),
    onSuccess: (c) => {
      qc.setQueryData(["admin", "site-config"], c);
      void qc.invalidateQueries({ queryKey: ["league-defaults"] });
    },
  });

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const allowed = new Set(draft.commissionerStats);
  const setPermission = (key: keyof CommissionerPermissions, on: boolean) =>
    setDraft({ ...draft, commissionerCan: { ...draft.commissionerCan, [key]: on } });

  return (
    <AppShell title="Scoring & permissions" back="/profile" width="wide">
      <p className="text-sm text-muted">
        New leagues start with this scoring. Existing leagues keep theirs. Commissioners can change only what you allow
        here; the server enforces it. As a site admin, these limits don't apply to your own leagues.
      </p>

      {/* Desktop: the scoring editor on the left; permissions and the live preview alongside. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start lg:gap-6">
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <SectionTitle>Default scoring</SectionTitle>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="min-h-9"
                onClick={() => setDraft({ ...draft, defaultScoring: { ...DEFAULT_SCORING } })}
              >
                Use recommended
              </Button>
            </div>
          </div>
          {draft.commissionerCan.scoring && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>“Commish” = commissioners may change that stat ({allowed.size} of {SCORING_STATS.length}).</span>
              <button className="underline" onClick={() => setDraft({ ...draft, commissionerStats: [...SCORING_STATS] })}>
                Allow all
              </button>
              <button className="underline" onClick={() => setDraft({ ...draft, commissionerStats: [] })}>
                Lock all
              </button>
            </div>
          )}
          <ScoringEditor
            value={draft.defaultScoring}
            onChange={(defaultScoring) => setDraft({ ...draft, defaultScoring })}
            rowExtra={(stat) =>
              draft.commissionerCan.scoring ? (
                <label className="flex items-center gap-1 text-xs text-muted" title="Commissioners may change this stat">
                  <input
                    type="checkbox"
                    className="size-4 accent-(--color-accent)"
                    checked={allowed.has(stat)}
                    onChange={(e) => {
                      const next = new Set(allowed);
                      if (e.target.checked) next.add(stat);
                      else next.delete(stat);
                      setDraft({ ...draft, commissionerStats: SCORING_STATS.filter((s) => next.has(s)) });
                    }}
                  />
                  Commish
                </label>
              ) : null
            }
          />
        </Card>
        {/* Phones keep the order permissions, scoring, preview. */}
        <div className="contents lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100dvh-6rem)] lg:flex-col lg:gap-4 lg:overflow-y-auto">
          <Card className="order-first lg:order-none">
            <SectionTitle>What commissioners can change</SectionTitle>
            <ul className="flex flex-col divide-y divide-border">
              {PERMISSIONS.map(([key, label, hint]) => (
                <li key={key} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-xs text-muted">{hint}</div>
                  </div>
                  <Switch label={label} checked={draft.commissionerCan[key]} onChange={(on) => setPermission(key, on)} />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">League size is always the commissioner's call.</p>
          </Card>
          <Preview scoring={draft.defaultScoring} />
        </div>
      </div>

      <ErrorText error={save.error} />
      {dirty ? (
        <div className="sticky bottom-4 flex gap-2 lg:w-96 lg:self-end">
          <Button className="flex-1 shadow-lg" disabled={save.isPending} onClick={() => save.mutate(draft)}>
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="secondary" className="shadow-lg" onClick={() => setDraft(saved)}>
            Discard
          </Button>
        </div>
      ) : (
        save.isSuccess && <p className="text-center text-sm text-accent" role="status">Saved</p>
      )}
    </AppShell>
  );
}

/** Position balance and top players under a scoring, recalculated as you edit. */
function Preview({ scoring }: { scoring: ScoringRules }) {
  const deferred = useDeferredValue(scoring);
  const [debounced, setDebounced] = useState(deferred);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(deferred), 500);
    return () => clearTimeout(t);
  }, [deferred]);

  const preview = useQuery({
    queryKey: ["admin", "scoring-preview", debounced],
    queryFn: () => api<ScoringPreview | null>("/api/admin/scoring/preview", { method: "POST", body: { scoring: debounced } }),
    placeholderData: (prev) => prev,
  });
  const p = preview.data;

  return (
    <Card>
      <SectionTitle>Preview{p ? ` · ${p.season} season` : ""}</SectionTitle>
      {preview.isPending && <Spinner label="Calculating" />}
      <ErrorText error={preview.error} />
      {p === null && <p className="text-sm text-muted">No match data loaded yet.</p>}
      {p && (
        <div className={`flex flex-col gap-4 ${preview.isFetching ? "opacity-60" : ""}`}>
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">Position balance</span>
              <span className={`font-mono text-sm ${balanceTone(p.spread)}`}>{balanceLabel(p.spread)}</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Average points of the last starter an 8-team league fields at each position. Closer together means no
              position is an automatic early pick.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-1 font-medium">Group</th>
                <th className="pb-1 text-right font-medium">Starter avg</th>
                <th className="pb-1 pl-3 font-medium">Best</th>
              </tr>
            </thead>
            <tbody>
              {p.groups.map((g) => (
                <tr key={g.group} className="border-t border-border">
                  <td className="py-2">
                    {g.label}
                    <span className="block text-xs text-muted">{ordinal(g.starters)} best</span>
                  </td>
                  <td className="py-2 text-right font-mono">{g.starterLevel.toFixed(1)}</td>
                  <td className="py-2 pl-3 text-xs">
                    {g.best ? (
                      <>
                        {g.best.name} <span className="font-mono text-muted">{g.best.avgPoints.toFixed(1)}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <div className="text-sm font-medium">Top 20 players</div>
            <p className="mb-2 text-xs text-muted">Draft ranking: average points, discounted for few games played.</p>
            <ol className="flex flex-col divide-y divide-border text-sm">
              {p.top.map((t) => (
                <li key={t.rank} className="flex items-center gap-3 py-1.5">
                  <span className="w-6 text-right font-mono text-xs text-muted">{t.rank}</span>
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  <span className="text-xs text-muted">{t.positions.join("/")}</span>
                  <span className="w-12 text-right font-mono">{t.avgPoints.toFixed(1)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Card>
  );
}

function balanceLabel(spread: number) {
  if (!Number.isFinite(spread)) return "Can't tell: a group scores 0";
  const pct = Math.round((spread - 1) * 100);
  return `${pct}% apart · ${spread <= 1.1 ? "even" : spread <= 1.3 ? "a bit uneven" : "uneven"}`;
}
function balanceTone(spread: number) {
  return spread <= 1.1 ? "text-accent" : spread <= 1.3 ? "text-text" : "text-danger";
}
function ordinal(n: number) {
  return `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? "bg-accent" : "bg-surface-2"}`}
    >
      <span className={`absolute top-1 size-5 rounded-full bg-white transition-all ${checked ? "left-6" : "left-1"}`} />
    </button>
  );
}
