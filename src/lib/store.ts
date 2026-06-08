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

// Write the master room + a fresh view doc for every player, atomically.
async function persist(room: Room): Promise<void> {
  const db = adminDb();
  const batch = db.batch();
  batch.set(roomRef(room.code), room as any);
  for (const p of room.players) {
    batch.set(viewRef(room.code, p.id), buildView(room, p.id) as any);
  }
  await batch.commit();
}

export async function createRoomDoc(name: string, playerId: string): Promise<string> {
  const trimmed = (name || "").trim();
  if (!trimmed) throw new GameError("Please enter a name.");

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
    tx.set(roomRef(code), room as any);
    for (const p of room.players) {
      tx.set(viewRef(code, p.id), buildView(room, p.id) as any);
    }
  });
}

export function joinRoomDoc(code: string, name: string, playerId: string) {
  return mutate(code.toUpperCase(), (room) => applyJoin(room, playerId, name));
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
