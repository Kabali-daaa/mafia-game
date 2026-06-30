// Shared types used by both the client and the server.

// Internal alignment. "mafia" = the Killers' side; UI labels it "Killers".
export type Team = "town" | "mafia" | "neutral";
// The possible game outcomes. "lovers" is a cross-faction Cupid couple who win by
// being the last two players alive (their bond overrides their original teams).
export type Winner = Team | "lovers";

// "witch" is a short reactive sub-phase after the night, where the Witch
// (if any) sees who died and may revive someone before morning is announced.
export type Phase = "lobby" | "night" | "witch" | "day" | "ended";

// Day sub-stage. "discussion" = chat only (God opens the vote); "done" = the
// day's outcome is settled (God begins the night). The middle ones are voting.
export type VoteStage =
  | "discussion"
  | "vote"
  | "choice"
  | "godchoice"
  | "revote"
  | "done";

export interface Player {
  id: string; // stable per-player id (stored in browser, survives reconnect)
  name: string;
  isHost: boolean;
  connected: boolean;
  alive: boolean;
  roleId: string | null; // assigned when the game starts
}

// What the engine produces each night/day so the UI can narrate it.
export interface LogEntry {
  phase: Phase;
  day: number;
  text: string;
}

// The slice of game state that is safe to send to a *specific* player.
// (We never leak other players' roles to non-hosts.)
export interface RoomView {
  code: string;
  phase: Phase;
  day: number;
  hostId: string;
  you: Player; // the receiving player, with their own role revealed
  players: PublicPlayer[]; // others, role hidden unless game ended / you are host
  config: RoleConfig;
  log: LogEntry[];
  winner: Winner | null;
  // AI-written narrative recap (null until the God generates it at game end).
  aiStory: string | null;
  // Per-phase prompts for the receiving player (e.g. "choose who to kill").
  prompt: ActionPrompt | null;
  // Private message just for this player (e.g. detective result).
  privateMessage: string | null;
  // Host-only: live tally of submitted night actions / day votes.
  hostStatus: HostStatus | null;
  // Chat state tailored to this viewer.
  chat: ChatState;
  // Day-vote sub-stage (null outside the day phase).
  voteStage: VoteStage | null;
  // Which role-group the host is calling right now (public; null outside night).
  nightStepLabel: string | null;
  // Host-only night board (who acted / what they chose) + next-step label.
  nightControl: NightControl | null;
  // Host-only ("God's eye") truthful record of each resolved night: who really
  // died, by whose hand, and who was saved — all roles named. null for players.
  godLog: GodNightReport[] | null;
}

// One resolved night, as only the God may see it: the true cause of every death
// and save, with all roles revealed. Built at resolution, kept for the whole game.
export interface GodNightReport {
  day: number;
  lines: string[];
}

export interface NightControl {
  board: NightBoardEntry[];
  nextLabel: string | null; // label of the next step, or null on the last step
  currentLabel: string | null; // the role-group being called right now (e.g. "🔪 Killers")
  // Connected, alive members of the current group who still haven't acted. While
  // this is > 0 the God can't advance — they must wait or skip these players.
  waitingCount: number;
}

export interface NightBoardEntry {
  id: string; // the acting player's id (so the God can skip them if AFK)
  step: string; // role-group label, e.g. "🩺 Doctor"
  current: boolean; // is this the step being called right now
  name: string; // player's name
  connected: boolean; // false if they look disconnected (likely AFK)
  done: boolean; // have they acted yet
  text: string; // what they did, e.g. "🎯 chose Ben" / "⏳ waiting…"
}

export interface ChatState {
  // The anonymous town square (visible to all; senders hidden from players).
  town: ChatLine[];
  // The Killers' private room — null unless the viewer is a member or the host.
  killers: ChatLine[] | null;
  canPostTown: boolean;
  canPostKillers: boolean;
}

export interface ChatLine {
  id: string;
  text: string;
  // Display name: real name (host or Killers' room), "You", or null = Anonymous.
  sender: string | null;
  mine: boolean;
}

export interface PublicPlayer {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  alive: boolean;
  roleId: string | null; // null unless revealed (host view, or game ended)
}

export interface ActionPrompt {
  kind: "night" | "vote" | "witch" | "choice";
  text: string;
  roleId: string | null;
  // Eligible target player ids.
  targets: string[];
  // For "choice" prompts (e.g. Skip vs Revote) — fixed button options.
  choices?: { id: string; label: string }[];
  // How many targets must be chosen (Cupid picks 2; everyone else 1).
  selectCount: number;
  canSkip: boolean;
  // Whether this player has already acted this phase.
  submitted: boolean;
}

export interface HostStatus {
  // How many of the players who need to act have acted.
  acted: number;
  pending: number;
  // For the day phase: current vote counts by target id.
  voteCounts: Record<string, number>;
  // Players still being waited on (haven't voted/acted yet) — so the God can
  // see who's stalling and skip an AFK player. `connected: false` ≈ likely AFK.
  pendingPlayers: { id: string; name: string; connected: boolean }[];
}

// Number of each role to include. Keyed by role id.
export type RoleConfig = Record<string, number>;
