// ============================================================================
// GAME ENGINE  —  in-memory Room state + all game logic. The socket layer
// (server.ts) owns the rooms and calls into these functions.
// ============================================================================

import type {
  ActionPrompt,
  HostStatus,
  LogEntry,
  NightBoardEntry,
  Phase,
  Player,
  PublicPlayer,
  RoleConfig,
  RoomView,
  Team,
  Winner,
} from "@/lib/types";
import {
  freshRoleState,
  getRole,
  nightRolesInOrder,
  ROLES,
  type NightContext,
  type RoleState,
} from "./roles";

// Full server-side room state (never sent verbatim to clients).
export interface Room {
  code: string;
  hostId: string;
  phase: Phase;
  day: number;
  players: Player[];
  config: RoleConfig;
  log: LogEntry[];
  winner: Winner | null;
  // Submitted night actions this phase: playerId -> chosen target ids.
  nightActions: Record<string, string[]>;
  // Which night role-group the host is currently calling (index into nightSteps).
  nightStep: number;
  // Submitted day votes this phase: voterId -> targetId|null.
  votes: Record<string, string | null>;
  // Day-vote sub-stage + tiebreak bookkeeping.
  voteStage: VoteStage;
  tiedCandidates: string[];
  choiceVotes: Record<string, string>; // voterId -> "skip" | "revote"
  // Private results to surface to specific players (reset as phases turn over).
  privateMessages: Record<string, string>;
  // Persistent whole-game role state (lovers, item visits, …).
  roleState: RoleState;
  // Death groups computed for the night, awaiting the Witch's decision.
  deathGroups: DeathGroup[] | null;
  // witchPlayerId -> number of revives used.
  witchRevives: Record<string, number>;
  // Chat history per channel + a monotonic id counter.
  chat: { town: ChatMessage[]; killers: ChatMessage[] };
  chatSeq: number;
  // A hidden record of everything that happened — every night action, death, and
  // banishment — replayed (with all roles revealed) only when the game ends.
  chronicle: ChronicleScene[];
}

export type ChronicleScene =
  | {
      k: "night";
      day: number;
      acts: { name: string; roleId: string | null; targets: string[] }[];
      deaths: { name: string; roleId: string | null; cause: string }[];
    }
  | { k: "banish"; day: number; name: string; roleId: string | null }
  | { k: "bond"; day: number; name: string; roleId: string | null };

export type VoteStage =
  | "discussion"
  | "vote"
  | "choice"
  | "godchoice"
  | "revote"
  | "done";

// A stored chat message (server-side; the sender is hidden when sent to players).
export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no easily-confused chars

export function makeRoomCode(existing: Set<string>): string {
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 4; i++) {
      code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
  } while (existing.has(code));
  return code;
}

export function createRoom(code: string, host: Player): Room {
  return {
    code,
    hostId: host.id,
    phase: "lobby",
    day: 0,
    players: [host],
    config: defaultConfig(),
    log: [],
    winner: null,
    nightActions: {},
    nightStep: 0,
    votes: {},
    voteStage: "vote",
    tiedCandidates: [],
    choiceVotes: {},
    privateMessages: {},
    roleState: freshRoleState(),
    deathGroups: null,
    witchRevives: {},
    chat: { town: [], killers: [] },
    chatSeq: 0,
    chronicle: [],
  };
}

export function defaultConfig(): RoleConfig {
  return { killer: 1, police: 1, cupid: 1, villager: 2 };
}

// ---- helpers ----

export function alivePlayers(room: Room): Player[] {
  return room.players.filter((p) => p.alive && !p.isHost);
}

function roleOf(room: Room, playerId: string): string | null {
  return room.players.find((p) => p.id === playerId)?.roleId ?? null;
}

function teamOf(room: Room, playerId: string): Team | null {
  return getRole(roleOf(room, playerId))?.team ?? null;
}

function apparentTeamOf(room: Room, playerId: string): Team | null {
  const r = getRole(roleOf(room, playerId));
  return r?.apparentTeam ?? r?.team ?? null;
}

function nameOf(room: Room, playerId: string): string {
  return room.players.find((p) => p.id === playerId)?.name ?? "Unknown";
}

function get(room: Room, playerId: string): Player | undefined {
  return room.players.find((p) => p.id === playerId);
}

function aliveWithRole(room: Room, roleId: string): Player[] {
  return alivePlayers(room).filter((p) => p.roleId === roleId);
}

function isCupidAlive(room: Room): boolean {
  return aliveWithRole(room, "cupid").length > 0;
}

function totalRoles(config: RoleConfig): number {
  return Object.values(config).reduce((a, b) => a + b, 0);
}

// ---- starting a game ----

export function canStart(room: Room): string | null {
  if (room.phase !== "lobby") return "Game already in progress.";
  const total = totalRoles(room.config);
  const playerCount = room.players.filter((p) => !p.isHost).length;
  if (playerCount < 3) return "Need at least 3 players (besides the host).";
  if (total !== playerCount)
    return `Role count (${total}) must equal the number of players (${playerCount}).`;
  const killers = Object.entries(room.config).reduce(
    (sum, [id, n]) => sum + (getRole(id)?.team === "mafia" ? n : 0),
    0
  );
  if (killers < 1) return "Need at least 1 Killer-aligned role.";
  if (killers * 2 >= playerCount) return "Too many Killers for the player count.";
  if ((room.config.cupid ?? 0) > 1) return "Use at most one Cupid.";
  return null;
}

