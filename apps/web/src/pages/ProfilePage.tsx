import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { AppShell } from "../components/Layout.tsx";
import { Avatar, Button, Card, ErrorText, Field, inputClass } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { authClient } from "../lib/auth.ts";

export function ProfilePage() {
  const { data: session, refetch } = authClient.useSession();
  const navigate = useNavigate();
  const [name, setName] = useState(session?.user.name ?? "");
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  if (!session) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/api/me", { method: "PATCH", body: { name } });
      await refetch();
      setSaved(true);
    } catch (err) {
      setError(err);
    }
  }

  async function signOut() {
    await authClient.signOut();
    navigate("/");
  }

  return (
    <AppShell title="Profile" back="/leagues">
      <Card className="flex items-center gap-4">
        <Avatar name={session.user.name} image={session.user.image ?? null} size={56} />
        <div className="min-w-0">
          <div className="truncate font-semibold">{session.user.name}</div>
          <div className="truncate text-sm text-muted">{session.user.email}</div>
        </div>
      </Card>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Card>
          <Field label="Display name" hint="Shown to other managers in your leagues">
            <input className={inputClass} value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} maxLength={40} required />
          </Field>
        </Card>
        <ErrorText error={error} />
        <Button type="submit">{saved ? "Saved" : "Save"}</Button>
      </form>
      <Button variant="secondary" onClick={signOut}>
        Sign out
      </Button>
    </AppShell>
  );
}
