// ============================================================================
// Pure, in-memory unit tests for the game engine. These exercise engine.ts
// directly over a Room object — NO Firestore, NO network, NO quota cost — so
// they run in milliseconds and can be used freely after any change.
//
//   npm test
//
// (Driven with Node's built-in test runner + tsx for TS/path-alias support.)
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  createRoom,
  startGame,
  canStart,
  submitNightAction,
  advanceNight,
  openVote,
  submitVote,
  submitChoice,
  resolveDay,
  resolveChoice,
  nightSteps,
  checkWinner,
  buildView,
  hostSkip,
  allVotesIn,
  type Room,
} from "@/game/engine";
import type { Player } from "@/lib/types";

/* ------------------------------- harness --------------------------------- */

function host(): Player {
  return { id: "god", name: "God", isHost: true, connected: true, alive: true, roleId: null };
}

const P = (room: Room, id: string) => room.players.find((p) => p.id === id)!;
const isAlive = (room: Room, id: string) => P(room, id).alive;
const deadCount = (room: Room, ids: string[]) => ids.filter((id) => !isAlive(room, id)).length;

// Build a started room with players whose roles are assigned DETERMINISTICALLY
// (startGame initializes all round state, then we overwrite the random deal).
// `roles` maps player-name → roleId; the player's id is their name.
function setup(roles: Record<string, string>): Room {
  const room = createRoom("TEST", host());
  for (const name of Object.keys(roles)) {
    room.players.push({ id: name, name, isHost: false, connected: true, alive: true, roleId: null });
  }
  const config: Record<string, number> = {};
  for (const r of Object.values(roles)) config[r] = (config[r] ?? 0) + 1;
  room.config = config as Room["config"];
  startGame(room); // phase=night, day=1, fresh state + random deal
  for (const [name, r] of Object.entries(roles)) P(room, name).roleId = r; // pin roles
  return room;
}

// Add N+1 plain seats (host + n players) to a fresh lobby, for canStart tests.
function lobby(n: number): Room {
  const room = createRoom("TEST", host());
  for (let i = 0; i < n; i++)
    room.players.push({ id: `p${i}`, name: `p${i}`, isHost: false, connected: true, alive: true, roleId: null });
  return room;
}

// Step through the whole night, submitting each player's action. submitNightAction
// only registers an action when it's that role's current step, so attempting every
// action at every step is safe — only the right ones stick.
function runNight(room: Room, actions: Record<string, string[]>): void {
  let guard = 0;
  while (room.phase === "night" && guard++ < 40) {
    for (const [pid, targets] of Object.entries(actions)) submitNightAction(room, pid, targets);
    advanceNight(room);
  }
}

// Get to a fresh day. A night where everyone skips kills no one and opens the day.
function reachDay(room: Room): void {
  if (room.phase === "night") runNight(room, {});
}

// Open the vote and cast a player-vote round, then resolve it.
function dayVote(room: Room, votes: Record<string, string | null>): void {
  reachDay(room);
  openVote(room);
  for (const [pid, t] of Object.entries(votes)) submitVote(room, pid, t);
  resolveDay(room);
}

/* ------------------------------- dealing --------------------------------- */

test("startGame deals exactly the configured roles to the players (host gets none)", () => {
  const room = createRoom("TEST", host());
  for (const id of ["a", "b", "c", "d", "e"])
    room.players.push({ id, name: id, isHost: false, connected: true, alive: true, roleId: null });
  room.config = { killer: 1, doctor: 1, police: 1, villager: 2 } as Room["config"];

  startGame(room);

  assert.equal(room.phase, "night");
  assert.equal(room.day, 1);
  assert.equal(P(room, "god").roleId, null, "host stays role-less");

  const dealt = room.players.filter((p) => !p.isHost).map((p) => p.roleId);
  assert.equal(dealt.length, 5);
  assert.ok(dealt.every((r) => r && r !== null), "every player got a role");

  // The multiset of dealt roles equals the config.
  const tally: Record<string, number> = {};
  for (const r of dealt) tally[r!] = (tally[r!] ?? 0) + 1;
  assert.deepEqual(tally, { killer: 1, doctor: 1, police: 1, villager: 2 });
  assert.ok(room.players.filter((p) => !p.isHost).every((p) => p.alive));
});

