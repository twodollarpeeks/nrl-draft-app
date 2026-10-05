import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { LeagueName, LeagueSettings, type DraftOrderMode, type LeagueDefaults } from "@nrl/shared";
import { DraftScheduleFields } from "../components/DraftSetup.tsx";
import { AppShell } from "../components/Layout.tsx";
import { SettingsEditor } from "../components/SettingsEditor.tsx";
import { Button, Card, ErrorText, Field, SectionTitle, Spinner, inputClass } from "../components/ui.tsx";
import { useCreateLeague, useLeagueDefaults } from "../lib/queries.ts";

// Leagues play the upcoming season; the one just finished is available for
// trying things out against real stats.
const THIS_YEAR = new Date().getFullYear();
const SEASONS = [THIS_YEAR + 1, THIS_YEAR];

export function CreateLeaguePage() {
  const defaults = useLeagueDefaults();
  if (!defaults.data) {
    return (
      <AppShell title="New league" back="/leagues">
        {defaults.isPending ? <Spinner /> : <ErrorText error={defaults.error} />}
      </AppShell>
    );
  }
  return <CreateLeagueForm defaults={defaults.data} />;
}

function CreateLeagueForm({ defaults }: { defaults: LeagueDefaults }) {
  const navigate = useNavigate();
  const create = useCreateLeague();
  const [name, setName] = useState("");
  const [season, setSeason] = useState(SEASONS[0]!);
  const [teamName, setTeamName] = useState("");
  const [settings, setSettings] = useState<LeagueSettings>(defaults.settings);
  const [draftAt, setDraftAt] = useState<string | null>(null);
  const [orderMode, setOrderMode] = useState<DraftOrderMode>("randomWhenFull");
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const nameCheck = LeagueName.safeParse(name);
    if (!nameCheck.success) return setFormError(`League name: ${nameCheck.error.issues[0]?.message}`);
    const settingsCheck = LeagueSettings.safeParse(settings);
    if (!settingsCheck.success) return setFormError(settingsCheck.error.issues[0]?.message ?? "Check the settings");
    setFormError(null);
    const league = await create.mutateAsync({
      name: nameCheck.data,
      season,
      settings: settingsCheck.data,
      draftAt,
      draftOrderMode: orderMode,
      ...(teamName.trim() ? { teamName: teamName.trim() } : {}),
    });
    navigate(`/l/${league.id}`);
  }

  return (
    <AppShell title="New league" back="/leagues">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Card className="flex flex-col gap-4">
          <Field label="League name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="The Boys" maxLength={40} required />
          </Field>
          <Field label="Your team name" hint="Optional, you can change it later">
            <input className={inputClass} value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Leave blank for “Your name's Team”" maxLength={30} />
          </Field>
          <Field label="Season">
            <select className={inputClass} value={season} onChange={(e) => setSeason(Number(e.target.value))}>
              {SEASONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                  {s === THIS_YEAR ? " (replay with real stats)" : ""}
                </option>
              ))}
            </select>
          </Field>
        </Card>

        <Card>
          <SectionTitle>Draft</SectionTitle>
          <DraftScheduleFields draftAt={draftAt} onDraftAt={setDraftAt} mode={orderMode} onMode={setOrderMode} />
        </Card>

        <SettingsEditor value={settings} onChange={setSettings} limits={defaults} />

        <ErrorText error={formError ?? create.error} />
        <Button type="submit" disabled={create.isPending} className="sticky bottom-4 shadow-lg">
          {create.isPending ? "Creating…" : "Create league"}
        </Button>
      </form>
    </AppShell>
  );
}
