import { createAuthClient } from "better-auth/react";

// The API is served from the same origin (proxied in dev), so cookies are
// first-party.
export const authClient = createAuthClient({ baseURL: window.location.origin });

export function signInWithGoogle(next = "/leagues") {
  return authClient.signIn.social({ provider: "google", callbackURL: next });
}
