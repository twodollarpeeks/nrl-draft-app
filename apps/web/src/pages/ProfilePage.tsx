import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { AppShell } from "../components/Layout.tsx";
import { Avatar, Button, Card, ErrorText, Field, inputClass } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { authClient } from "../lib/auth.ts";
import { useMe } from "../lib/queries.ts";

export function ProfilePage() {
  const { data: session, refetch } = authClient.useSession();
  const { data: me } = useMe();
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
      {me?.isAdmin && (
        <Card>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Site admin</div>
          <div className="flex flex-col gap-2">
            <Link to="/admin/scoring" className="font-medium text-accent">
              Scoring & permissions →
            </Link>
            <Link to="/admin/players" className="font-medium text-accent">
              Player positions →
            </Link>
          </div>
        </Card>
      )}
      <Button variant="secondary" onClick={signOut}>
        Sign out
      </Button>
    </AppShell>
  );
}
