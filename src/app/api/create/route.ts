import { NextResponse } from "next/server";
import { createRoomDoc, GameError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { name, playerId } = await req.json();
    if (!playerId) return NextResponse.json({ error: "Missing player id." }, { status: 400 });
    const code = await createRoomDoc(name, playerId);
    return NextResponse.json({ code });
  } catch (e) {
    if (e instanceof GameError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("create error:", e);
    return NextResponse.json({ error: "Server error. Check the Firebase setup." }, { status: 500 });
  }
}
