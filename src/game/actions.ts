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
  resolveChoice,
  resolveDay,
  resolveGodChoice,
  resolveNight,
  resolveWitch,
  type Room,
  startGame,
  submitChoice,
  submitNightAction,
  submitVote,
} from "./engine";
import type { Player } from "@/lib/types";

export class GameError extends Error {}

// Add a player, reconnect them by id (refresh), or resume their seat by name
// (rejoin from a new device/session). Returns the resolved player id so the
// client can adopt it.
export function applyJoin(room: Room, playerId: string, name: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) throw new GameError("Please enter a name.");

  // Same browser / refresh: reconnect by id.
  const byId = room.players.find((p) => p.id === playerId);
  if (byId) {
    byId.connected = true;
    byId.name = trimmed;
    return byId.id;
  }

  // Returning player on a new device/session: resume the seat that already has
  // this name (keeps their role + chat history). Works mid-game too.
  const byName = room.players.find(
    (p) => p.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (byName) {
    byName.connected = true;
    return byName.id;
  }

  // Brand-new player — only allowed before the game starts.
  if (room.phase !== "lobby")
    throw new GameError("Game already started — can't join now.");

  const player: Player = {
    id: playerId,
    name: trimmed,
    isHost: false,
    connected: true,
    alive: true,
    roleId: null,
  };
  room.players.push(player);
  return playerId;
}

// Auto-advance once every required actor has acted.
function maybeAdvance(room: Room): void {
  if (room.phase === "night" && allNightActionsIn(room)) {
    resolveNight(room);
  } else if (room.phase === "day" && allVotesIn(room)) {
    if (room.voteStage === "choice") resolveChoice(room);
    else resolveDay(room); // "vote" / "revote"
  }
}

export type ActionType =
  | "setConfig"
  | "start"
  | "nightAction"
  | "vote"
  | "choice"
  | "godDecide"
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
    case "choice": {
      submitChoice(room, playerId, String(payload?.choice ?? ""));
      maybeAdvance(room);
      return;
    }
    case "godDecide": {
      if (!isHost) return;
      resolveGodChoice(room, String(payload?.decision ?? "skip"));
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
      else if (room.phase === "day") {
        if (room.voteStage === "choice") resolveChoice(room);
        else if (room.voteStage === "godchoice") resolveGodChoice(room, "skip");
        else resolveDay(room); // "vote" / "revote"
      }
      return;
    }
    case "reset": {
      if (!isHost) return;
      resetToLobby(room);
      return;
    }
  }
}