export function startGame(room: Room): void {
  const deck: string[] = [];
  for (const [roleId, count] of Object.entries(room.config)) {
    for (let i = 0; i < count; i++) deck.push(roleId);
  }
  shuffle(deck);

  const recipients = room.players.filter((p) => !p.isHost);
  recipients.forEach((p, i) => {
    p.roleId = deck[i] ?? "villager";
    p.alive = true;
  });

  room.phase = "night";
  room.day = 1;
  room.nightActions = {};
  room.nightStep = 0;
  room.votes = {};
  room.voteStage = "vote";
  room.tiedCandidates = [];
  room.choiceVotes = {};
  room.privateMessages = {};
  room.roleState = freshRoleState();
  room.deathGroups = null;
  room.witchRevives = {};
  room.chat = { town: [], killers: [] };
  room.chatSeq = 0;
  room.chronicle = [];
  room.winner = null;
  room.log = [{ phase: "night", day: 1, text: "🌙 Night 1 falls. The town sleeps..." }];
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ---- night phase ----

function actsTonight(room: Room, player: Player): boolean {
  const r = getRole(player.roleId);
  if (!r?.night) return false;
  if (r.night.firstNightOnly && room.day !== 1) return false;
  // "Alternate nights" = active only on odd-numbered nights (1, 3, 5, …).
  if (r.night.everyOtherNight && room.day % 2 === 0) return false;
  // Limited-use roles (the Witch, 2 saves) stop acting once spent.
  if (r.night.maxUses != null && (room.witchRevives[player.id] ?? 0) >= r.night.maxUses)
    return false;
  return true;
}

// Players who must submit a chosen night action this night.
export function pendingNightActors(room: Room): Player[] {
  return alivePlayers(room).filter((p) => actsTonight(room, p));
}

// The host steps through the night one role-group at a time, in this order.
// NOTE: the attackers (Killers / Psycho / Vigilante) MUST come before the Witch,
// since she's shown who was attacked tonight. The Doctor & Police can be called
// any time — their resolution priority lives in roles.ts (`night.order`), not here.
const NIGHT_STEPS: { label: string; emoji: string; roles: string[] }[] = [
  { label: "Cupid", emoji: "💘", roles: ["cupid"] },
  { label: "Killers", emoji: "🔪", roles: ["killer", "godfather"] },
  { label: "Psycho Killer", emoji: "🪓", roles: ["psycho"] },
  { label: "Vigilante", emoji: "🔫", roles: ["vigilante"] },
  { label: "Item", emoji: "🎲", roles: ["item"] },
  { label: "Witch", emoji: "🧙", roles: ["witch"] }, // after the attackers — she sees the attacks
  { label: "Doctor", emoji: "🩺", roles: ["doctor"] },
  { label: "Police", emoji: "🚓", roles: ["police"] }, // last
];

// The steps actually in play tonight (a role-group with ≥1 active alive member).
export function nightSteps(room: Room) {
  return NIGHT_STEPS.filter((s) =>
    alivePlayers(room).some(
      (p) => s.roles.includes(p.roleId ?? "") && actsTonight(room, p)
    )
  );
}

function currentStep(room: Room) {
  return nightSteps(room)[room.nightStep];
}

// Is it this player's turn to act right now (their role is the current step)?
function actsInCurrentStep(room: Room, player: Player): boolean {
  if (!actsTonight(room, player)) return false;
  const step = currentStep(room);
  return !!step && step.roles.includes(player.roleId ?? "");
}

export function submitNightAction(
  room: Room,
  playerId: string,
  targetIds: string[]
): void {
  if (room.phase !== "night") return;
  const player = get(room, playerId);
  if (!player || !player.alive || !actsInCurrentStep(room, player)) return;
  room.nightActions[playerId] = targetIds;
}

// Advance the host through the night: next role-group, or resolve on the last.
export function advanceNight(room: Room): void {
  if (room.phase !== "night") return;
  const steps = nightSteps(room);
  if (room.nightStep >= steps.length - 1) resolveNight(room);
  else room.nightStep += 1;
}

// Members of the role-group the host is currently calling who are still CONNECTED
// and alive but haven't submitted (nor skipped) yet. The God must not advance past
// them — doing so silently drops their action (e.g. the Killers' kill never lands).
// Disconnected players don't block (they can't act); the God can skip them via
// hostSkip, which records an explicit "held back".
export function currentStepBlockers(room: Room): Player[] {
  if (room.phase !== "night") return [];
  return alivePlayers(room).filter(
    (p) => p.connected && actsInCurrentStep(room, p) && !(p.id in room.nightActions)
  );
}

export function allNightActionsIn(room: Room): boolean {
  return pendingNightActors(room).every((p) => p.id in room.nightActions);
}

function buildNightContext(room: Room): NightContext {
  return {
    day: room.day,
    actions: room.nightActions,
    alivePlayerIds: alivePlayers(room).map((p) => p.id),
    roleOf: (id) => roleOf(room, id),
    teamOf: (id) => teamOf(room, id),
    apparentTeamOf: (id) => apparentTeamOf(room, id),
    nameOf: (id) => nameOf(room, id),
    state: room.roleState,
    protectedIds: new Set(),
    markedForDeath: new Set(),
    privateResults: {},
    vigilanteShots: {},
    itemTargets: {},
  };
}

// The Killers (Killer + Godfather) act as ONE squad: however many there are, they
// make a single kill per night — the most-chosen target (ties broken at random).
// (The Psycho Killer is a lone wolf and kills separately.)
function resolveKillers(room: Room, ctx: NightContext): void {
  const killers = alivePlayers(room).filter((p) =>
    ["killer", "godfather"].includes(p.roleId ?? "")
  );
  const counts: Record<string, number> = {};
  for (const k of killers) {
    const pick = room.nightActions[k.id]?.[0];
    if (pick) counts[pick] = (counts[pick] ?? 0) + 1;
  }
  const picks = Object.keys(counts);
  if (picks.length === 0) return; // no one chosen
  const max = Math.max(...picks.map((id) => counts[id]));
  const top = picks.filter((id) => counts[id] === max);
  ctx.markedForDeath.add(top[Math.floor(Math.random() * top.length)]);
}

// The Police act as one squad: tally every cop's pick, investigate the single
// most-chosen suspect (ties broken at random), and share the result with all cops.
function resolvePolice(room: Room, ctx: NightContext): void {
  const cops = aliveWithRole(room, "police");
  if (cops.length === 0) return;

  const counts: Record<string, number> = {};
  for (const cop of cops) {
    const pick = room.nightActions[cop.id]?.[0];
    if (pick) counts[pick] = (counts[pick] ?? 0) + 1;
  }
  const picks = Object.keys(counts);
  if (picks.length === 0) return; // the whole squad skipped

  const max = Math.max(...picks.map((id) => counts[id]));
  const top = picks.filter((id) => counts[id] === max);
  const targetId = top[Math.floor(Math.random() * top.length)];

  const looksKiller = apparentTeamOf(room, targetId) === "mafia";
  const verdict = `🚓 ${nameOf(room, targetId)} ${
    looksKiller ? "IS a Killer." : "is NOT a Killer."
  }`;
  const note =
    cops.length > 1 ? " (your squad's joint check this night)" : "";
  for (const cop of cops) ctx.privateResults[cop.id] = verdict + note;
}

// A death and everyone bound to it (Lovers / a cursed Item). The Witch sees only
// the `primary`; reviving the primary brings the whole group back, and if it's
// not revived the whole group dies together.
export interface DeathGroup {
  primary: string;
  members: string[];
}

// Decide who dies, applying immunity, the Item's curse, and Lovers' linked fate.
// Returns death GROUPS so bound deaths (lovers, cursed item) act as one unit.
function computeDeaths(
  room: Room,
  ctx: NightContext,
  itemTargets: Record<string, string>
): DeathGroup[] {
  const cupidAlive = isCupidAlive(room);

  // groups[i] = { primary, members:Set }; owner maps a player to its group index.
  const groups: { primary: string; members: Set<string> }[] = [];
  const owner: Record<string, number> = {};
  const isDead = (id: string) => id in owner;
  const aliveNow = (id: string) => !!get(room, id)?.alive;

  const seed = (primary: string) => {
    if (isDead(primary)) return;
    owner[primary] = groups.length;
    groups.push({ primary, members: new Set([primary]) });
  };
  // Bind `dep` into the group that already contains `anchor`.
  const bind = (anchor: string, dep: string) => {
    const gi = owner[anchor];
    if (gi == null || isDead(dep)) return;
    groups[gi].members.add(dep);
    owner[dep] = gi;
  };

  // 1. Base kills (Killer / Godfather / Psycho) — each is its own primary.
  for (const id of ctx.markedForDeath) {
    if (ctx.protectedIds.has(id) || !aliveNow(id)) continue;
    // Panchayat Thalaivar is untouchable by Killers while a Cupid lives.
    if (roleOf(room, id) === "panchayath" && cupidAlive) continue;
    seed(id);
  }

  // 2. Vigilante shots: the target dies (unless healed); shooting a non-Killer
  //    also kills the Vigilante. Both are their own primaries.
  for (const [shooterId, targetId] of Object.entries(ctx.vigilanteShots)) {
    if (!aliveNow(shooterId)) continue;
    if (aliveNow(targetId) && !ctx.protectedIds.has(targetId)) seed(targetId);
    if (teamOf(room, targetId) !== "mafia") seed(shooterId);
  }

  // 3. Item drawn to a Killer dies on its own (a standalone primary).
  for (const [itemId, targetId] of Object.entries(itemTargets)) {
    if (!aliveNow(itemId)) continue;
    if (teamOf(room, targetId) === "mafia") seed(itemId);
  }

  // 4. Propagate the links to a fixpoint: a cursed Item joins the group of the
  //    person it was drawn to (if they died), and a Lover joins their partner's
  //    group. Bound deaths never become their own revive option.
  const lovers = room.roleState.lovers;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [itemId, targetId] of Object.entries(itemTargets)) {
      if (!aliveNow(itemId) || isDead(itemId)) continue;
      if (teamOf(room, targetId) !== "mafia" && isDead(targetId)) {
        bind(targetId, itemId);
        changed = true;
      }
    }
    if (lovers) {
      const [a, b] = lovers;
      if (isDead(a) && !isDead(b) && aliveNow(b)) { bind(a, b); changed = true; }
      if (isDead(b) && !isDead(a) && aliveNow(a)) { bind(b, a); changed = true; }
    }
  }

  return groups.map((g) => ({ primary: g.primary, members: [...g.members] }));
}

