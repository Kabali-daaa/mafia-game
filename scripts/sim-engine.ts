// ============================================================================
// Headless engine simulation — plays FULL games (15+ players) straight through
// engine.ts, with NO Firestore / network / quota cost. Drives many random games
// across several role mixes, tallies who wins, and prints sample playthroughs
// (incl. the host-only "God's eye" truth log) so the new neutral-Psycho win
// logic can be seen working at scale.
//
//   node --import tsx scripts/sim-engine.ts
// ============================================================================

import {
  createRoom,
  startGame,
  submitNightAction,
  advanceNight,
  openVote,
  submitVote,
  resolveDay,
  beginNight,
  alivePlayers,
  type Room,
} from "../src/game/engine";
import { getRole } from "../src/game/roles";
import type { Player } from "../src/lib/types";

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const chance = (p: number) => Math.random() < p;

function makeRoom(config: Record<string, number>): Room {
  const host: Player = { id: "god", name: "God", isHost: true, connected: true, alive: true, roleId: null };
  const room = createRoom("SIMX", host);
  const total = Object.values(config).reduce((a, b) => a + b, 0);
  for (let i = 0; i < total; i++)
    room.players.push({ id: `p${i}`, name: `P${i}`, isHost: false, connected: true, alive: true, roleId: null });
  room.config = config as Room["config"];
  startGame(room); // random deal of the config
  return room;
}

// What the town has learned. killers = Police-confirmed Killers (the Godfather
// reads innocent so is never here; the Psycho reads as a Killer so he can be);
// cleared = confirmed-innocent; seen = everyone already investigated.
interface Know { killers: Set<string>; cleared: Set<string>; seen: Set<string>; }
const freshKnow = (): Know => ({ killers: new Set(), cleared: new Set(), seen: new Set() });

// After a night, read each Police squad's result into the town's knowledge.
function learnFromPolice(room: Room, k: Know) {
  for (const p of room.players) {
    if (p.roleId !== "police") continue;
    const m = (room.privateMessages[p.id] ?? "").match(/🚓 (.+?) (IS|is NOT) a Killer/);
    if (!m) continue;
    const t = room.players.find((pl) => pl.name === m[1]);
    if (!t) continue;
    k.seen.add(t.id);
    if (m[2] === "IS") k.killers.add(t.id);
    else k.cleared.add(t.id);
  }
}

// Each living player's night choice, by their ACTUAL dealt role.
function planNight(room: Room, k: Know): Record<string, string[]> {
  const plan: Record<string, string[]> = {};
  const alive = alivePlayers(room);
  const ids = alive.map((p) => p.id);
  const other = (self: string) => pick(ids.filter((i) => i !== self)) ?? self;
  const odd = room.day % 2 === 1;

  // One shared target for the Killer squad — a random living non-Killer.
  const prey = ids.filter((i) => !["killer", "godfather"].includes(room.players.find((p) => p.id === i)?.roleId ?? ""));
  const mafiaTarget = pick(prey.length ? prey : ids);
  const livingPsycho = alive.find((p) => p.roleId === "psycho")?.id ?? null;

  for (const p of alive) {
    const r = p.roleId;
    if (r === "killer" || r === "godfather") plan[p.id] = [mafiaTarget !== p.id ? mafiaTarget : other(p.id)];
    else if (r === "psycho" && odd) plan[p.id] = [other(p.id)];
    else if (r === "vigilante" && odd) {
      const mark = ids.find((i) => i !== p.id && k.killers.has(i)); // shoot a confirmed Killer if known
      plan[p.id] = [mark ?? other(p.id)];
    }
    else if (r === "doctor") plan[p.id] = [livingPsycho && chance(0.3) ? livingPsycho : other(p.id)]; // sometimes heal the Psycho → Vigilante
    else if (r === "police") {
      const fresh = ids.filter((i) => i !== p.id && !k.seen.has(i)); // investigate someone new
      plan[p.id] = [fresh.length ? pick(fresh) : other(p.id)];
    }
    else if (r === "item") plan[p.id] = [other(p.id)];
    else if (r === "cupid" && room.day === 1) {
      const a = other(p.id); const b = pick(ids.filter((i) => i !== p.id && i !== a)) ?? a;
      plan[p.id] = [a, b];
    } else if (r === "witch") plan[p.id] = chance(0.5) ? [] : [other(p.id)];
  }
  return plan;
}

function stepNight(room: Room, k: Know) {
  const plan = planNight(room, k);
  let guard = 0;
  while (room.phase === "night" && guard++ < 40) {
    for (const [pid, targets] of Object.entries(plan)) submitNightAction(room, pid, targets);
    advanceNight(room);
  }
  learnFromPolice(room, k); // this night's Police result is now in privateMessages
}

