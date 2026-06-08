"use client";

import { io, type Socket } from "socket.io-client";
import type { ClientToServer, ServerToClient } from "./types";

let socket: Socket<ServerToClient, ClientToServer> | null = null;

export function getSocket(): Socket<ServerToClient, ClientToServer> {
  if (!socket) {
    socket = io({ autoConnect: true });
  }
  return socket;
}

// A stable per-browser id so a player keeps their seat across refreshes.
export function getPlayerId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("mafia:playerId");
  if (!id) {
    id = "p_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("mafia:playerId", id);
  }
  return id;
}

export function rememberName(name: string) {
  if (typeof window !== "undefined") localStorage.setItem("mafia:name", name);
}

export function recallName(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("mafia:name") || "";
}
