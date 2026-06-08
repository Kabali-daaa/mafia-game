import { NextResponse } from "next/server";
import { actionRoomDoc, GameError } from "@/lib/store";
import type { ActionType } from "@/game/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID: ActionType[] = [
  "setConfig", "start", "nightAction", "vote", "chat", "advance", "reset",
];

export async function POST(req: Request) {
  try {
    const { code, playerId, type, payload } = await req.json();
    if (!code || !playerId || !VALID.includes(type))
      return NextResponse.json({ error: "Bad request." }, { status: 400 });
    await actionRoomDoc(code, playerId, type, payload ?? {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof GameError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("action error:", e);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
