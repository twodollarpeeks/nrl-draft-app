import { z } from "zod";
import { LeagueSettings } from "./leagueSettings.ts";
import { NrlPosition } from "./positions.ts";
import type { Lineup } from "./lineup.ts";

// Request bodies shared by the API (validation) and the web app (forms).

export const LeagueName = z.string().trim().min(2, "At least 2 characters").max(40, "At most 40 characters");
export const TeamName = z.string().trim().min(2, "At least 2 characters").max(30, "At most 30 characters");

export const DraftOrderMode = z.enum(["randomWhenFull", "manual"]);
export type DraftOrderMode = z.infer<typeof DraftOrderMode>;

/** When the draft starts by itself: an ISO date-time, or null for "the commissioner starts it". */
export const DraftAt = z.iso.datetime({ offset: true }).nullable();

export const CreateLeagueInput = z.object({
  name: LeagueName,
  season: z.number().int().min(2020).max(2100),
  teamName: TeamName.optional(),
  settings: LeagueSettings,
  draftAt: DraftAt.optional(),
  draftOrderMode: DraftOrderMode.optional(),
});
export type CreateLeagueInput = z.infer<typeof CreateLeagueInput>;

export const UpdateLeagueInput = z.object({
  name: LeagueName.optional(),
  settings: LeagueSettings.optional(),
  draftAt: DraftAt.optional(),
  draftOrderMode: DraftOrderMode.optional(),
});

/** The commissioner's draft order: every team, round-1 order. */
export const SetDraftOrderInput = z.object({ teamIds: z.array(z.string()).min(1).max(20) });
export type UpdateLeagueInput = z.infer<typeof UpdateLeagueInput>;

export const JoinLeagueInput = z.object({ teamName: TeamName.optional() });
export type JoinLeagueInput = z.infer<typeof JoinLeagueInput>;

export const RenameTeamInput = z.object({ name: TeamName });

export const UpdateProfileInput = z.object({
  name: z.string().trim().min(1).max(40),
});

export const LEAGUE_STATUSES = ["setup", "drafting", "inSeason", "complete"] as const;
export type LeagueStatus = (typeof LEAGUE_STATUSES)[number];

// ---- Responses ----------------------------------------------------------

export interface TeamSummary {
  id: string;
  name: string;
  owner: { id: string; name: string; image: string | null };
  isCommissioner: boolean;
}

export interface LeagueSummary {
  id: string;
  name: string;
  season: number;
  status: LeagueStatus;
  teamCount: number;
  teamsJoined: number;
  myTeamId: string;
  isCommissioner: boolean;
}

export interface LeagueDetail extends LeagueSummary {
  settings: LeagueSettings;
  /** ISO time the draft starts by itself, or null. */
  draftAt: string | null;
  draftOrderMode: DraftOrderMode;
  /** Team ids in round-1 order; empty until set or drawn. */
  draftOrder: string[];
  /** Drawn when the league filled: nobody can change it. */
  draftOrderLocked: boolean;
  /** Only shown to members. */
  inviteCode: string;
  teams: TeamSummary[];
}

export interface InvitePreview {
  leagueId: string;
  name: string;
  season: number;
  commissionerName: string;
  teamsJoined: number;
  teamCount: number;
  canJoin: boolean;
  /** Set when the viewer is already in this league. */
  alreadyMember: boolean;
  reason?: "full" | "started";
}

export interface ApiError {
  error: string;
  message: string;
}

// ---- Admin ------------------------------------------------------------------

export const PlayerFilter = z.enum(["missing", "overridden", "all"]);
export type PlayerFilter = z.infer<typeof PlayerFilter>;

export const UpdatePlayerPositionsInput = z.object({
  /** Empty array clears the override, going back to derived positions. */
  positionsOverride: z
    .array(NrlPosition)
    .max(4)
    .refine((p) => new Set(p).size === p.length, "Positions must be unique"),
});
export type UpdatePlayerPositionsInput = z.infer<typeof UpdatePlayerPositionsInput>;

export interface AdminPlayer {
  id: number;
  name: string;
  club: { key: string; nickName: string } | null;
  appearances: number;
  /** What the league uses: the override if set, else derived. */
  positions: NrlPosition[];
  derivedPositions: NrlPosition[];
  positionsOverride: NrlPosition[];
}

export interface Me {
  id: string;
  name: string;
  email: string;
  image: string | null;
  isAdmin: boolean;
}

// ---- Draft ------------------------------------------------------------------

