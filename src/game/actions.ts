// Pure game actions over a Room object. The API routes load a Room from
// Firestore, call one of these to mutate it, then persist + fan out views.
// (This is the logic that used to live in the Socket.IO server.)

import { isAssignable } from "./roles";
import {
  allNightActionsIn,
  allVotesIn,
  canStart,
  postChat,
  resetToLobby,
  resolveDay,
  resolveNight,
  resolveWitch,
  type Room,
  startGame,
  submitNightAction,
  submitVote,
} from "./engine";
import type { Player } from "@/lib/types";

export class GameError extends Error {}

// Add a player to a room, or reconnect an existing one.
export function applyJoin(room: Room, playerId: string, name: string): void {
  const trimmed = (name || "").trim();
  if (!trimmed) throw new GameError("Please enter a name.");

  const existing = room.players.find((p) => p.id === playerId);
  if (existing) {
    existing.connected = true;
    existing.name = trimmed;
    return;
  }
  if (room.phase !== "lobby")
    throw new GameError("Game already started — can't join now.");
  if (room.players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase()))
    throw new GameError("That name is taken in this room.");

  const player: Player = {
    id: playerId,
    name: trimmed,
    isHost: false,
    connected: true,
    alive: true,
    roleId: null,
  };
  room.players.push(player);
}

// Auto-advance once every required actor has acted.
function maybeAdvance(room: Room): void {
  if (room.phase === "night" && allNightActionsIn(room)) resolveNight(room);
  else if (room.phase === "day" && allVotesIn(room)) resolveDay(room);
}

export type ActionType =
  | "setConfig"
  | "start"
  | "nightAction"
  | "vote"
  | "chat"
  | "advance"
  | "reset";

// Apply a player's action. Throws GameError for user-facing problems.
export function applyAction(
  room: Room,
  playerId: string,
  type: ActionType,
  payload: any
): void {
  const isHost = room.hostId === playerId;

  switch (type) {
    case "setConfig": {
      if (!isHost || room.phase !== "lobby") return;
      const clean: Record<string, number> = {};
      for (const [k, v] of Object.entries(payload?.config ?? {})) {
        if (!isAssignable(k)) continue;
        const n = Math.max(0, Math.floor(Number(v) || 0));
        if (n > 0) clean[k] = n;
      }
      room.config = clean;
      return;
    }
    case "start": {
      if (!isHost) return;
      const err = canStart(room);
      if (err) throw new GameError(err);
      startGame(room);
      return;
    }
    case "nightAction": {
      const targets: string[] = Array.isArray(payload?.targetIds)
        ? payload.targetIds.filter(Boolean)
        : [];
      if (room.phase === "night") {
        submitNightAction(room, playerId, targets);
        maybeAdvance(room);
      } else if (room.phase === "witch") {
        resolveWitch(room, playerId, targets[0] ?? null);
      }
      return;
    }
    case "vote": {
      submitVote(room, playerId, payload?.targetId ?? null);
      maybeAdvance(room);
      return;
    }
    case "chat": {
      const channel = payload?.channel;
      if (channel !== "town" && channel !== "killers") return;
      postChat(room, playerId, channel, String(payload?.text ?? ""));
      return;
    }
    case "advance": {
      if (!isHost) return;
      if (room.phase === "night") resolveNight(room);
      else if (room.phase === "witch") resolveWitch(room, null, null);
      else if (room.phase === "day") resolveDay(room);
      return;
    }
    case "reset": {
      if (!isHost) return;
      resetToLobby(room);
      return;
    }
  }
}