/* ------------------------------ validation ------------------------------- */

test("canStart enforces the lobby rules", () => {
  let r = lobby(2);
  r.config = { killer: 1, villager: 1 } as Room["config"];
  assert.match(canStart(r)!, /at least 3/i, "needs 3+ players");

  r = lobby(4);
  r.config = { killer: 1, villager: 2 } as Room["config"]; // totals 3, not 4
  assert.match(canStart(r)!, /must equal/i, "role count must equal players");

  r = lobby(4);
  r.config = { villager: 4 } as Room["config"];
  assert.match(canStart(r)!, /Killer/i, "needs a killer-side role");

  r = lobby(4);
  r.config = { killer: 2, villager: 2 } as Room["config"]; // killers*2 == players
  assert.match(canStart(r)!, /Too many Killers/i, "killers can't start at parity");

  r = lobby(6);
  r.config = { cupid: 2, killer: 1, villager: 3 } as Room["config"];
  assert.match(canStart(r)!, /one Cupid/i, "at most one cupid");

  r = lobby(4);
  r.config = { killer: 1, villager: 3 } as Room["config"];
  assert.equal(canStart(r), null, "a balanced config is allowed");
});

/* ----------------------------- killers' kill ----------------------------- */

test("the Killers make exactly ONE kill even with several of them", () => {
  const room = setup({ K1: "killer", K2: "godfather", V1: "villager", V2: "villager", V3: "villager" });
  runNight(room, { K1: ["V1"], K2: ["V1"] }); // both agree
  assert.equal(isAlive(room, "V1"), false, "the agreed target dies");
  assert.equal(deadCount(room, ["V1", "V2", "V3"]), 1, "only one victim total");
});

test("a split Killer vote still kills exactly one (plurality, random tiebreak)", () => {
  const room = setup({ K1: "killer", K2: "godfather", V1: "villager", V2: "villager", V3: "villager" });
  runNight(room, { K1: ["V1"], K2: ["V2"] }); // disagree → one of them dies
  assert.equal(deadCount(room, ["V1", "V2"]), 1, "exactly one of the two dies, not both");
});

/* ------------------------------- doctor ---------------------------------- */

test("the Doctor's heal cancels the Killers' kill", () => {
  const room = setup({ K: "killer", D: "doctor", V1: "villager", V2: "villager" });
  runNight(room, { K: ["V1"], D: ["V1"] });
  assert.equal(isAlive(room, "V1"), true, "healed target survives");
  assert.equal(deadCount(room, ["V1", "V2"]), 0, "no one dies");
});

/* ------------------------------- police ---------------------------------- */

test("the Police learn a Killer is a Killer, but the Godfather reads innocent", () => {
  let room = setup({ C: "police", K: "killer", V1: "villager", V2: "villager" });
  runNight(room, { C: ["K"], K: ["V1"] });
  assert.match(room.privateMessages["C"] ?? "", /IS a Killer/i, "cop fingers the killer");

  room = setup({ C: "police", GF: "godfather", V1: "villager", V2: "villager" });
  runNight(room, { C: ["GF"], GF: ["V1"] });
  assert.match(room.privateMessages["C"] ?? "", /is NOT a Killer/i, "godfather fools the cop");
});

/* -------------------------------- witch ---------------------------------- */

test("the Witch's save cancels the attack and spends one of her two uses", () => {
  const room = setup({ K: "killer", W: "witch", V1: "villager", V2: "villager" });
  runNight(room, { K: ["V1"], W: ["V1"] });
  assert.equal(isAlive(room, "V1"), true, "the saved target survives");
  assert.equal(room.witchRevives["W"], 1, "one use spent");
});

