import { useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { Button, ErrorText, Spinner } from "../components/ui.tsx";
import { authClient, signInWithGoogle } from "../lib/auth.ts";

/** Only allow redirects back into this app. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/leagues";
}

export function SignInPage() {
  const { data: session, isPending } = authClient.useSession();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (isPending) return <Spinner />;
  if (session) return <Navigate to={next} replace />;

  async function signIn() {
    setBusy(true);
    setError(null);
    const res = await signInWithGoogle(next);
    if (res.error) {
      setError(new Error(res.error.message ?? "Sign-in failed"));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-4 py-10">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">NRL Draft</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">Draft your mates. Win the round.</h1>
        <p className="mt-3 text-muted">
          Private fantasy NRL leagues: snake draft real players, set your side each week, and score from real match
          stats.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <Button onClick={signIn} disabled={busy} className="bg-white text-black hover:bg-white/90">
          <GoogleIcon />
          {busy ? "Opening Google…" : "Continue with Google"}
        </Button>
        <ErrorText error={error} />
        {params.get("next")?.startsWith("/join/") && (
          <p className="text-center text-sm text-muted">Sign in to join your mate's league.</p>
        )}
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
