import { createContext, useContext, useEffect, type ReactNode } from "react";
import { Navigate, useLocation, useParams } from "react-router";
import { slugify, type LeagueDetail } from "@nrl/shared";
import { Spinner } from "../components/ui.tsx";
import { AppShell } from "../components/Layout.tsx";
import { useMyLeagues } from "./queries.ts";

// Short addresses (/myteam, /players, /matchups...) are for the league you
// opened last, remembered on this device. Opening /l/<id>/... switches league
// and lands on the short address.

const KEY = "nrl.activeLeague";

export function rememberedLeague(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberLeague(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Private browsing: the league just isn't remembered.
  }
}

const LeagueIdContext = createContext<string>("");

/** The league this page is about. */
export function useLeagueId(): string {
  const fromContext = useContext(LeagueIdContext);
  const { id } = useParams();
  return fromContext || id || "";
}

/** For short addresses: provides the remembered league (or your newest), else sends you to your leagues. */
export function ActiveLeague({ children }: { children: ReactNode }) {
  const leagues = useMyLeagues();
  if (!leagues.data) {
    return <AppShell title="">{leagues.error ? <Navigate to="/leagues" replace /> : <Spinner />}</AppShell>;
  }
  const remembered = rememberedLeague();
  const pick =
    leagues.data.find((l) => l.id === remembered) ??
    leagues.data.find((l) => l.status === "inSeason") ??
    leagues.data.find((l) => l.status !== "complete") ??
    leagues.data[0];
  if (!pick) return <Navigate to="/leagues" replace />;
  return (
    <LeagueIdContext.Provider value={pick.id}>
      <Remember id={pick.id} />
      {children}
    </LeagueIdContext.Provider>
  );
}

function Remember({ id }: { id: string }) {
  useEffect(() => rememberLeague(id), [id]);
  return null;
}

/** /l/<id>/rest -> remember the league, then /rest (/l/<id> itself -> /league). */
export function SwitchLeague() {
  const { id = "", "*": rest = "" } = useParams();
  const { search } = useLocation();
  rememberLeague(id);
  return <Navigate to={`/${rest || "league"}${search}`} replace />;
}

/** A team's address name: "prasads-team". */
export const teamSlug = (name: string) => slugify(name) || "team";

/** A team by id or address name. */
export function findTeam(league: LeagueDetail, param: string | undefined) {
  if (!param) return undefined;
  return league.teams.find((t) => t.id === param) ?? league.teams.find((t) => teamSlug(t.name) === param);
}

/** Where a team's page is: /myteam for yours, else /team/<name>. */
export function teamPath(league: LeagueDetail, teamId: string, round?: number) {
  const r = round !== undefined ? `/${round}` : "";
  if (teamId === league.myTeamId) return `/myteam${r}`;
  const team = league.teams.find((t) => t.id === teamId);
  return `/team/${team ? teamSlug(team.name) : teamId}${r}`;
}

/** A head-to-head's address, with team names. */
export function matchupPath(league: LeagueDetail, round: number, homeId: string, awayId: string) {
  const slug = (id: string) => {
    const t = league.teams.find((x) => x.id === id);
    return t ? teamSlug(t.name) : id;
  };
  return `/matchup/${round}/${slug(homeId)}/${slug(awayId)}`;
}

/** A player's page: /players/bulldogs/galvin-lachlan. */
export const playerPath = (p: { slug: string; club: { key: string } | null }) => `/players/${p.club?.key ?? "no-club"}/${p.slug}`;