test("the Witch stops being called once her 2 uses are spent", () => {
  const room = setup({ K: "killer", W: "witch", V1: "villager", V2: "villager" });
  room.witchRevives["W"] = 2;
  const labels = nightSteps(room).map((s) => s.label);
  assert.ok(!labels.includes("Witch"), "a spent Witch is no longer a night step");
});

/* ---------------------------- win conditions ----------------------------- */

test("the Town wins when the last Killer is voted out", () => {
  const room = setup({ K: "killer", V1: "villager", V2: "villager", V3: "villager" });
  dayVote(room, { K: "K", V1: "K", V2: "K", V3: "K" });
  assert.equal(room.phase, "ended");
  assert.equal(room.winner, "town");
});

test("the end-game chronicle replays the game and reveals every role", () => {
  const room = setup({ K: "killer", V1: "villager", V2: "villager", V3: "villager" });
  dayVote(room, { K: "K", V1: "K", V2: "K", V3: "K" }); // town wins (K banished)
  const ended = room.log.filter((e) => e.phase === "ended").map((e) => e.text).join("\n");
  assert.ok(/every mask comes off/i.test(ended), "the full-story chronicle is shown");
  assert.ok(/K \(.*Killer\)/.test(ended), "the Killer's role is revealed by name");
  assert.ok(/Villager/i.test(ended), "villagers' roles are revealed");
  assert.ok(/Night 1/i.test(ended), "the chronicle replays the night(s)");
});

test("the Killers win at parity, and the whole Killer team is named", () => {
  const room = setup({ K: "killer", GF: "godfather", V1: "villager", V2: "villager", V3: "villager" });
  runNight(room, { K: ["V1"], GF: ["V1"] }); // squad kill → K,GF vs V2,V3 = 2-vs-2 parity
  assert.equal(room.winner, "mafia");
  assert.equal(room.phase, "ended");
  const roll = room.log.find((e) => /Victory to the Killers/i.test(e.text));
  assert.ok(roll, "the Killer team is called out by name");
  assert.ok(/K/.test(roll!.text) && /GF/.test(roll!.text), "both Killers are named");
});

test("the Jester wins instantly if the town votes them out", () => {
  const room = setup({ J: "jester", K: "killer", V1: "villager", V2: "villager" });
  dayVote(room, { J: "J", K: "J", V1: "J", V2: "J" });
  assert.equal(room.phase, "ended");
  assert.equal(room.winner, "neutral");
});

/* -------------------------------- lovers --------------------------------- */

test("Lovers die together — a night kill of one kills the other", () => {
  const room = setup({ Cup: "cupid", K: "killer", L1: "villager", L2: "villager", V: "villager" });
  runNight(room, { Cup: ["L1", "L2"], K: ["L1"] });
  assert.equal(isAlive(room, "L1"), false);
  assert.equal(isAlive(room, "L2"), false, "the partner dies of the linked fate");
});

test("Lovers die together — lynching one kills the other of heartbreak", () => {
  const room = setup({ Cup: "cupid", K: "killer", L1: "villager", L2: "villager", V: "villager" });
  runNight(room, { Cup: ["L1", "L2"], K: [] }); // link the lovers, no night kill
  assert.equal(isAlive(room, "L1"), true);
  dayVote(room, { Cup: "L1", K: "L1", L1: "L1", L2: "L1", V: "L1" });
  assert.equal(isAlive(room, "L1"), false);
  assert.equal(isAlive(room, "L2"), false, "heartbreak kills the partner");
});