// A SMART town: banish a Police-confirmed Killer (incl. the detectable Psycho) if
// one is alive; otherwise keep the pressure on by lynching a still-suspect player
// (anyone not yet cleared by the Police) rather than going quiet.
function stepDay(room: Room, k: Know) {
  if (room.phase !== "day" || room.voteStage !== "discussion") return;
  openVote(room);
  const ids = alivePlayers(room).map((p) => p.id);
  const confirmed = ids.find((i) => k.killers.has(i));
  const suspects = ids.filter((i) => !k.cleared.has(i));
  const target = confirmed ?? (suspects.length ? pick(suspects) : pick(ids));
  for (const id of ids) submitVote(room, id, id === target ? null : target);
  resolveDay(room); // may mutate voteStage (tsc can't see through the call)
  if (room.phase === "day" && (room.voteStage as string) === "done") beginNight(room);
}

function playGame(config: Record<string, number>): Room {
  const room = makeRoom(config);
  const k = freshKnow(); // the town's accumulated Police knowledge
  let guard = 0;
  while (room.phase !== "ended" && guard++ < 300) {
    if (room.phase === "night") stepNight(room, k);
    else if (room.phase === "day") stepDay(room, k);
    else break;
  }
  return room;
}

// Distinguish the two "neutral" winners by the engine's OWN end-game verdict
// (a Psycho can be alive when the Jester wins by banishment, so don't guess from
// who's alive — read what endGame actually declared).
function outcome(room: Room): string {
  if (room.winner !== "neutral") return room.winner ?? "unresolved";
  const ended = room.log.filter((e) => e.phase === "ended").map((e) => e.text).join("\n");
  return /Psycho Killer wins/.test(ended) ? "psycho" : "jester";
}

const CONFIGS: { name: string; config: Record<string, number> }[] = [
  // 15 players, exactly ONE Psycho + ONE Jester (two independent neutrals).
  { name: "15p · 1 Psycho · 1 Jester", config: { killer: 2, godfather: 1, psycho: 1, jester: 1, doctor: 2, police: 2, cupid: 1, item: 1, witch: 1, panchayath: 1, villager: 2 } },
];

const GAMES = Number(process.argv[2]) || 1000;
const samples: Record<string, Room> = {};

console.log(`\n🎲 Headless engine simulation — ${GAMES} games per config, all ≥15 players\n`);
for (const { name, config } of CONFIGS) {
  const total = Object.values(config).reduce((a, b) => a + b, 0);
  const tally: Record<string, number> = {};
  let nights = 0;
  for (let i = 0; i < GAMES; i++) {
    const room = playGame(config);
    const o = outcome(room);
    tally[o] = (tally[o] ?? 0) + 1;
    nights += room.day;
    if (!samples[o]) samples[o] = room; // keep first sample of each outcome type
  }
  const line = ["town", "mafia", "psycho", "jester", "lovers", "unresolved"]
    .filter((k) => tally[k])
    .map((k) => `${k}: ${tally[k]} (${Math.round((tally[k] / GAMES) * 100)}%)`)
    .join("   ");
  console.log(`── ${name} (${total} players) ──`);
  console.log(`   ${line}`);
  console.log(`   avg game length: ${(nights / GAMES).toFixed(1)} day/night cycles\n`);
}

// ---- Sample playthroughs: God's-eye truth log + the end-game reveal ----
function show(o: string, title: string) {
  const room = samples[o];
  if (!room) { console.log(`\n(no ${o} sample captured)\n`); return; }
  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`  SAMPLE — ${title}  (${alivePlayers(room).length} left alive of ${room.players.length - 1})`);
  console.log(`════════════════════════════════════════════════════════════`);
  console.log(`\n👁️  GOD'S EYE — the truth, night by night:`);
  for (const n of room.godLog) {
    console.log(`   🌙 Night ${n.day}`);
    for (const l of n.lines) console.log(`      ${l}`);
  }
  const ended = room.log.filter((e) => e.phase === "ended").map((e) => e.text);
  console.log(`\n🏁 END-GAME:`);
  console.log("   " + (ended[0] ?? "")); // headline
  const roll = ended.find((t) => /Victory to/.test(t));
  if (roll) console.log("   " + roll);
}

show("psycho", "🪓 PSYCHO KILLER wins (last lone wolf standing / parity)");
show("mafia", "💀 KILLERS win (Psycho cleared, then parity)");
show("town", "🎉 TOWN wins (all killers incl. Psycho eliminated)");
show("lovers", "💞 LOVERS win (cross-team couple)");
show("jester", "🤡 JESTER wins (banished)");

console.log("");
