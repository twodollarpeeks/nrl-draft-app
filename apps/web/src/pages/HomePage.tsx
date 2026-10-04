import {
  DEFAULT_LEAGUE_SETTINGS,
  SCORING_STAT_LABELS,
  SCORING_STATS,
} from "@nrl/shared";

const { roster, scoring } = DEFAULT_LEAGUE_SETTINGS;

export function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">NRL Draft</h1>
        <p className="text-muted">Draft your mates. Win the round.</p>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Default squad
        </h2>
        <ul className="flex flex-wrap gap-2">
          {roster.slots.map((slot) => (
            <li key={slot.key} className="rounded-full bg-surface-2 px-3 py-1 text-sm">
              {slot.count}× {slot.label}
            </li>
          ))}
          <li className="rounded-full bg-surface-2 px-3 py-1 text-sm text-muted">
            {roster.benchSize}× Bench
          </li>
        </ul>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Default scoring
        </h2>
        <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
          {SCORING_STATS.map((stat) => (
            <div key={stat} className="contents">
              <dt>{SCORING_STAT_LABELS[stat]}</dt>
              <dd
                className={`text-right font-mono ${scoring[stat]! < 0 ? "text-danger" : "text-accent"}`}
              >
                {scoring[stat]! > 0 ? "+" : ""}
                {scoring[stat]}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