// Players the attackers (Killers / Godfather / Psycho / Vigilante) targeted this
// night — what the Witch is shown when she's called.
function attackedTonight(room: Room): string[] {
  const attackers = ["killer", "godfather", "psycho", "vigilante"];
  const set = new Set<string>();
  for (const p of alivePlayers(room)) {
    if (attackers.includes(p.roleId ?? ""))
      for (const t of room.nightActions[p.id] ?? []) set.add(t);
  }
  return [...set];
}

// Snapshot what every called role did tonight (target names), for the end chronicle.
function buildNightActs(room: Room) {
  const order: Record<string, number> = {};
  NIGHT_STEPS.forEach((s, i) => s.roles.forEach((r) => (order[r] = i)));
  return pendingNightActors(room)
    .map((p) => ({
      name: p.name,
      roleId: p.roleId,
      targets: (room.nightActions[p.id] ?? []).map((id) => nameOf(room, id)),
    }))
    .sort((a, b) => (order[a.roleId ?? ""] ?? 99) - (order[b.roleId ?? ""] ?? 99));
}

// How a role's night action reads in the end-game chronicle.
function actLine(roleId: string | null, targets: string[]): string {
  if (!targets.length) return "kept still and did nothing";
  const t = targets;
  switch (roleId) {
    case "killer":
    case "godfather": return `moved to kill ${t[0]}`;
    case "psycho": return `crept out and struck at ${t[0]}`;
    case "vigilante": return `took aim at ${t[0]}`;
    case "police": return `investigated ${t[0]}`;
    case "doctor": return `watched over ${t[0]}`;
    case "item": return `spent the night with ${t[0]}`;
    case "witch": return `cast a protection over ${t[0]}`;
    case "cupid": return `bound ${t.join(" & ")} together as lovers`;
    default: return `chose ${t.join(", ")}`;
  }
}