test("cross-team Lovers (Cop + Killer) win as the last two standing", () => {
  const room = setup({ Cup: "cupid", Cop: "police", K: "killer", V: "villager" });
  // Night 1: Cupid links the Cop (town) to the Killer (mafia); the Killer kills Cupid.
  runNight(room, { Cup: ["Cop", "K"], K: ["Cup"], Cop: ["V"] });
  assert.equal(room.phase, "day", "3 still alive (Cop, Killer, Villager) — no winner yet");
  // Day: the last bystander is voted out, leaving only the linked couple.
  dayVote(room, { Cop: "V", K: "V", V: "Cop" });
  assert.equal(isAlive(room, "V"), false);
  assert.equal(room.winner, "lovers", "the cross-team couple win their forbidden victory");
  assert.equal(room.phase, "ended");
});

test("a Jester linked as a Lover counts as cross-team and can win via the couple", () => {
  const room = setup({ Cup: "cupid", J: "jester", V: "villager", K: "killer" });
  // Cupid links the Jester (neutral) to a Villager (town); the Killer kills Cupid.
  runNight(room, { Cup: ["J", "V"], K: ["Cup"] });
  assert.equal(room.phase, "day", "J, V, K still alive — no winner yet");
  // Vote out the Killer, leaving only the Jester + Villager couple.
  dayVote(room, { J: "K", V: "K", K: "J" });
  assert.equal(room.winner, "lovers", "Jester (neutral) + Villager (town) win as a cross-team couple");
});

/* --------------------------------- item ---------------------------------- */

test("the Item dies if it spends the night with a Killer", () => {
  const room = setup({ K: "killer", I: "item", V1: "villager", V2: "villager" });
  runNight(room, { K: ["V1"], I: ["K"] });
  assert.equal(isAlive(room, "I"), false, "visiting a Killer is fatal");
});

test("the Item dies with the person it visits if that person dies that night", () => {
  const room = setup({ K: "killer", I: "item", V1: "villager", V2: "villager" });
  runNight(room, { K: ["V1"], I: ["V1"] });
  assert.equal(isAlive(room, "V1"), false);
  assert.equal(isAlive(room, "I"), false, "the Item shares its host's fate");
});

/* --------------------------- psycho → vigilante --------------------------- */

test("a Doctor-healed Psycho secretly becomes a Vigilante", () => {
  const room = setup({ P: "psycho", K: "killer", Dr: "doctor", V1: "villager", V2: "villager" });
  runNight(room, { K: ["V1"], Dr: ["P"] }); // psycho skips, doctor heals the psycho
  assert.equal(P(room, "P").roleId, "vigilante", "the Psycho transformed");
});

/* ---------------------- psycho = neutral lone wolf ----------------------- */

test("the Killers can't win while a Psycho is alive — even at numerical parity", () => {
  // 2 Killers + 1 Villager + 1 Psycho: 2-v-2, but the Psycho is a live threat that
  // blocks the Killers' win — they must take him out first.
  const room = setup({ K: "killer", GF: "godfather", P: "psycho", V1: "villager" });
  assert.equal(checkWinner(room), null, "the Psycho blocks the Killers' parity win");
  P(room, "P").alive = false; // remove the Psycho → now it's a clean 2-v-1 mafia parity
  assert.equal(checkWinner(room), "mafia", "with the Psycho gone, the Killers win at parity");
});

test("the lone-wolf Psycho wins at parity (1-v-1) and as the last one standing", () => {
  const room = setup({ P: "psycho", K: "killer", V1: "villager", V2: "villager" });
  // Down to the Psycho + one Villager → the Psycho takes the 1-v-1.
  for (const id of ["K", "V1"]) P(room, id).alive = false;
  assert.equal(checkWinner(room), "neutral", "Psycho wins 1-v-1");
  P(room, "V2").alive = false; // truly last standing
  assert.equal(checkWinner(room), "neutral", "Psycho wins as the last soul alive");
});

test("the Town can't win while the Psycho lives, but wins once he's gone", () => {
  const room = setup({ P: "psycho", K: "killer", V1: "villager", V2: "villager" });
  P(room, "K").alive = false; // mafia gone, but the Psycho still prowls
  assert.equal(checkWinner(room), null, "no Town win while the Psycho is alive");
  P(room, "P").alive = false; // now every killer (mafia + Psycho) is gone
  assert.equal(checkWinner(room), "town", "the Town wins once the Psycho is dead too");
});

