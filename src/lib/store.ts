import "server-only";

import { adminDb } from "./firebaseAdmin";
import {
  buildView,
  createRoom,
  makeRoomCode,
  type Room,
} from "@/game/engine";
import {
  applyAction,
  applyJoin,
  GameError,
  type ActionType,
} from "@/game/actions";
import type { Player } from "@/lib/types";

// Firestore layout:
//   rooms/{code}                  -> the full Room (server-only; has every role)
//   rooms/{code}/views/{playerId} -> that player's RoomView (what they're allowed to see)

const roomRef = (code: string) => adminDb().doc(`rooms/${code}`);
const viewRef = (code: string, pid: string) =>
  adminDb().doc(`rooms/${code}/views/${pid}`);

// How long a room may sit untouched before it's eligible for cleanup.
const ROOM_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Cheap, stable hash of a view doc so we can skip writing unchanged views.
function hashView(view: unknown): string {
  const s = JSON.stringify(view);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Write the master room + ONLY the per-player view docs that actually changed
// since the last write (tracked by a hash stored on the master doc). This roughly
// halves Firestore writes — most mutations only change a couple of players' views.
// `set` is the batch's or transaction's set fn (same signature for both).
function fanOut(room: Room, set: (ref: any, data: any) => void): void {
  const prev: Record<string, string> = (room as any).__viewHashes ?? {};
  const next: Record<string, string> = {};
  const dirty: Array<[string, any]> = [];
  for (const p of room.players) {
    const view = buildView(room, p.id);
    const h = hashView(view);
    next[p.id] = h;
    if (prev[p.id] !== h) dirty.push([p.id, view]);
  }
  // Stash bookkeeping on the master doc (ignored by the engine + buildView).
  (room as any).__viewHashes = next;
  (room as any).updatedAt = Date.now();
  set(roomRef(room.code), room);
  for (const [pid, view] of dirty) set(viewRef(room.code, pid), view);
}

// Best-effort sweep of stale rooms; runs on room creation and never blocks it.
async function expireOldRooms(): Promise<void> {
  try {
    const db = adminDb();
    const cutoff = Date.now() - ROOM_TTL_MS;
    const stale = await db
      .collection("rooms")
      .where("updatedAt", "<", cutoff)
      .limit(5)
      .get();
    for (const doc of stale.docs) await db.recursiveDelete(doc.ref);
  } catch {
    // index missing, quota, etc. — cleanup is opportunistic, ignore failures.
  }
}

// Write the master room + a fresh view doc for every player, atomically.
async function persist(room: Room): Promise<void> {
  const db = adminDb();
  const batch = db.batch();
  fanOut(room, (ref, data) => batch.set(ref, data));
  await batch.commit();
}

export async function createRoomDoc(name: string, playerId: string): Promise<string> {
  const trimmed = (name || "").trim();
  if (!trimmed) throw new GameError("Please enter a name.");

  await expireOldRooms(); // opportunistically clean up abandoned rooms

  for (let attempt = 0; attempt < 12; attempt++) {
    const code = makeRoomCode(new Set());
    const snap = await roomRef(code).get();
    if (snap.exists) continue;
    const host: Player = {
      id: playerId,
      name: trimmed,
      isHost: true,
      connected: true,
      alive: true,
      roleId: null,
    };
    await persist(createRoom(code, host));
    return code;
  }
  throw new GameError("Couldn't allocate a room code, please retry.");
}

// Run a mutation inside a transaction, then fan out the per-player views.
async function mutate(code: string, fn: (room: Room) => void): Promise<void> {
  const db = adminDb();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists) throw new GameError("Room not found.");
    const room = snap.data() as Room;
    fn(room); // run engine/action logic (mutates room)
    fanOut(room, (ref, data) => tx.set(ref, data));
  });
}

// Returns the resolved player id (may differ from `playerId` if the seat was
// resumed by name).
export async function joinRoomDoc(
  code: string,
  name: string,
  playerId: string
): Promise<string> {
  const c = code.toUpperCase();
  const db = adminDb();
  let resolved = playerId;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(roomRef(c));
    if (!snap.exists) throw new GameError("Room not found.");
    const room = snap.data() as Room;
    resolved = applyJoin(room, playerId, name);
    fanOut(room, (ref, data) => tx.set(ref, data));
  });
  return resolved;
}

export function actionRoomDoc(
  code: string,
  playerId: string,
  type: ActionType,
  payload: any
) {
  return mutate(code.toUpperCase(), (room) =>
    applyAction(room, playerId, type, payload)
  );
}

export { GameError };