// Resolve the night (after the God has stepped through every role, incl. the Witch).
export function resolveNight(room: Room): void {
  if (room.phase !== "night") return;
  const ctx = buildNightContext(room);
  const acts = buildNightActs(room); // capture before resolution (roles pre-transform)

  // Run each chosen night action in priority order (the Witch's save adds to
  // protectedIds here, just like the Doctor — she never learns of the heal).
  for (const roleDef of nightRolesInOrder()) {
    if (roleDef.night?.firstNightOnly && room.day !== 1) continue;
    if (roleDef.night?.everyOtherNight && room.day % 2 === 0) continue;
    for (const actor of aliveWithRole(room, roleDef.id)) {
      roleDef.resolve?.(actor.id, room.nightActions[actor.id] ?? [], ctx);
    }
  }

  // The Killers' single shared kill + the Police squad's single shared check.
  resolveKillers(room, ctx);
  resolvePolice(room, ctx);

  // A Witch who chose to save someone spends one of her two uses.
  for (const w of aliveWithRole(room, "witch")) {
    if ((room.nightActions[w.id] ?? []).length > 0)
      room.witchRevives[w.id] = (room.witchRevives[w.id] ?? 0) + 1;
  }

  // Surface private results (Police findings, Cupid's love notes).
  room.privateMessages = { ...ctx.privateResults };

  // The Item's chosen visit + the night's death groups.
  const groups = computeDeaths(room, ctx, ctx.itemTargets);

  // A Psycho Killer healed by the Doctor (or saved by the Witch) secretly
  // becomes a Vigilante.
  for (const psycho of aliveWithRole(room, "psycho")) {
    if (ctx.protectedIds.has(psycho.id)) {
      psycho.roleId = "vigilante";
      room.privateMessages[psycho.id] =
        "🪓 → 🔫 The Doctor's care has changed something in you. You are now a Vigilante — hunt the Killers.";
    }
  }

  finalizeNight(room, groups, acts);
}

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// Spine-chilling, role-agnostic death causes — one assigned to each night victim.
const DEATH_CAUSES = [
  "was found torn apart, scattered across the square",
  "was drained of every last drop of blood",
  "was found with eyes frozen wide in terror",
  "was discovered hanging cold from the old oak",
  "was gutted and left for the crows",
  "was clawed to ribbons in the night",
  "was strangled — the marks still purple on their throat",
  "was poisoned, froth dried at their lips",
  "vanished, leaving only a dark, wet stain on the floor",
  "was dragged from the well, bloated and pale",
  "was burned down to a blackened husk",
  "was stabbed so many times the blade snapped",
  "was found with their heart carved clean out",
  "screamed once before dawn — then only bones were left",
  "was found smiling, throat cut ear to ear",
  "rotted overnight, as if months had passed in hours",
  "was dragged into the dark, nails scraping the floorboards",
  "was left bled white, two neat punctures at the neck",
  "was found kneeling in prayer — and missing their head",
  "was crushed by something no one will name",
  "was found with their fingernails torn out, clawing at the door",
  "drowned in their own bed, lungs full of black water",
  "was split open from throat to navel",
  "was left as a pile of ash in the shape of a person",
  "was nailed to the barn wall, long cold",
  "was found with their mouth sewn shut and their eyes gone",
  "was peeled and left out in the frost",
  "had every bone broken, folded into a shape no body should make",
  "was frozen solid in the middle of summer",
  "was hollowed out — nothing left inside the skin",
  "was found whispering to the wall, then fell silent forever",
  "was bitten clean through, the wound far too wide for any man",
  "was found pinned to the earth by their own shadow",
  "choked on soil, mouth and throat packed with grave-dirt",
  "was unstitched at every seam, as if something crawled out",
  "was found with claw marks climbing the wall above the bed",
  "was turned inside out, neat as a peeled glove",
  "was found facedown in a broken circle of salt",
  "was torn open from the inside, ribs bent outward",
  "was dragged beneath the floorboards — only the fingertips remained",
  "drowned on dry land, water still filling their lungs",
  "was found grey and shrivelled, decades older than they slept",
  "was bled into the soil until the whole garden ran red",
  "was found locked in from the inside — and not alone",
  "was reduced to a dark smear and a single shoe",
  "was found staring up, jaw locked open in a soundless scream",
  "had the breath stolen clean out of them, lips gone blue",
  "was found with their reflection still moving in the glass",
  "was hollowed by the cold, frost blooming from the wound",
];

// Assign each victim a distinct cause — reused for the morning text AND stored in
// the end-game chronicle so the two always agree.
function assignCauses(names: string[]): { name: string; cause: string }[] {
  const pool = [...DEATH_CAUSES];
  return names.map((name) => {
    const i = Math.floor(Math.random() * pool.length);
    const cause = pool.splice(i, 1)[0] ?? pick(DEATH_CAUSES);
    return { name, cause };
  });
}

// Flavourful, spine-chilling morning narration. CRITICAL: it must NEVER hint at the
// victim's role — every line is a generic gruesome fate that fits any player.
function renderMorning(victims: { name: string; cause: string }[]): string {
  const dead = victims.map((v) => v.name);
  if (dead.length === 0) {
    return pick([
      "🌅 Dawn breaks grey and cold. Somehow, everyone survived the night — though no one slept.",
      "🕯️ The night passed without a single scream. Everyone is still breathing… for now.",
      "🌫️ The fog lifts on an empty graveyard. Against all odds, no one died.",
      "🌅 No bodies this morning. The village holds its breath, waiting for the next.",
      "🌙 The dark spared them all tonight. It rarely does twice.",
      "🌑 Nothing stirred in the night — yet every door was found unlocked by dawn.",
      "🕯️ Not one corpse this morning. The candles all burned out at the same hour, though.",
    ]);
  }
  const lines = victims.map((v) => `${v.name} ${v.cause}`);

  if (dead.length === 1) {
    return pick([
      `🌅 Dawn comes too late — ${lines[0]}.`,
      `🩸 The village wakes to screaming: ${lines[0]}.`,
      `🌫️ As the fog clears, a horror waits in the square — ${lines[0]}.`,
      `💀 Morning. ${lines[0]}. No one saw a thing.`,
      `🌙 The night took one of them: ${lines[0]}.`,
      `🩸 The bells toll for the dead at first light — ${lines[0]}.`,
      `🕯️ A scream, then silence. By morning, ${lines[0]}.`,
    ]);
  }
  // Two formats for a multi-victim morning, chosen at random:
  // (a) COLLECTIVE — all names together under one shared, gruesome fate
  //     ("Karthi, Kabali and Seyon were found …"), or
  // (b) PER-VICTIM — each name with its own distinct cause.
  // Either way, no role is hinted — lovers/item deaths just blend into the group.
  const nameList = dead.length === 2
    ? `${dead[0]} and ${dead[1]}`
    : `${dead.slice(0, -1).join(", ")} and ${dead[dead.length - 1]}`;

  if (Math.floor(Math.random() * 2) === 0) {
    const fate = pick([
      "were found in a tangled heap, torn apart",
      "were dragged into the woods — only the screams came back",
      "were left in a ring of black candles, all gone cold",
      "were drained pale, not a drop of blood left between them",
      "were strung up along the fence like a warning",
      "lie side by side, throats opened by the same blade",
      "were burned together where they slept",
      "were found with their eyes gone and mouths frozen mid-scream",
      "were swallowed by the dark and spat back out in pieces",
      "were stacked at the well, cold and broken",
      "were found knotted together, impossible to tell apart",
      "were dragged off one by one, screaming into the dark",
      "were laid out in a neat row, hands folded, eyes wide open",
      "were drowned together in the rising black water of the well",
      "were left hanging from the rafters in a silent row",
      "were found cold around a dead fire, as if they never moved",
      "were torn through the same wall — splinters, then blood",
      "were swallowed whole by the night and never seen again",
    ]);
    return pick([
      `🩸 A night of slaughter — ${nameList} ${fate}.`,
      `💀 The village wakes to a nightmare: ${nameList} ${fate}.`,
      `🌫️ ${nameList} ${fate}. The dawn brings only grief.`,
      `🕯️ ${nameList} ${fate} — and the bells toll on and on.`,
    ]);
  }

  const opener = pick([
    `🩸 A night of carnage — ${dead.length} are gone:`,
    `💀 The dawn reveals a massacre; ${dead.length} bodies:`,
    `🌫️ ${dead.length} did not live to see the morning:`,
    `🕯️ The village counts its dead, and weeps:`,
    `🩸 Blood runs in the gutters this morning — ${dead.length} fell:`,
    `💀 ${dead.length} empty beds, ${dead.length} cold bodies. The dark feasted:`,
  ]);
  return `${opener} ${lines.join("; ")}.`;
}

