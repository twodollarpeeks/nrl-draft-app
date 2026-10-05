import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { LeagueName, LeagueSettings, type LeagueDetail } from "@nrl/shared";
import { AppShell } from "../components/Layout.tsx";
import { SettingsEditor, type SettingsLimits } from "../components/SettingsEditor.tsx";
import { Button, Card, ErrorText, Field, SectionTitle, Spinner, inputClass } from "../components/ui.tsx";
import { useLeague, useLeagueDefaults, useResetInvite, useUpdateLeague } from "../lib/queries.ts";

export function LeagueSettingsPage() {
  const { id = "" } = useParams();
  const { data: league, isPending, error } = useLeague(id);
  const defaults = useLeagueDefaults();
  if (isPending || defaults.isPending) return <AppShell back={`/l/${id}`}><Spinner /></AppShell>;
  if (!league || !defaults.data) return <AppShell back={`/l/${id}`}><ErrorText error={error ?? defaults.error} /></AppShell>;
  if (!league.isCommissioner) return <Navigate to={`/l/${id}`} replace />;
  return <SettingsForm league={league} limits={defaults.data} />;
}

function SettingsForm({ league, limits }: { league: LeagueDetail; limits: SettingsLimits }) {
  const navigate = useNavigate();
  const update = useUpdateLeague(league.id);
  const resetInvite = useResetInvite(league.id);
  const [name, setName] = useState(league.name);
  const [settings, setSettings] = useState<LeagueSettings>(league.settings);
  const [formError, setFormError] = useState<string | null>(null);
  const locked = league.status !== "setup";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const nameCheck = LeagueName.safeParse(name);
    if (!nameCheck.success) return setFormError(`League name: ${nameCheck.error.issues[0]?.message}`);
    const settingsCheck = LeagueSettings.safeParse(settings);
    if (!settingsCheck.success) return setFormError(settingsCheck.error.issues[0]?.message ?? "Check the settings");
    setFormError(null);
    await update.mutateAsync({ name: nameCheck.data, ...(locked ? {} : { settings: settingsCheck.data }) });
    navigate(`/l/${league.id}`);
  }

  return (
    <AppShell title="League settings" back={`/l/${league.id}`}>
      <form onSubmit={submit} className="flex flex-col gap-4">
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
          <SettingsEditor value={settings} onChange={setSettings} minTeams={league.teamsJoined} limits={limits} />
        )}

        <ErrorText error={formError ?? update.error} />
        <Button type="submit" disabled={update.isPending} className="sticky bottom-4 shadow-lg">
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </form>

      {!locked && (
        <Card>
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