test("a Vigilante who shoots the Psycho kills him and does NOT backfire", () => {
  const room = setup({ Vig: "vigilante", P: "psycho", K: "killer", V1: "villager", V2: "villager" });
  runNight(room, { Vig: ["P"] }); // the Vigilante shoots the lone-wolf Psycho
  assert.equal(isAlive(room, "P"), false, "the Psycho is shot dead");
  assert.equal(isAlive(room, "Vig"), true, "shooting a real killer carries no penalty");
});

test("the Item dies if it spends the night with the Psycho (a killer)", () => {
  const room = setup({ P: "psycho", I: "item", K: "killer", V1: "villager", V2: "villager" });
  runNight(room, { I: ["P"], K: ["V1"] });
  assert.equal(isAlive(room, "I"), false, "visiting the Psycho is fatal — he's a killer");
});

test("the Police read the Psycho as a Killer", () => {
  const room = setup({ Cop: "police", P: "psycho", K: "killer", V1: "villager", V2: "villager" });
  runNight(room, { Cop: ["P"], K: ["V1"] });
  assert.match(room.privateMessages["Cop"] ?? "", /IS a Killer/i, "the lone wolf still reads as a Killer");
});

test("two different neutrals (Psycho + Jester) are NOT a team — linked, they win as cross-team Lovers", () => {
  // Cupid links the Psycho and the Jester. They're independent factions-of-one,
  // so the couple counts as cross-team and can take the Lovers' win as the last two.
  const room = setup({ Cup: "cupid", P: "psycho", J: "jester", K: "killer" });
  runNight(room, { Cup: ["P", "J"], K: ["Cup"] }); // link P+J, Killer kills Cupid
  assert.equal(room.phase, "day", "P, J, K still alive — no winner yet");
  dayVote(room, { P: "K", J: "K", K: "P" }); // banish the Killer → only linked P + J remain
  assert.equal(room.winner, "lovers", "the Psycho+Jester couple win as cross-team Lovers");
});

test("a Jester banish win names only the Jester — not a Psycho who's also neutral", () => {
  // Both Jester and Psycho are team "neutral"; banishing the Jester must not
  // credit the (also-neutral) Psycho on the victory roll.
  const room = setup({ J: "jester", P: "psycho", K: "killer", V1: "villager", V2: "villager" });
  dayVote(room, { J: "J", P: "J", K: "J", V1: "J", V2: "J" }); // town banishes the Jester
  assert.equal(room.winner, "neutral");
  const roll = room.log.find((e) => /Victory to/i.test(e.text))!;
  assert.match(roll.text, /Jester/i, "the Jester is named");
  assert.ok(!/P\b/.test(roll.text.replace(/Jester/gi, "")), "the Psycho (P) is NOT listed as a co-winner");
});

/* --------------------------- panchayat immunity --------------------------- */

test("the Panchayat is immune to night kills while a Cupid lives, but lynchable", () => {
  const room = setup({ K: "killer", PT: "panchayath", Cup: "cupid", V1: "villager", V2: "villager" });
  runNight(room, { Cup: ["V1", "V2"], K: ["PT"] });
  assert.equal(isAlive(room, "PT"), true, "Killers can't touch the Panchayat while Cupid lives");

  dayVote(room, { K: "PT", PT: "PT", Cup: "PT", V1: "PT", V2: "PT" });
  assert.equal(isAlive(room, "PT"), false, "the day vote can still remove the Panchayat");
});

/* ----------------------------- voting / ties ----------------------------- */

