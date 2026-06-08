"use client";

import { doc, onSnapshot } from "firebase/firestore";
import { getDb } from "./firebaseClient";
import type { ActionType } from "@/game/actions";
import type { RoomView } from "./types";

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

export function setPlayerId(id: string) {
  if (typeof window !== "undefined" && id) localStorage.setItem("mafia:playerId", id);
}

export function rememberName(name: string) {
  if (typeof window !== "undefined") localStorage.setItem("mafia:name", name);
}
export function recallName(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("mafia:name") || "";
}

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Something went wrong.");
  return data;
}

export function createGame(name: string): Promise<{ code: string }> {
  return post("/api/create", { name, playerId: getPlayerId() });
}
export async function joinGame(
  code: string,
  name: string
): Promise<{ code: string; playerId: string }> {
  const res = await post("/api/join", { code, name, playerId: getPlayerId() });
  // Adopt the resolved id (in case our seat was resumed by name).
  if (res.playerId) setPlayerId(res.playerId);
  return res;
}
export function sendAction(
  code: string,
  type: ActionType,
  payload: Record<string, unknown> = {}
): Promise<any> {
  return post("/api/action", { code, playerId: getPlayerId(), type, payload });
}

// Live-subscribe to this player's view of the room. Returns an unsubscribe fn.
export function subscribeToView(
  code: string,
  onView: (view: RoomView) => void,
  onError: (msg: string) => void
): () => void {
  const ref = doc(getDb(), "rooms", code.toUpperCase(), "views", getPlayerId());
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) onView(snap.data() as RoomView);
    },
    () => onError("Lost connection to the game.")
  );
}
