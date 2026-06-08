// Shared types used by both the client and the server.

// Internal alignment. "mafia" = the Killers' side; UI labels it "Killers".
export type Team = "town" | "mafia" | "neutral";

// "witch" is a short reactive sub-phase after the night, where the Witch
// (if any) sees who died and may revive someone before morning is announced.
export type Phase = "lobby" | "night" | "witch" | "day" | "ended";

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
  winner: Team | null;
  // Per-phase prompts for the receiving player (e.g. "choose who to kill").
  prompt: ActionPrompt | null;
  // Private message just for this player (e.g. detective result).
  privateMessage: string | null;
  // Host-only: live tally of submitted night actions / day votes.
  hostStatus: HostStatus | null;
  // Chat state tailored to this viewer.
  chat: ChatState;
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
  kind: "night" | "vote" | "witch";
  text: string;
  roleId: string | null;
  // Eligible target player ids.
  targets: string[];
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
}

// Number of each role to include. Keyed by role id.
export type RoleConfig = Record<string, number>;