test("a 2–2 tie opens the choice stage, and a Skip majority spares everyone", () => {
  const room = setup({ A: "killer", B: "villager", C: "villager", D: "villager" });
  reachDay(room);
  openVote(room);
  submitVote(room, "A", "B");
  submitVote(room, "B", "A");
  submitVote(room, "C", "B");
  submitVote(room, "D", "A"); // A=2, B=2 → tie
  resolveDay(room);
  assert.equal(room.voteStage, "choice");
  assert.deepEqual(new Set(room.tiedCandidates), new Set(["A", "B"]));

  submitChoice(room, "A", "skip");
  submitChoice(room, "B", "skip");
  submitChoice(room, "C", "skip");
  submitChoice(room, "D", "skip");
  resolveChoice(room);
  assert.equal(deadCount(room, ["A", "B", "C", "D"]), 0, "Skip eliminates no one");
  assert.equal(room.voteStage, "done");
});

/* ----------------------- elimination reveals the role -------------------- */

test("a day banishment does NOT reveal the victim's role (full mystery)", () => {
  const room = setup({ K: "killer", V1: "villager", V2: "villager", V3: "villager" });
  // Banish a villager so the game continues and we can inspect the banish log.
  dayVote(room, { K: "V1", V1: "V1", V2: "V1", V3: "V1" });
  assert.equal(isAlive(room, "V1"), false, "the voted player is banished");
  const banishLog = room.log.find((e) => /drives|cast out|banished|run out/i.test(e.text));
  assert.ok(banishLog, "a banishment is narrated");
  assert.ok(!/villager/i.test(banishLog!.text), "the banished player's role is NOT named");
});

test("NO role word ever appears in the in-game story — only at game end", () => {
  const room = setup({ K: "killer", Cup: "cupid", I: "item", V1: "villager", V2: "villager", V3: "villager", V4: "villager" });
  runNight(room, { Cup: ["V1", "V2"], K: ["V3"], I: ["K"] }); // V3 killed; the Item dies visiting a Killer
  dayVote(room, { K: "V1", Cup: "V1", V1: "V1", V2: "V1", V4: "V1" }); // banish V1 (a Lover) → V2 dies of the bond
  const ROLE = /\b(Killer|Godfather|Psycho|Police|Doctor|Cupid|Panchayat|Item|Witch|Jester|Villager|Vigilante|Lover)\b/i;
  for (const e of room.log.filter((e) => e.phase !== "ended"))
    assert.ok(!ROLE.test(e.text), `role leaked mid-game: "${e.text}"`);
});

/* ----------------------------- AFK / God skip ---------------------------- */

test("the God can skip a stalling voter to complete the day vote", () => {
  const room = setup({ K: "killer", V1: "villager", V2: "villager", V3: "villager" });
  reachDay(room);
  openVote(room);
  submitVote(room, "K", "K");
  submitVote(room, "V1", "K");
  submitVote(room, "V2", "K"); // V3 is AFK
  assert.equal(allVotesIn(room), false, "vote incomplete while V3 hasn't voted");
  hostSkip(room, "V3");
  assert.equal(allVotesIn(room), true, "skipping the AFK player completes the tally");
  resolveDay(room);
  assert.equal(isAlive(room, "K"), false, "the vote resolves and the Killer is banished");
});

test("the God can skip an AFK night actor (recorded as held back)", () => {
  const room = setup({ K: "killer", Dr: "doctor", V1: "villager", V2: "villager" });
  hostSkip(room, "K");
  assert.deepEqual(room.nightActions["K"], [], "the Killer is marked as held back");
});

/* ------------------------------- privacy --------------------------------- */

test("buildView hides other players' roles from a player, but not from the host", () => {
  const room = setup({ K: "killer", D: "doctor", V1: "villager", V2: "villager" });

  const playerView = buildView(room, "D");
  assert.equal(playerView.you.roleId, "doctor", "you always see your own role");
  assert.ok(playerView.players.every((p) => p.roleId === null), "others' roles are hidden mid-game");

  const hostView = buildView(room, "god");
  assert.ok(hostView.players.some((p) => p.roleId !== null), "the God sees every role");
});