// Apply the night's death groups (sparing the one the Witch revived, whole) and
// open the day. (Anyone the Doctor or Witch protected was already removed from
// the death set during resolution, so they simply aren't here.)
function finalizeNight(
  room: Room,
  groups: DeathGroup[],
  acts: { name: string; roleId: string | null; targets: string[] }[]
): void {
  const deadPlayers: { name: string; roleId: string | null }[] = [];
  for (const g of groups) {
    for (const id of g.members) {
      const p = get(room, id);
      if (p && p.alive) {
        p.alive = false;
        deadPlayers.push({ name: p.name, roleId: p.roleId });
      }
    }
  }

  room.phase = "day";
  room.voteStage = "discussion"; // day opens in discussion; the God opens the vote
  room.votes = {};
  room.choiceVotes = {};
  room.tiedCandidates = [];
  room.deathGroups = null;
  room.nightActions = {};

  // Assign causes once, share them between the public morning text and the chronicle.
  const victims = assignCauses(deadPlayers.map((d) => d.name));
  room.chronicle.push({
    k: "night",
    day: room.day,
    acts,
    deaths: victims.map((v, i) => ({ name: v.name, roleId: deadPlayers[i].roleId, cause: v.cause })),
  });

  room.log.push({ phase: "day", day: room.day, text: renderMorning(victims) });

  const winner = checkWinner(room);
  if (winner) endGame(room, winner);
}

// ---- day phase (voting + tiebreak) ----
//
// voteStage flow:
//   "vote"      → everyone votes a suspect. Unique top → eliminated. Tie → "choice".
//   "choice"    → town votes Skip vs Revote. Skip → no kill; Revote → "revote";
//                 tie → "godchoice".
//   "revote"    → vote among ONLY the tied players. Unique top → eliminated;
//                 tie again → "godchoice".
//   "godchoice" → the God decides Skip or Revote.

function aliveVoters(room: Room): Player[] {
  return alivePlayers(room);
}

// Players cast a player-vote during the "vote" and "revote" stages.
export function submitVote(
  room: Room,
  voterId: string,
  targetId: string | null
): void {
  if (room.phase !== "day") return;
  if (room.voteStage !== "vote" && room.voteStage !== "revote") return;
  const voter = get(room, voterId);
  if (!voter || !voter.alive || voter.isHost) return;
  // During a revote, only the tied players are valid targets.
  if (
    room.voteStage === "revote" &&
    targetId &&
    !room.tiedCandidates.includes(targetId)
  )
    return;
  room.votes[voterId] = targetId;
}

// Players cast a Skip/Revote vote during the "choice" stage.
export function submitChoice(
  room: Room,
  voterId: string,
  choice: string
): void {
  if (room.phase !== "day" || room.voteStage !== "choice") return;
  if (choice !== "skip" && choice !== "revote") return;
  const voter = get(room, voterId);
  if (!voter || !voter.alive || voter.isHost) return;
  room.choiceVotes[voterId] = choice;
}

export function allVotesIn(room: Room): boolean {
  if (room.phase !== "day") return false;
  if (room.voteStage === "choice")
    return aliveVoters(room).every((p) => p.id in room.choiceVotes);
  if (room.voteStage === "vote" || room.voteStage === "revote")
    return aliveVoters(room).every((p) => p.id in room.votes);
  return false; // godchoice waits for the God
}

export function voteCounts(room: Room): Record<string, number> {
  const counts: Record<string, number> = {};
  if (room.voteStage === "choice") {
    for (const c of Object.values(room.choiceVotes))
      counts[c] = (counts[c] ?? 0) + 1;
  } else {
    for (const target of Object.values(room.votes)) {
      if (!target) continue;
      counts[target] = (counts[target] ?? 0) + 1;
    }
  }
  return counts;
}

// Returns { topIds, topVotes } — topIds has >1 entry when there's a tie.
function tally(counts: Record<string, number>): { topIds: string[]; topVotes: number } {
  let topVotes = 0;
  let topIds: string[] = [];
  for (const [id, n] of Object.entries(counts)) {
    if (n > topVotes) {
      topVotes = n;
      topIds = [id];
    } else if (n === topVotes) {
      topIds.push(id);
    }
  }
  return { topIds, topVotes };
}

function nextNight(room: Room): void {
  room.votes = {};
  room.choiceVotes = {};
  room.tiedCandidates = [];
  room.voteStage = "vote";
  room.nightActions = {};
  room.nightStep = 0;
  room.day += 1;
  room.phase = "night";
  room.privateMessages = {};
  room.log.push({
    phase: "night",
    day: room.day,
    text: `🌙 Night ${room.day} falls. The town sleeps...`,
  });
}

// Eliminate a player (or no one), apply Jester/Lovers, then end or go to night.
function eliminate(room: Room, victimId: string | null): void {
  room.votes = {};
  room.choiceVotes = {};
  room.tiedCandidates = [];

  if (victimId) {
    const victim = get(room, victimId);
    if (victim && victim.alive) {
      victim.alive = false;
      const role = getRole(victim.roleId);
      room.chronicle.push({ k: "banish", day: room.day, name: victim.name, roleId: victim.roleId });
      // Full mystery: the banished player's role is NEVER revealed mid-game (all
      // roles are shown only on the end-game screen). The town leaves none the wiser.
      room.log.push({
        phase: "day",
        day: room.day,
        text: pick([
          `🗳️ The town drives ${victim.name} out into the dark — whatever they truly were goes with them.`,
          `🗳️ ${victim.name} is dragged to the village gates and cast out, secrets and all.`,
          `🗳️ Banished. ${victim.name} is run out of the village, and no one will ever know for sure.`,
        ]),
      });
      if (role?.winsIfLynched) {
        endGame(
          room,
          role.team,
          `🤡 Banished! ${victim.name} the Jester is run out of the village to live free in the forest — exactly as they dreamed. They win!`
        );
        return;
      }
      applyLynchLovers(room, victim.id);
    }
  } else {
    room.log.push({
      phase: "day",
      day: room.day,
      text: "🗳️ The town spares everyone — no one is banished.",
    });
  }

  const winner = checkWinner(room);
  if (winner) endGame(room, winner);
  else room.voteStage = "done"; // day stays open; the God begins the night when ready
}

