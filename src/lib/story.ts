import "server-only";

import type { Room } from "@/game/engine";
import { getRole } from "@/game/roles";
import type { Player } from "@/lib/types";

// gemini-2.5-flash-lite: fast, cheap, free-tier eligible, and returns prose
// directly (the 2.0 models have 0 free quota; 2.5-flash spends the token budget
// on internal "thinking"). Override with GEMINI_MODEL if you have paid quota.
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

const roleName = (roleId: string | null) => getRole(roleId)?.name ?? "Villager";

// How a role's night action reads in the factual brief handed to the model.
function actVerb(roleId: string | null): string {
  switch (roleId) {
    case "killer":
    case "godfather":
      return "moved to kill";
    case "psycho":
      return "struck at";
    case "vigilante":
      return "took a shot at";
    case "police":
      return "investigated";
    case "doctor":
      return "protected";
    case "item":
      return "spent the night with";
    case "witch":
      return "tried to save";
    case "cupid":
      return "bound as lovers";
    default:
      return "chose";
  }
}

// A player's role over time: the roles they were shown acting as in the chronicle
// (role-at-the-time), ending with their final role. Captures transformations like
// the Psycho Killer who was healed into a Vigilante, so the recap honors the
// timeline instead of back-dating the final role onto earlier nights.
function roleArc(room: Room, player: Player): string {
  const seen: string[] = [];
  for (const sc of room.chronicle) {
    if (sc.k !== "night") continue;
    for (const a of sc.acts) {
      if (a.name === player.name && a.roleId && !seen.includes(a.roleId)) seen.push(a.roleId);
    }
  }
  // A Vigilante is only ever a transformed Psycho Killer (never dealt directly).
  if (player.roleId === "vigilante" && !seen.includes("psycho")) seen.unshift("psycho");
  if (player.roleId && !seen.includes(player.roleId)) seen.push(player.roleId);
  if (seen.length === 0 && player.roleId) seen.push(player.roleId);
  return seen.map(roleName).join(", later became ");
}

// A compact, factual brief of the whole game — every secret role, every night/day
// event, and the winner — for the model to dramatize WITHOUT inventing anything.
export function buildStoryFacts(room: Room): string {
  const out: string[] = [];

  const roster = room.players
    .filter((p) => !p.isHost)
    .map((p) => `- ${p.name}: ${roleArc(room, p)}${p.alive ? " (survived)" : " (died)"}`)
    .join("\n");
  out.push("PLAYERS AND THEIR SECRET ROLES:\n" + roster);

  const winLabel =
    room.winner === "mafia"
      ? "the Killers"
      : room.winner === "town"
        ? "the Town"
        : room.winner === "lovers"
          ? "the Lovers"
          : room.winner === "neutral"
            ? (room.log.some((e) => e.phase === "ended" && /Psycho Killer wins/.test(e.text))
                ? "the Psycho Killer"
                : "the Jester")
            : "no one";
  out.push(`\nWINNER: ${winLabel}.`);

  out.push("\nEVENTS IN ORDER:");
  for (const sc of room.chronicle) {
    if (sc.k === "night") {
      out.push(`Night ${sc.day}:`);
      for (const a of sc.acts) {
        if (!a.targets.length) continue;
        out.push(`  - ${a.name} (${roleName(a.roleId)}) ${actVerb(a.roleId)} ${a.targets.join(" and ")}.`);
      }
      if (sc.deaths.length) for (const d of sc.deaths) out.push(`  - ${d.name} (${roleName(d.roleId)}) was found dead at dawn.`);
      else out.push("  - Dawn came and no one had died.");
    } else if (sc.k === "banish") {
      out.push(`Day ${sc.day}: the town voted to banish ${sc.name} (${roleName(sc.roleId)}).`);
    } else {
      out.push(`Day ${sc.day}: ${sc.name} (${roleName(sc.roleId)}) died of heartbreak when their secret lover fell.`);
    }
  }

  // Explicit final standing so the wrap-up never mislabels who lived or died.
  const others = room.players.filter((p) => !p.isHost);
  const survived = others.filter((p) => p.alive).map((p) => p.name);
  const fell = others.filter((p) => !p.alive).map((p) => p.name);
  out.push(`\nFINAL STANDING — survived: ${survived.join(", ") || "no one"}. Fell: ${fell.join(", ") || "no one"}.`);

  return out.join("\n");
}

const INSTRUCTIONS = `You are a master storyteller narrating the aftermath of a game of Mafia — a social-deduction party game set in a cursed village where hidden Killers hunt by night and the frightened Town hunts back by day.

The game is OVER. Below are the TRUE facts: every player's secret role, everything that happened each night and day, and who won. Write a thrilling, atmospheric STORY RECAP that retells the whole game.

Rules:
- Use the players' real names and reveal their true roles dramatically as the tale unfolds.
- Follow the ACTUAL events in order, night by night and day by day. Never invent deaths, survivals, kills, saves, or roles that aren't in the facts.
- The role shown beside each night's actions is the role that player held AT THAT MOMENT. A roster entry like "later became" means that player's role CHANGED mid-game — describe them by their earlier role on earlier nights, and reveal the transformation as a twist when it happens. Never back-date a later role onto an earlier night.
- You may add vivid atmosphere, emotion and tension — but never contradict the facts.
- Build to the climax and clearly crown the winning side at the end.
- Keep it punchy: 4 to 7 short paragraphs. Begin with a short evocative TITLE on its very first line.
- Tone: dark, cinematic, a little playful. Write plain prose — no markdown, no headings, no bullet points.`;

// Generate the narrative recap via the Gemini REST API. Throws a friendly Error on
// any failure (missing key, API error, empty result) so the caller can surface it.
export async function generateStory(room: Room): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("The AI story isn't set up yet — the server is missing GEMINI_API_KEY.");

  const prompt = `${INSTRUCTIONS}\n\nFACTS:\n${buildStoryFacts(room)}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.95, maxOutputTokens: 1200 },
      }),
    });
  } catch {
    throw new Error("Couldn't reach the AI service. Check the server's connection and try again.");
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (res.status === 400 || res.status === 403)
      throw new Error("The Gemini API key was rejected. Double-check GEMINI_API_KEY.");
    if (res.status === 429) throw new Error("The AI is rate-limited right now — try again in a moment.");
    throw new Error(`The AI service errored (${res.status}). ${detail.slice(0, 160)}`);
  }

  const data = await res.json().catch(() => null);
  const text: string =
    data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p?.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("The AI returned an empty story — try again.");
  return text.trim();
}
