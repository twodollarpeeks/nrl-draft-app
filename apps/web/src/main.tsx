import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import "./index.css";
import { RequireAuth } from "./components/Layout.tsx";
import { ActiveLeague, SwitchLeague } from "./lib/activeLeague.tsx";
import { ApiRequestError } from "./lib/api.ts";
import { AdminPlayersPage } from "./pages/AdminPlayersPage.tsx";
import { AdminScoringPage } from "./pages/AdminScoringPage.tsx";
import { CreateLeaguePage } from "./pages/CreateLeaguePage.tsx";
import { DraftRoomPage } from "./pages/DraftRoomPage.tsx";
import { LadderPage } from "./pages/LadderPage.tsx";
import { MatchupPage } from "./pages/MatchupPage.tsx";
import { MatchupsPage } from "./pages/MatchupsPage.tsx";
import { MockDraftsPage } from "./pages/MockDraftsPage.tsx";
import { MockResultPage } from "./pages/MockResultPage.tsx";
import { MockRoomPage } from "./pages/MockRoomPage.tsx";
import { TeamRoundPage } from "./pages/TeamRoundPage.tsx";
import { HandoverPage } from "./pages/HandoverPage.tsx";
import { JoinPage } from "./pages/JoinPage.tsx";
import { LeaguePage } from "./pages/LeaguePage.tsx";
import { LeagueSettingsPage } from "./pages/LeagueSettingsPage.tsx";
import { LeaguesPage } from "./pages/LeaguesPage.tsx";
import { PlayerPage } from "./pages/PlayerPage.tsx";
import { PlayersPage } from "./pages/PlayersPage.tsx";
import { ProfilePage } from "./pages/ProfilePage.tsx";
import { ProposeTradePage, TradesPage } from "./pages/TradesPage.tsx";
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
const inLeague = (page: ReactNode) => authed(<ActiveLeague>{page}</ActiveLeague>);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SignInPage />} />
          <Route path="/leagues" element={authed(<LeaguesPage />)} />
          <Route path="/leagues/new" element={authed(<CreateLeaguePage />)} />
          <Route path="/join/:code" element={authed(<JoinPage />)} />
          <Route path="/handover/:code" element={authed(<HandoverPage />)} />
          {/* A league's pages, for the league you opened last (/l/<id>/... switches league). */}
          <Route path="/l/:id/*" element={<SwitchLeague />} />
          <Route path="/league" element={inLeague(<LeaguePage />)} />
          <Route path="/draft" element={inLeague(<DraftRoomPage />)} />
          <Route path="/myteam/:round?" element={inLeague(<TeamRoundPage />)} />
          <Route path="/team/:teamId/:round?" element={inLeague(<TeamRoundPage />)} />
          <Route path="/matchups/:round?" element={inLeague(<MatchupsPage />)} />
          <Route path="/matchup/:round/:homeId/:awayId" element={inLeague(<MatchupPage />)} />
          <Route path="/ladder" element={inLeague(<LadderPage />)} />
          <Route path="/players" element={inLeague(<PlayersPage />)} />
          <Route path="/players/:club/:slug" element={inLeague(<PlayerPage />)} />
          <Route path="/trades" element={inLeague(<TradesPage />)} />
          <Route path="/trades/new" element={inLeague(<ProposeTradePage />)} />
          <Route path="/settings" element={inLeague(<LeagueSettingsPage />)} />
          <Route path="/mock" element={authed(<MockDraftsPage />)} />
          <Route path="/mock/play" element={authed(<MockRoomPage />)} />
          <Route path="/mock/:id" element={authed(<MockResultPage />)} />
          <Route path="/profile" element={authed(<ProfilePage />)} />
          <Route path="/admin/players" element={authed(<AdminPlayersPage />)} />
          <Route path="/admin/scoring" element={authed(<AdminScoringPage />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