// Open the day vote (God-controlled). Discussion → voting.
export function openVote(room: Room): void {
  if (room.phase === "day" && room.voteStage === "discussion") room.voteStage = "vote";
}

// Begin the next night (God-controlled), after the day's outcome is in.
export function beginNight(room: Room): void {
  if (room.phase === "day" && room.voteStage === "done") nextNight(room);
}

// Resolve a player-vote stage ("vote" or "revote").
export function resolveDay(room: Room): void {
  if (room.phase !== "day") return;
  if (room.voteStage !== "vote" && room.voteStage !== "revote") return;

  const { topIds, topVotes } = tally(voteCounts(room));

  if (topVotes === 0 || topIds.length === 0) {
    // Nobody voted for anyone → no elimination.
    eliminate(room, null);
    return;
  }
  if (topIds.length === 1) {
    eliminate(room, topIds[0]);
    return;
  }

  // Tie. From a first vote → the town chooses skip/revote; from a revote → God.
  room.tiedCandidates = topIds;
  room.votes = {};
  const names = topIds.map((id) => nameOf(room, id)).join(", ");
  if (room.voteStage === "vote") {
    room.voteStage = "choice";
    room.choiceVotes = {};
    room.log.push({
      phase: "day",
      day: room.day,
      text: `🤝 Tie between ${names}. The town votes: Skip or Revote?`,
    });
  } else {
    room.voteStage = "godchoice";
    room.log.push({
      phase: "day",
      day: room.day,
      text: `🤝 Still tied between ${names}. The God will decide: Skip or Revote.`,
    });
  }
}

// Resolve the Skip/Revote choice stage.
export function resolveChoice(room: Room): void {
  if (room.phase !== "day" || room.voteStage !== "choice") return;
  const counts = voteCounts(room);
  const skip = counts["skip"] ?? 0;
  const revote = counts["revote"] ?? 0;

  if (skip > revote) {
    eliminate(room, null);
  } else if (revote > skip) {
    startRevote(room);
  } else {
    // Tied on skip-vs-revote → the God decides.
    room.voteStage = "godchoice";
    room.log.push({
      phase: "day",
      day: room.day,
      text: "🤝 Skip and Revote are tied. The God will decide.",
    });
  }
}

function startRevote(room: Room): void {
  room.voteStage = "revote";
  room.votes = {};
  room.choiceVotes = {};
  const names = room.tiedCandidates.map((id) => nameOf(room, id)).join(" vs ");
  room.log.push({
    phase: "day",
    day: room.day,
    text: `🗳️ Revote — the town decides between ${names}.`,
  });
}

// The God breaks a deadlock (after a tied choice, or a tied revote).
export function resolveGodChoice(room: Room, decision: string): void {
  if (room.phase !== "day" || room.voteStage !== "godchoice") return;
  if (decision === "revote") startRevote(room);
  else eliminate(room, null); // "skip"
}

// If one Lover is banished, the other dies too. CRITICAL: this is narrated as a
// plain, standalone murder — NO "moments later / too / in the same breath" linkage
// and no "Lover" wording — so regular players can't infer the bond from the story.
function applyLynchLovers(room: Room, deadId: string): void {
  const lovers = room.roleState.lovers;
  if (!lovers) return;
  const [a, b] = lovers;
  const partner = deadId === a ? b : deadId === b ? a : null;
  if (!partner) return;
  const p = get(room, partner);
  if (p && p.alive) {
    p.alive = false;
    room.chronicle.push({ k: "bond", day: room.day, name: p.name, roleId: p.roleId });
    room.log.push({
      phase: "day",
      day: room.day,
      text: pick([
        `🩸 ${p.name} is found dead in the crowd — a blade in the back, and no one saw the hand.`,
        `💀 ${p.name} drops where they stand, lifeless before they hit the ground.`,
        `🔪 ${p.name} is discovered slumped against the gate, throat opened to the bone.`,
        `🌫️ ${p.name} crumples without a sound, gone before anyone can reach them.`,
        `🩸 ${p.name} is found cold in a spreading red pool, the killer long melted into the crowd.`,
      ]),
    });
  }
}

// ---- win conditions ----

export function checkWinner(room: Room): Winner | null {
  const living = alivePlayers(room);

  // Cross-faction Lovers (e.g. a Cop linked to a Killer) form their own couple:
  // if the last two alive ARE the linked Lovers and they're on opposing sides,
  // their bond wins over both factions. (Same-team lovers fall through to the
  // normal town/mafia check below, which already resolves correctly.)
  const lovers = room.roleState.lovers;
  if (lovers && living.length === 2) {
    const ids = living.map((p) => p.id);
    if (ids.includes(lovers[0]) && ids.includes(lovers[1])) {
      if (teamOf(room, lovers[0]) !== teamOf(room, lovers[1])) return "lovers";
    }
  }

  const killers = living.filter((p) => teamOf(room, p.id) === "mafia").length;
  const others = living.length - killers; // town + any surviving neutrals
  if (killers === 0) return "town";
  if (killers >= others) return "mafia";
  return null;
}

