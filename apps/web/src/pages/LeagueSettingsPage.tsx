import { useState, type FormEvent } from "react";
import { useLeagueId } from "../lib/activeLeague.tsx";
import { Navigate, useNavigate } from "react-router";
import { LeagueName, LeagueSettings, type DraftOrderMode, type LeagueDetail } from "@nrl/shared";
import { DraftOrderList, DraftScheduleFields } from "../components/DraftSetup.tsx";
import { AppShell } from "../components/Layout.tsx";
import { SettingsEditor, type SettingsLimits } from "../components/SettingsEditor.tsx";
import { Button, Card, ErrorText, Field, SectionTitle, Spinner, inputClass } from "../components/ui.tsx";
import {
  useCancelHandover,
  useCreateHandover,
  useLeague,
  useLeagueDefaults,
  useMakeCommissioner,
  useRandomiseDraftOrder,
  useResetInvite,
  useSetDraftOrder,
  useUpdateLeague,
} from "../lib/queries.ts";

export function LeagueSettingsPage() {
  const id = useLeagueId();
  const { data: league, isPending, error } = useLeague(id);
  const defaults = useLeagueDefaults();
  if (isPending || defaults.isPending) return <AppShell back={`/league`}><Spinner /></AppShell>;
  if (!league || !defaults.data) return <AppShell back={`/league`}><ErrorText error={error ?? defaults.error} /></AppShell>;
  if (!league.isCommissioner) return <Navigate to={`/league`} replace />;
  return <SettingsForm league={league} limits={defaults.data} />;
}

function SettingsForm({ league, limits }: { league: LeagueDetail; limits: SettingsLimits }) {
  const navigate = useNavigate();
  const update = useUpdateLeague(league.id);
  const resetInvite = useResetInvite(league.id);
  const [name, setName] = useState(league.name);
  const [settings, setSettings] = useState<LeagueSettings>(league.settings);
  const [draftAt, setDraftAt] = useState<string | null>(league.draftAt);
  const [orderMode, setOrderMode] = useState<DraftOrderMode>(league.draftOrderMode);
  const setOrder = useSetDraftOrder(league.id);
  const randomise = useRandomiseDraftOrder(league.id);
  const [formError, setFormError] = useState<string | null>(null);
  const locked = league.status !== "setup";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const nameCheck = LeagueName.safeParse(name);
    if (!nameCheck.success) return setFormError(`League name: ${nameCheck.error.issues[0]?.message}`);
    const settingsCheck = LeagueSettings.safeParse(settings);
    if (!settingsCheck.success) return setFormError(settingsCheck.error.issues[0]?.message ?? "Check the settings");
    setFormError(null);
    await update.mutateAsync({
      name: nameCheck.data,
      ...(locked
        ? {}
        : {
            settings: settingsCheck.data,
            ...(draftAt !== league.draftAt ? { draftAt } : {}),
            ...(orderMode !== league.draftOrderMode ? { draftOrderMode: orderMode } : {}),
          }),
    });
    navigate(`/league`);
  }

  return (
    <AppShell title="League settings" back={`/league`} width="wide">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
          <Card>
            <Field label="League name">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
            </Field>
          </Card>

          {locked ? (
            <Card>
              <p className="text-sm text-muted">Rules are locked once the draft has started.</p>
            </Card>
          ) : (
            <Card className="flex flex-col gap-4">
              <SectionTitle>Draft</SectionTitle>
              <DraftScheduleFields
                draftAt={draftAt}
                onDraftAt={setDraftAt}
                mode={orderMode}
                onMode={setOrderMode}
                orderLocked={league.draftOrderLocked}
              />
              {/* Arranging applies straight away; the mode switch above saves with the form. */}
              {league.draftOrderMode === "manual" && orderMode === "manual" && (
                <DraftOrderList
                  league={league}
                  editable
                  onChange={(ids) => setOrder.mutate(ids)}
                  onRandomise={() => randomise.mutate()}
                  busy={setOrder.isPending || randomise.isPending}
                  error={setOrder.error ?? randomise.error}
                />
              )}
              {league.draftOrderLocked && <DraftOrderList league={league} />}
              {orderMode === "manual" && league.draftOrderMode !== "manual" && (
                <p className="text-sm text-muted">Save to start arranging the order.</p>
              )}
            </Card>
          )}
        </div>
        {!locked && <SettingsEditor value={settings} onChange={setSettings} minTeams={league.teamsJoined} limits={limits} />}

        <ErrorText error={formError ?? update.error} />
        <Button type="submit" disabled={update.isPending} className="sticky bottom-4 shadow-lg lg:w-64 lg:self-end">
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </form>

      <Managers league={league} />

      {!locked && (
        <Card className="lg:w-1/2">
          <SectionTitle>Invite link</SectionTitle>
          <p className="mb-3 text-sm text-muted">Reset the link if it's been shared too widely. The old link stops working.</p>
          <Button variant="secondary" onClick={() => resetInvite.mutate()} disabled={resetInvite.isPending}>
            {resetInvite.isSuccess ? "Link reset" : "Reset invite link"}
          </Button>
          <ErrorText error={resetInvite.error} />
        </Card>
      )}
    </AppShell>
  );
}

