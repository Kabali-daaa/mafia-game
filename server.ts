// Custom Next.js server that also runs the Socket.IO real-time layer.
// Run locally with `npm run dev`. Deploys to any host that keeps a process
// alive and supports WebSockets (Railway, Render, Fly.io, a VPS, etc.).

import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
import type { ClientToServer, Player, ServerToClient } from "./src/lib/types";
import { isAssignable } from "./src/game/roles";
import {
  allNightActionsIn,
  allVotesIn,
  buildView,
  canStart,
  createRoom,
  makeRoomCode,
  resetToLobby,
  postChat,
  resolveDay,
  resolveNight,
  resolveWitch,
  type Room,
  startGame,
  submitNightAction,
  submitVote,
} from "./src/game/engine";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT) || 3000;
const app = next({ dev });
const handle = app.getRequestHandler();

// In-memory store. Rooms are ephemeral — fine for a party game on one server.
const rooms = new Map<string, Room>();
// socket.id -> { code, playerId } so we can find the room on each event.
const sockets = new Map<string, { code: string; playerId: string }>();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new Server<ClientToServer, ServerToClient>(httpServer, {
    cors: { origin: "*" },
  });

  function roomCodes(): Set<string> {
    return new Set(rooms.keys());
  }

  // Push a fresh, per-player view to everyone in a room.
  function broadcast(room: Room) {
    for (const p of room.players) {
      io.to(`p:${room.code}:${p.id}`).emit("room", buildView(room, p.id));
    }
  }

  // Auto-advance phases once everyone has acted.
  function maybeAdvance(room: Room) {
    if (room.phase === "night" && allNightActionsIn(room)) {
      resolveNight(room);
    } else if (room.phase === "day" && allVotesIn(room)) {
      resolveDay(room);
    }
  }

  io.on("connection", (socket) => {
    const reply = (code: string, playerId: string) => {
      sockets.set(socket.id, { code, playerId });
      socket.join(`p:${code}:${playerId}`); // private channel for this player
      socket.join(`room:${code}`);
    };

    socket.on("create", ({ name, playerId }) => {
      const trimmed = (name || "").trim();
      if (!trimmed) return socket.emit("error", "Please enter a name.");
      const code = makeRoomCode(roomCodes());
      const host: Player = {
        id: playerId,
        name: trimmed,
        isHost: true,
        connected: true,
        alive: true,
        roleId: null,
      };
      const room = createRoom(code, host);
      rooms.set(code, room);
      reply(code, playerId);
      socket.emit("joined", { code, playerId });
      broadcast(room);
    });

    socket.on("join", ({ code, name, playerId }) => {
      const room = rooms.get((code || "").toUpperCase());
      if (!room) return socket.emit("error", "Room not found.");
      const trimmed = (name || "").trim();
      if (!trimmed) return socket.emit("error", "Please enter a name.");

      const existing = room.players.find((p) => p.id === playerId);
      if (existing) {
        // Reconnect.
        existing.connected = true;
        existing.name = trimmed;
      } else {
        if (room.phase !== "lobby")
          return socket.emit("error", "Game already started — can't join now.");
        if (room.players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase()))
          return socket.emit("error", "That name is taken in this room.");
        room.players.push({
          id: playerId,
          name: trimmed,
          isHost: false,
          connected: true,
          alive: true,
          roleId: null,
        });
      }
      reply(room.code, playerId);
      socket.emit("joined", { code: room.code, playerId });
      broadcast(room);
    });

    function withRoom(fn: (room: Room, ctx: { playerId: string }) => void) {
      const meta = sockets.get(socket.id);
      if (!meta) return;
      const room = rooms.get(meta.code);
      if (!room) return;
      fn(room, { playerId: meta.playerId });
    }

    function hostOnly(room: Room, playerId: string): boolean {
      return room.hostId === playerId;
    }

    socket.on("setConfig", ({ config }) => {
      withRoom((room, { playerId }) => {
        if (!hostOnly(room, playerId) || room.phase !== "lobby") return;
        const clean: Record<string, number> = {};
        for (const [k, v] of Object.entries(config || {})) {
          if (!isAssignable(k)) continue; // ignore transform-only roles (Vigilante)
          const n = Math.max(0, Math.floor(Number(v) || 0));
          if (n > 0) clean[k] = n;
        }
        room.config = clean;
        broadcast(room);
      });
    });

    socket.on("start", () => {
      withRoom((room, { playerId }) => {
        if (!hostOnly(room, playerId)) return;
        const err = canStart(room);
        if (err) return socket.emit("error", err);
        startGame(room);
        broadcast(room);
      });
    });

    socket.on("nightAction", ({ targetIds }) => {
      withRoom((room, { playerId }) => {
        const targets = Array.isArray(targetIds) ? targetIds.filter(Boolean) : [];
        if (room.phase === "night") {
          submitNightAction(room, playerId, targets);
          maybeAdvance(room);
        } else if (room.phase === "witch") {
          // The Witch's reactive revive choice (targets[0]) or a skip.
          resolveWitch(room, playerId, targets[0] ?? null);
        }
        broadcast(room);
      });
    });

    socket.on("vote", ({ targetId }) => {
      withRoom((room, { playerId }) => {
        submitVote(room, playerId, targetId);
        maybeAdvance(room);
        broadcast(room);
      });
    });

    socket.on("chat", ({ channel, text }) => {
      withRoom((room, { playerId }) => {
        if (channel !== "town" && channel !== "killers") return;
        postChat(room, playerId, channel, text);
        broadcast(room);
      });
    });

    // Host forces the current phase to resolve (e.g. someone is AFK).
    socket.on("advance", () => {
      withRoom((room, { playerId }) => {
        if (!hostOnly(room, playerId)) return;
        if (room.phase === "night") {
          resolveNight(room);
        } else if (room.phase === "witch") {
          resolveWitch(room, null, null); // host forces morning, no revive
        } else if (room.phase === "day") {
          resolveDay(room);
        }
        broadcast(room);
      });
    });

    socket.on("reset", () => {
      withRoom((room, { playerId }) => {
        if (!hostOnly(room, playerId)) return;
        resetToLobby(room);
        broadcast(room);
      });
    });

    socket.on("disconnect", () => {
      const meta = sockets.get(socket.id);
      sockets.delete(socket.id);
      if (!meta) return;
      const room = rooms.get(meta.code);
      if (!room) return;
      const player = room.players.find((p) => p.id === meta.playerId);
      if (player) player.connected = false;

      // If the room is empty (everyone disconnected) in the lobby, clean it up.
      if (room.phase === "lobby" && room.players.every((p) => !p.connected)) {
        rooms.delete(room.code);
        return;
      }
      broadcast(room);
    });
  });

  httpServer.listen(port, () => {
    console.log(`\n  🎭 Mafia game ready on http://localhost:${port}\n`);
  });
});
