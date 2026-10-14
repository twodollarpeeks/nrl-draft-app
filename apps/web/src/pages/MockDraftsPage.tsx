import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { MAX_TEAMS, MIN_TEAMS } from "@nrl/shared";
import { AppShell } from "../components/Layout.tsx";
import { Button, Card, ErrorText, Field, SectionTitle, Spinner, inputClass } from "../components/ui.tsx";
import { CPU_SPEEDS, useDeleteMock, useMockHistory, useMockPool } from "../lib/mock.ts";

const CLOCKS: Array<[number, string]> = [
  [0, "No clock"],
  [30, "30 seconds"],
  [60, "60 seconds"],
  [90, "90 seconds"],
];

/** Solo practice drafts against CPU teams: set one up, or look back at past ones. */
export function MockDraftsPage() {
  const navigate = useNavigate();
  const pool = useMockPool();
  const [teams, setTeams] = useState(8);
  const [slot, setSlot] = useState<number | "random">("random");
  const [clock, setClock] = useState(0);
  const [speed, setSpeed] = useState<keyof typeof CPU_SPEEDS>("normal");

  function start(e: FormEvent) {
    e.preventDefault();
    const pick = slot === "random" ? 1 + Math.floor(Math.random() * teams) : Math.min(slot, teams);
    navigate(`/mock/play?teams=${teams}&slot=${pick}&clock=${clock}&speed=${speed}`);
  }

  const noData = pool.data && pool.data.players.length === 0;
  return (
    <AppShell title="Mock drafts" back="/leagues" width="wide">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <form onSubmit={start} className="flex flex-col gap-4">
          <Card className="flex flex-col gap-4">
            <div>
              <SectionTitle>New mock draft</SectionTitle>
              <p className="text-sm text-muted">
                Practise against CPU teams. Nothing here touches your leagues.
                {pool.data?.season ? ` Players are ranked on ${pool.data.season} stats under the site's default scoring.` : ""}
              </p>
            </div>
            <Field label="Teams">
              <select className={inputClass} value={teams} onChange={(e) => setTeams(Number(e.target.value))}>
                {Array.from({ length: MAX_TEAMS - MIN_TEAMS + 1 }, (_, i) => MIN_TEAMS + i).map((n) => (
                  <option key={n} value={n}>
                    {n} teams
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Your draft position">
              <select
                className={inputClass}
                value={slot}
                onChange={(e) => setSlot(e.target.value === "random" ? "random" : Number(e.target.value))}
              >
                <option value="random">Random</option>
                {Array.from({ length: teams }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    Pick {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Your pick clock" hint="When it runs out, your queue then the best available player is picked for you">
              <select className={inputClass} value={clock} onChange={(e) => setClock(Number(e.target.value))}>
                {CLOCKS.map(([s, label]) => (
                  <option key={s} value={s}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="CPU speed">
              <select className={inputClass} value={speed} onChange={(e) => setSpeed(e.target.value as keyof typeof CPU_SPEEDS)}>
                <option value="normal">Normal (a couple of seconds a pick)</option>
                <option value="fast">Fast</option>
              </select>
            </Field>
          </Card>
          <ErrorText error={pool.error} />
          {noData && <p className="text-sm text-muted">There's no player data to draft from yet.</p>}
          <Button type="submit" disabled={!pool.data || noData}>
            {pool.isPending ? "Loading players…" : "Start mock draft"}
          </Button>
        </form>

        <History />
      </div>
    </AppShell>
  );
}

function History() {
  const history = useMockHistory();
  const remove = useDeleteMock();
  return (
    <Card>
      <SectionTitle>Your mock drafts</SectionTitle>
      {history.isPending && <Spinner />}
      <ErrorText error={history.error ?? remove.error} />
      {history.data?.length === 0 && <p className="text-sm text-muted">Finished mocks show up here.</p>}
      <ul className="flex flex-col divide-y divide-border">
        {history.data?.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-3">
            <Link to={`/mock/${m.id}`} className="min-w-0 flex-1 hover:text-accent">
              <div className="text-sm font-medium">
                {formatDate(m.createdAt)} · {m.teamCount} teams · pick {m.slot}
              </div>
              <div className="truncate text-xs text-muted">{m.firstPicks.join(", ") || "No picks"}</div>
            </Link>
            <button
              className="size-9 shrink-0 rounded-lg text-muted hover:text-danger"
              aria-label={`Delete the mock from ${formatDate(m.createdAt)}`}
              disabled={remove.isPending}
              onClick={() => {
                if (confirm("Delete this mock draft?")) remove.mutate(m.id);
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