/**
 * Replacing a manager who's dropped out: a link that hands their team to
 * whoever opens it. And passing the commissioner role on.
 */
function Managers({ league }: { league: LeagueDetail }) {
  const navigate = useNavigate();
  const create = useCreateHandover(league.id);
  const cancel = useCancelHandover(league.id);
  const promote = useMakeCommissioner(league.id);
  const [copied, setCopied] = useState<string | null>(null);
  const busy = create.isPending || cancel.isPending || promote.isPending;
  const link = (code: string) => `${window.location.origin}/handover/${code}`;

  return (
    <Card className="lg:w-1/2">
      <SectionTitle>Managers</SectionTitle>
      <p className="mb-3 text-sm text-muted">
        If someone drops out, make a handover link for their team: whoever opens it takes the team over, squad and all,
        and the old manager leaves the league.
      </p>
      <ul className="flex flex-col divide-y divide-border">
        {league.teams.map((t) => (
          <li key={t.id} className="flex flex-col gap-2 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{t.name}</div>
                <div className="truncate text-xs text-muted">
                  {t.owner.name}
                  {t.isCommissioner ? " · Commissioner" : ""}
                </div>
              </div>
              {!t.isCommissioner && (
                <div className="flex shrink-0 gap-2">
                  {!t.handoverCode && (
                    <Button variant="secondary" className="min-h-9" disabled={busy} onClick={() => create.mutate(t.id)}>
                      Hand over
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="min-h-9"
                    disabled={busy}
                    onClick={() => {
                      if (!confirm(`Make ${t.owner.name} the commissioner? You'll lose commissioner tools.`)) return;
                      promote.mutate(t.id, { onSuccess: () => navigate(`/league`) });
                    }}
                  >
                    Make commissioner
                  </Button>
                </div>
              )}
            </div>
            {t.handoverCode && (
              <div className="flex flex-wrap items-center gap-2">
                <code className="flex min-h-9 min-w-0 flex-1 items-center truncate rounded-lg bg-surface-2 px-2 text-xs">{link(t.handoverCode)}</code>
                <Button
                  className="min-h-9"
                  onClick={async () => {
                    await navigator.clipboard.writeText(link(t.handoverCode!));
                    setCopied(t.id);
                    setTimeout(() => setCopied(null), 2000);
                  }}
                >
                  {copied === t.id ? "Copied!" : "Copy link"}
                </Button>
                <Button variant="ghost" className="min-h-9" disabled={busy} onClick={() => cancel.mutate(t.id)}>
                  Cancel link
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ErrorText error={create.error ?? cancel.error ?? promote.error} />
    </Card>
  );
}
