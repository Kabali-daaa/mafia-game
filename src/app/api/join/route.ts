import { NextResponse } from "next/server";
import { joinRoomDoc, GameError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { code, name, playerId } = await req.json();
    if (!playerId || !code)
      return NextResponse.json({ error: "Missing room code or player id." }, { status: 400 });
    const resolvedId = await joinRoomDoc(code, name, playerId);
    return NextResponse.json({ code: String(code).toUpperCase(), playerId: resolvedId });
  } catch (e) {
    if (e instanceof GameError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("join error:", e);
    return NextResponse.json({ error: "Server error. Check the Firebase setup." }, { status: 500 });
  }
}
