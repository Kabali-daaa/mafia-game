import { NextResponse } from "next/server";
import { generateStoryDoc, GameError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // the model call can take a few seconds

export async function POST(req: Request) {
  try {
    const { code, playerId } = await req.json();
    if (!code || !playerId)
      return NextResponse.json({ error: "Bad request." }, { status: 400 });
    await generateStoryDoc(code, playerId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof GameError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("story error:", e);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
