import { z } from "zod";
import { LeagueSettings, MAX_TEAMS, MIN_TEAMS, type RosterTemplate, type ScoringRules } from "./leagueSettings.ts";
import { NrlPosition } from "./positions.ts";
import type { Lineup } from "./lineup.ts";
import type { ScoreState } from "./matchState.ts";

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
  /** How settled their points are: upcoming, live, in review (stats still being checked), final. */
  scoreState: ScoreState;
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
  /** Saved for this round, carried over from an earlier round, or built from the squad. */
  lineupSource: "saved" | "carried" | "auto";
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

// ---- Mock drafts ----------------------------------------------------------
// Solo practice drafts against CPU teams, separate from leagues. They run in
// the browser; finished ones are saved to the user's history.

/** The pool a mock drafts from: the site's default squad and scoring, ranked on the latest season. */
export interface MockPool {
  /** Season the rankings come from (null when no match data is loaded). */
  season: number | null;
  roster: RosterTemplate;
  scoring: ScoringRules;
  players: DraftPlayer[];
}

export const MockDraftInput = z.object({
  teamCount: z.number().int().min(MIN_TEAMS).max(MAX_TEAMS),
  /** Your round-1 position, 1-based. */
  slot: z.number().int().min(1).max(MAX_TEAMS),
  /** 0 = no clock. */
  pickSeconds: z.number().int().min(0).max(600),
  teamNames: z.array(z.string().trim().min(1).max(40)),
  /** Player ids in pick order: pick 1 first. */
  picks: z.array(z.number().int()),
});
export type MockDraftInput = z.infer<typeof MockDraftInput>;

/** A pick as it was made, kept with the player's details at the time. */
export interface MockPickView {
  pickNo: number;
  playerId: number;
  name: string;
  positions: NrlPosition[];
  club: string | null;
  avgPoints: number;
}

export interface MockDraftSummary {
  id: string;
  createdAt: string;
  season: number;
  teamCount: number;
  slot: number;
  /** Your first few picks, for the history list. */
  firstPicks: string[];
}

export interface MockDraftDetail {
  id: string;
  createdAt: string;
  season: number;
  teamCount: number;
  slot: number;
  pickSeconds: number;
  roster: RosterTemplate;
  teamNames: string[];
  picks: MockPickView[];
}

// ---- Free agency and waivers ------------------------------------------------

/** "free": pick up now. "waivers": claim it; claims settle Wednesday 6am. */
export type PlayerAvailability = "owned" | "free" | "waivers";

export interface LeaguePlayer {
  id: number;
  name: string;
  club: { key: string; nickName: string } | null;
  positions: NrlPosition[];
  ownerTeamId: string | null;
  availability: PlayerAvailability;
  /** Their game this round has started: they can't be added or dropped until the round is over. */
  locked: boolean;
  /** This season's average points per game under the league's scoring. */
  seasonAvg: number | null;
  seasonGames: number;
  /** Last season's, while this season is young (null when there's no earlier season). */
  prevAvg: number | null;
  prevGames: number;
}

export interface ClaimView {
  id: string;
  rank: number;
  player: { id: number; name: string; positions: NrlPosition[] };
  drop: { id: number; name: string; positions: NrlPosition[] } | null;
}

export interface PlayersView {
  leagueId: string;
  myTeamId: string;
  isCommissioner: boolean;
  season: number;
  /** The season `prevAvg` comes from, if any. */
  prevSeason: number | null;
  squadMax: number;
  teams: Array<{ id: string; name: string }>;
  waivers: {
    lastClear: string;
    nextClear: string;
    /** Team ids, first in line first. */
    order: string[];
  };
  players: LeaguePlayer[];
  /** Your pending claims, in your order. */
  claims: ClaimView[];
}

export const AddPlayerInput = z.object({
  teamId: z.string(),
  playerId: z.number().int(),
  dropPlayerId: z.number().int().nullable().optional(),
});
export type AddPlayerInput = z.infer<typeof AddPlayerInput>;

export const DropPlayerInput = z.object({ teamId: z.string(), playerId: z.number().int() });

export const ClaimOrderInput = z.object({ teamId: z.string(), claimIds: z.array(z.string()) });

export interface ActivityItem {
  id: string;
  at: string;
  kind: "add" | "drop" | "waiver" | "trade";
  text: string;
}

// ---- Trades ---------------------------------------------------------------------

export const MAX_TRADE_PLAYERS = 6;

export const ProposeTradeInput = z
  .object({
    fromTeamId: z.string(),
    toTeamId: z.string(),
    /** Players the proposing team gives. */
    give: z.array(z.number().int()).min(1, "Choose at least one player to give").max(MAX_TRADE_PLAYERS),
    /** Players it gets in return. */
    get: z.array(z.number().int()).min(1, "Choose at least one player to get").max(MAX_TRADE_PLAYERS),
    message: z.string().trim().max(200).optional(),
  })
  .refine((t) => t.fromTeamId !== t.toTeamId, { message: "Trade with another team" });
export type ProposeTradeInput = z.infer<typeof ProposeTradeInput>;

export const TradeVoteInput = z.object({ approve: z.boolean() });

export type TradeStatus = "proposed" | "rejected" | "cancelled" | "review" | "completed" | "vetoed" | "failed";

export interface TradePlayer {
  id: number;
  name: string;
  positions: NrlPosition[];
  club: string | null;
}

export interface TradeView {
  id: string;
  status: TradeStatus;
  createdAt: string;
  reviewEndsAt: string | null;
  completedAt: string | null;
  message: string | null;
  /** Why it was vetoed or failed. */
  note: string | null;
  proposer: { teamId: string; name: string };
  receiver: { teamId: string; name: string };
  /** What the proposer gives (the receiver gets) and gets. */
  give: TradePlayer[];
  get: TradePlayer[];
  /** Other managers' views, while it's in review and after. */
  votes: { approve: string[]; veto: string[] };
  myVote: boolean | null;
  can: { accept: boolean; reject: boolean; cancel: boolean; vote: boolean; approve: boolean; veto: boolean };
}

export interface TradesView {
  leagueId: string;
  myTeamId: string;
  isCommissioner: boolean;
  /** Trades close when this round starts (null: no deadline). */
  deadline: { round: number; closed: boolean } | null;
  /** How long accepted trades are reviewed for. */
  reviewHours: number;
  teams: Array<{ id: string; name: string; squad: TradePlayer[] }>;
  trades: TradeView[];
}