function endGame(room: Room, winner: Winner, message?: string): void {
  room.phase = "ended";
  room.winner = winner;
  const text =
    message ??
    (winner === "town"
      ? "🎉 The Town wins! All Killers have been eliminated."
      : winner === "mafia"
        ? "💀 The Killers win! They control the town."
        : winner === "lovers"
          ? "💞 The Lovers win! Their forbidden bond outlasted everyone."
          : "🤡 The Neutral player wins!");
  room.log.push({ phase: "ended", day: room.day, text });

  // Name the victorious side out loud — e.g. reveal the whole Killer team.
  const winLabel =
    winner === "mafia" ? "the Killers"
    : winner === "town" ? "the Town"
    : winner === "lovers" ? "the Lovers"
    : "the Jester";
  let winners: string[];
  if (winner === "lovers" && room.roleState.lovers) {
    winners = room.roleState.lovers.map((id) => nameOf(room, id));
  } else if (winner === "neutral") {
    winners = room.players
      .filter((p) => !p.isHost && getRole(p.roleId)?.team === "neutral")
      .map((p) => p.name);
  } else {
    winners = room.players
      .filter((p) => !p.isHost && teamOf(room, p.id) === winner)
      .map((p) => p.name);
  }
  if (winners.length)
    room.log.push({
      phase: "ended",
      day: room.day,
      text: `🏆 Victory to ${winLabel}: ${winners.join(", ")}.`,
    });

  // A closing line for the end-of-game story.
  const closer =
    winner === "town"
      ? "🌅 And so the town, battered but unbroken, finally slept soundly."
      : winner === "mafia"
        ? "🌑 The town never saw the dawn — the Killers had won."
        : winner === "lovers"
          ? "💞 Two hearts from opposite worlds, the last ones standing — together."
          : "🌲 The Jester skips off into the forest, free at last — cackling all the way.";
  room.log.push({ phase: "ended", day: room.day, text: closer });

  // The full director's-cut chronicle — every night replayed (who did what), every
  // death and how, every banishment, with all roles FINALLY revealed.
  const who = (name: string, roleId: string | null) => {
    const r = getRole(roleId);
    return `${name} (${r?.emoji ?? ""} ${r?.name ?? "Unknown"})`;
  };
  room.log.push({ phase: "ended", day: room.day, text: "📖 The full story — every mask comes off:" });
  for (const scene of room.chronicle) {
    if (scene.k === "night") {
      const lines = [`🌙 Night ${scene.day}`];
      for (const a of scene.acts) lines.push(`   · ${who(a.name, a.roleId)} ${actLine(a.roleId, a.targets)}`);
      if (scene.deaths.length)
        for (const d of scene.deaths) lines.push(`   ☠️ ${who(d.name, d.roleId)} ${d.cause}`);
      else lines.push("   ☀️ …and when dawn came, no one had died.");
      room.log.push({ phase: "ended", day: room.day, text: lines.join("\n") });
    } else if (scene.k === "banish") {
      room.log.push({
        phase: "ended",
        day: room.day,
        text: `🗳️ Day ${scene.day} — the town banished ${who(scene.name, scene.roleId)}.`,
      });
    } else {
      room.log.push({
        phase: "ended",
        day: room.day,
        text: `💔 ${who(scene.name, scene.roleId)} fell with their love that same day.`,
      });
    }
  }
  const stillAlive = alivePlayers(room)
    .filter((p) => !p.isHost)
    .map((p) => who(p.name, p.roleId));
  if (stillAlive.length)
    room.log.push({
      phase: "ended",
      day: room.day,
      text: `🟢 Walked away alive: ${stillAlive.join(", ")}.`,
    });
}

export function resetToLobby(room: Room): void {
  room.phase = "lobby";
  room.day = 0;
  room.winner = null;
  room.nightActions = {};
  room.nightStep = 0;
  room.votes = {};
  room.voteStage = "vote";
  room.tiedCandidates = [];
  room.choiceVotes = {};
  room.privateMessages = {};
  room.roleState = freshRoleState();
  room.deathGroups = null;
  room.witchRevives = {};
  room.chat = { town: [], killers: [] };
  room.chatSeq = 0;
  room.chronicle = [];
  room.log = [];
  for (const p of room.players) {
    p.roleId = null;
    p.alive = true;
  }
}

// ---- chat ----

function isInKillerChat(room: Room, playerId: string): boolean {
  return getRole(roleOf(room, playerId))?.killerChat === true;
}

// The anonymous town square is open to living players during the day. The God
// may also drop anonymous messages at any time during an in-progress game
// (their messages look identical to players' "Anonymous" lines).
function canPostTown(room: Room, p: Player): boolean {
  const active =
    room.phase === "night" || room.phase === "witch" || room.phase === "day";
  if (p.isHost) return active;
  return p.alive && room.phase === "day";
}

// The Killers' room is open to living members during any active round. The God
// may also whisper into it anonymously (their messages show as "Anonymous" to
// the Killers, just like in the town square).
function canPostKillers(room: Room, p: Player): boolean {
  const active =
    room.phase === "night" || room.phase === "witch" || room.phase === "day";
  if (p.isHost) return active;
  return p.alive && isInKillerChat(room, p.id) && active;
}

export function postChat(
  room: Room,
  senderId: string,
  channel: "town" | "killers",
  text: string
): void {
  const sender = get(room, senderId);
  if (!sender) return;
  const clean = (text || "").trim().slice(0, 500);
  if (!clean) return;
  const allowed =
    channel === "town" ? canPostTown(room, sender) : canPostKillers(room, sender);
  if (!allowed) return;
  room.chat[channel].push({
    id: String(room.chatSeq++),
    senderId,
    senderName: sender.name,
    text: clean,
  });
}

function buildChatState(room: Room, viewer: Player) {
  const isHost = viewer.isHost;
  const seesKillers = isHost || isInKillerChat(room, viewer.id);

  // Town square: host sees real names; a player sees only their own as "You".
  const town = room.chat.town.map((m) => ({
    id: m.id,
    text: m.text,
    mine: m.senderId === viewer.id,
    sender: isHost
      ? m.senderName
      : m.senderId === viewer.id
        ? "You"
        : null, // anonymous to other players
  }));

  // Killers' room: members see each other by real name, but the God's whispers
  // are anonymous to them. The God sees every real sender.
  const killers = seesKillers
    ? room.chat.killers.map((m) => ({
        id: m.id,
        text: m.text,
        mine: m.senderId === viewer.id,
        sender:
          !isHost && m.senderId === room.hostId ? null : m.senderName,
      }))
    : null;

  return {
    town,
    killers,
    canPostTown: canPostTown(room, viewer),
    canPostKillers: canPostKillers(room, viewer),
  };
}

// ---- building per-player views ----

export function buildView(room: Room, viewerId: string): RoomView {
  const viewer = get(room, viewerId)!;
  const isHost = viewer.isHost;
  const gameOver = room.phase === "ended";

  const players: PublicPlayer[] = room.players
    .filter((p) => p.id !== viewerId)
    .map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      connected: p.connected,
      alive: p.alive,
      roleId: isHost || gameOver ? p.roleId : null,
    }));

  const steps = room.phase === "night" ? nightSteps(room) : [];
  const cur = steps[room.nightStep];
  const next = steps[room.nightStep + 1];

  return {
    code: room.code,
    phase: room.phase,
    day: room.day,
    hostId: room.hostId,
    you: { ...viewer },
    players,
    config: room.config,
    log: room.log,
    winner: room.winner,
    prompt: buildPrompt(room, viewer),
    privateMessage: room.privateMessages[viewerId] ?? null,
    hostStatus: isHost ? buildHostStatus(room) : null,
    chat: buildChatState(room, viewer),
    voteStage: room.phase === "day" ? room.voteStage : null,
    // Public: which role-group the host is currently calling.
    nightStepLabel: cur ? `${cur.emoji} ${cur.label}` : null,
    // Host-only: the live night board + the "next" button label.
    nightControl:
      isHost && room.phase === "night"
        ? { board: buildNightBoard(room), nextLabel: next ? `${next.emoji} ${next.label}` : null }
        : null,
  };
}

