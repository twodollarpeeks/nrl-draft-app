import { z } from "zod";
import { LeagueSettings } from "./leagueSettings.ts";
import { NrlPosition } from "./positions.ts";

// Request bodies shared by the API (validation) and the web app (forms).

export const LeagueName = z.string().trim().min(2, "At least 2 characters").max(40, "At most 40 characters");
export const TeamName = z.string().trim().min(2, "At least 2 characters").max(30, "At most 30 characters");

export const CreateLeagueInput = z.object({
  name: LeagueName,
  season: z.number().int().min(2020).max(2100),
  teamName: TeamName.optional(),
  settings: LeagueSettings,
});
export type CreateLeagueInput = z.infer<typeof CreateLeagueInput>;

export const UpdateLeagueInput = z.object({
  name: LeagueName.optional(),
  settings: LeagueSettings.optional(),
});
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