export const DRAFT_STATUSES = ["pending", "live", "paused", "complete"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export interface DraftTeam {
  id: string;
  name: string;
  ownerName: string;
  ownerImage: string | null;
}

export interface DraftPickView {
  pickNo: number;
  round: number;
  teamId: string;
  playerId: number;
  madeBy: "manager" | "autopick" | "commissioner";
}

/** Everything everyone in the draft room sees. Pushed over the socket on every change. */
export interface DraftState {
  leagueId: string;
  status: DraftStatus;
  pickSeconds: number;
  /** Round-1 order (empty until the draft starts). */
  order: DraftTeam[];
  rounds: number;
  totalPicks: number;
  currentPick: number;
  onClockTeamId: string | null;
  /** ISO time the team on the clock gets autopicked. */
  deadline: string | null;
  pausedRemainingMs: number | null;
  picks: DraftPickView[];
  autopilotTeamIds: string[];
  version: number;
  /** Server time when this state was sent, to correct for clock skew. */
  serverNow: string;
}

/** A player in the draft pool, ranked for best-available and autopick. */
export interface DraftPlayer {
  id: number;
  name: string;
  club: { key: string; nickName: string } | null;
  positions: NrlPosition[];
  /** Season the ranking is based on. */
  statsSeason: number;
  games: number;
  /** Average points per game under this league's scoring. */
  avgPoints: number;
  rank: number;
}

export const MakePickInput = z.object({
  /** The pick the client thinks is on the clock; stale picks are rejected. */
  pickNo: z.number().int().min(1),
  playerId: z.number().int(),
});
export type MakePickInput = z.infer<typeof MakePickInput>;

export const SetQueueInput = z.object({
  playerIds: z.array(z.number().int()).max(200),
});

export const SetAutopilotInput = z.object({ on: z.boolean() });

export const DRAFT_EVENTS = {
  /** client -> server: { leagueId } */
  join: "draft:join",
  /** server -> client: DraftState */
  state: "draft:state",
  /** server -> client: { message } when a join is refused */
  error: "draft:error",
} as const;

// ---- Season -----------------------------------------------------------------

export type RoundStatus = "upcoming" | "live" | "complete";

/** Why a player isn't scoring (or might not). */
export type PlayerNote =
  | "bye" // their club has no game this round
  | "notNamed" // team list is out and they're not in it
  | "reserve" // named as a reserve (jersey 18+), usually doesn't play
  | "didNotPlay" // named but didn't take the field
  | "noFixture"; // this round's draw isn't loaded yet

export interface PlayerRoundView {
  id: number;
  name: string;
  club: { key: string; nickName: string } | null;
  positions: NrlPosition[];
  status: "played" | "dnp" | "pending";
  note: PlayerNote | null;
  /** Their match has kicked off (or, on a bye, the round has): can't be moved. */
  locked: boolean;
  jersey: number | null;
  match: { opponent: string; home: boolean; kickoffAt: string; state: string } | null;
  points: number | null;
  breakdown: Array<{ stat: string; value: number; points: number }>;
}

export interface ScoredSlotView {
  slotKey: string;
  index: number;
  starterId: number | null;
  scorerId: number | null;
  points: number;
  viaEmergency: boolean;
}

export interface TeamRoundView {
  leagueId: string;
  teamId: string;
  teamName: string;
  ownerName: string;
  round: number;
  roundTitle: string;
  roundStatus: RoundStatus;
  /** The viewer can edit this lineup (their team, round not over). */
  editable: boolean;
  /** True if this lineup was saved for this round (else carried forward or automatic). */
  saved: boolean;
  lineup: Lineup;
  players: PlayerRoundView[];
  score: { total: number; provisional: boolean; slots: ScoredSlotView[] };
}

export interface MatchupSide {
  teamId: string;
  name: string;
  ownerName: string;
  score: number;
  provisional: boolean;
}

export interface MatchupView {
  round: number;
  /** "regular", or a finals game id: "SF1", "QF2", "GF"... */
  stage: string;
  label: string;
  home: MatchupSide | null;
  away: MatchupSide | null;
  winnerTeamId: string | null;
}

export interface LadderRowView {
  rank: number;
  teamId: string;
  name: string;
  ownerName: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface SeasonOverview {
  leagueId: string;
  mode: "headToHead" | "totalPoints";
  myTeamId: string;
  firstRound: number;
  lastRegularRound: number;
  grandFinalRound: number | null;
  /** The round to show by default: the first one not complete. */
  currentRound: number;
  rounds: Array<{ number: number; title: string; status: RoundStatus; finals: boolean; firstKickoff: string | null }>;
  ladder: LadderRowView[];
  finals: { size: number; champion: string | null; games: MatchupView[] } | null;
}

export interface RoundView {
  round: number;
  title: string;
  status: RoundStatus;
  matchups: MatchupView[];
  /** Every team's score this round (total-points leagues rank on these). */
  scores: MatchupSide[];
}