// Host-only readout: every night-acting player this night, whether they've acted,
// and what they chose. Grouped/ordered by the host's stepping order.
function buildNightBoard(room: Room): NightBoardEntry[] {
  const steps = nightSteps(room);
  const board: NightBoardEntry[] = [];
  steps.forEach((step, si) => {
    const actors = alivePlayers(room).filter(
      (p) => step.roles.includes(p.roleId ?? "") && actsTonight(room, p)
    );
    for (const p of actors) {
      const done = p.id in room.nightActions;
      const targets = room.nightActions[p.id] ?? [];
      board.push({
        id: p.id,
        step: `${step.emoji} ${step.label}`,
        current: si === room.nightStep,
        name: p.name,
        connected: p.connected,
        done,
        text: describeNightAction(room, p.roleId ?? "", targets, done),
      });
    }
  });
  return board;
}

function describeNightAction(room: Room, roleId: string, targets: string[], done: boolean): string {
  if (!done) return "⏳ waiting…";
  const names = targets.map((id) => nameOf(room, id));
  if (names.length === 0) return "— held back";
  if (roleId === "cupid") return `💘 linked ${names.join(" & ")}`;
  if (roleId === "doctor") return `🩺 healed ${names[0]}`;
  if (roleId === "police") return `🚓 investigated ${names[0]}`;
  if (roleId === "item") return `🎲 visited ${names[0]}`;
  if (roleId === "vigilante") return `🔫 shot ${names[0]}`;
  if (roleId === "witch") return `🧙 saved ${names[0]}`;
  return `🎯 chose ${names[0]}`; // killer / godfather / psycho
}

function buildPrompt(room: Room, viewer: Player): ActionPrompt | null {
  if (viewer.isHost || !viewer.alive) return null;

  if (room.phase === "night") {
    // Host-stepped night: a player only acts when their role-group is called.
    if (!actsInCurrentStep(room, viewer)) return null;
    const role = getRole(viewer.roleId)!;
    let pool = alivePlayers(room).filter(
      (p) => role.night!.canTargetSelf || p.id !== viewer.id
    );
    // The Item can't pick anyone it has already visited — until it's been with
    // everyone still alive, at which point the cycle resets and all are open again.
    if (role.id === "item") {
      const visited = room.roleState.itemVisited[viewer.id] ?? [];
      const unvisited = pool.filter((p) => !visited.includes(p.id));
      if (unvisited.length > 0) pool = unvisited;
    }
    // The Witch is shown only who was attacked tonight (she saves blind to the heal).
    if (role.id === "witch") {
      const attacked = attackedTonight(room);
      pool = pool.filter((p) => attacked.includes(p.id));
    }
    const targets = pool.map((p) => p.id);
    return {
      kind: "night",
      text:
        role.id === "witch" && targets.length === 0
          ? "No one was attacked tonight — nothing to save."
          : role.night!.prompt,
      roleId: role.id,
      targets,
      selectCount: role.night!.selectCount ?? 1,
      canSkip: true,
      submitted: viewer.id in room.nightActions,
    };
  }

  if (room.phase === "day") {
    // No vote prompt before the God opens voting, after it's settled, or during
    // the God's tie decision.
    if (
      room.voteStage === "discussion" ||
      room.voteStage === "done" ||
      room.voteStage === "godchoice"
    )
      return null;

    if (room.voteStage === "choice") {
      const names = room.tiedCandidates.map((id) => nameOf(room, id)).join(" & ");
      return {
        kind: "choice",
        text: `Tie between ${names}. Skip the vote, or revote between them?`,
        roleId: null,
        targets: [],
        choices: [
          { id: "skip", label: "⏭️ Skip (no elimination)" },
          { id: "revote", label: "🔁 Revote" },
        ],
        selectCount: 1,
        canSkip: false,
        submitted: viewer.id in room.choiceVotes,
      };
    }

    // "vote" (everyone) or "revote" (only the tied players are options).
    const pool =
      room.voteStage === "revote"
        ? alivePlayers(room).filter((p) => room.tiedCandidates.includes(p.id))
        : alivePlayers(room);
    const targets = pool.filter((p) => p.id !== viewer.id).map((p) => p.id);
    return {
      kind: "vote",
      text:
        room.voteStage === "revote"
          ? "Revote — choose between the tied players (or skip)."
          : "Vote to eliminate a suspect (or skip).",
      roleId: null,
      targets,
      selectCount: 1,
      canSkip: true,
      submitted: viewer.id in room.votes,
    };
  }

  return null;
}

const pendingInfo = (players: Player[]) =>
  players.map((p) => ({ id: p.id, name: p.name, connected: p.connected }));

function buildHostStatus(room: Room): HostStatus {
  if (room.phase === "night") {
    const pending = pendingNightActors(room);
    const waiting = pending.filter((p) => !(p.id in room.nightActions));
    return {
      acted: pending.length - waiting.length,
      pending: pending.length,
      voteCounts: {},
      pendingPlayers: pendingInfo(waiting),
    };
  }
  if (room.phase === "day") {
    const voters = aliveVoters(room);
    if (room.voteStage === "godchoice")
      return { acted: 0, pending: 0, voteCounts: voteCounts(room), pendingPlayers: [] };
    const acted = room.voteStage === "choice"
      ? voters.filter((p) => p.id in room.choiceVotes)
      : voters.filter((p) => p.id in room.votes);
    const waiting = voters.filter((p) => !acted.includes(p));
    return {
      acted: acted.length,
      pending: voters.length,
      voteCounts: voteCounts(room),
      pendingPlayers: pendingInfo(waiting),
    };
  }
  return { acted: 0, pending: 0, voteCounts: {}, pendingPlayers: [] };
}

// The God skips a stalling/AFK player so the room can complete. `targetId` may be
// a single player id, or "__all__" to skip everyone currently being waited on.
// (Night: records "held back". Day vote: a Skip vote. Day choice: a Skip choice.)
export function hostSkip(room: Room, targetId: string): void {
  const skipOne = (id: string) => {
    const p = get(room, id);
    if (!p || !p.alive || p.isHost) return;
    if (room.phase === "night") {
      if (actsTonight(room, p) && !(id in room.nightActions)) room.nightActions[id] = [];
    } else if (room.phase === "day") {
      if ((room.voteStage === "vote" || room.voteStage === "revote") && !(id in room.votes))
        room.votes[id] = null;
      else if (room.voteStage === "choice" && !(id in room.choiceVotes))
        room.choiceVotes[id] = "skip";
    }
  };
  if (targetId === "__all__") buildHostStatus(room).pendingPlayers.forEach((p) => skipOne(p.id));
  else skipOne(targetId);
}

export { ROLES };
