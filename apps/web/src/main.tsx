import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import "./index.css";
import { RequireAuth } from "./components/Layout.tsx";
import { ApiRequestError } from "./lib/api.ts";
import { CreateLeaguePage } from "./pages/CreateLeaguePage.tsx";
import { JoinPage } from "./pages/JoinPage.tsx";
import { LeaguePage } from "./pages/LeaguePage.tsx";
import { LeagueSettingsPage } from "./pages/LeagueSettingsPage.tsx";
import { LeaguesPage } from "./pages/LeaguesPage.tsx";
import { ProfilePage } from "./pages/ProfilePage.tsx";
import { SignInPage } from "./pages/SignInPage.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't retry "not found" / "not allowed" answers.
      retry: (count, err) => !(err instanceof ApiRequestError && err.status < 500) && count < 2,
    },
  },
});

const authed = (page: ReactNode) => <RequireAuth>{page}</RequireAuth>;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SignInPage />} />
          <Route path="/leagues" element={authed(<LeaguesPage />)} />
          <Route path="/leagues/new" element={authed(<CreateLeaguePage />)} />
          <Route path="/join/:code" element={authed(<JoinPage />)} />
          <Route path="/l/:id" element={authed(<LeaguePage />)} />
          <Route path="/l/:id/settings" element={authed(<LeagueSettingsPage />)} />
          <Route path="/profile" element={authed(<ProfilePage />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
