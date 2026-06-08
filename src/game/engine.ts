// ============================================================================
// GAME ENGINE  —  in-memory Room state + all game logic. The socket layer
// (server.ts) owns the rooms and calls into these functions.
// ============================================================================

import type {
  ActionPrompt,
  HostStatus,
  LogEntry,
  Phase,
  Player,
  PublicPlayer,
  RoleConfig,
  RoomView,
  Team,
} from "@/lib/types";
import {
  freshRoleState,
  getRole,
  nightRolesInOrder,
  ROLES,
  type NightContext,
  type RoleState,
  WITCH_MAX_REVIVES,
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
  winner: Team | null;
  // Submitted night actions this phase: playerId -> chosen target ids.
  nightActions: Record<string, string[]>;
  // Submitted day votes this phase: voterId -> targetId|null.
  votes: Record<string, string | null>;
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
}

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
    votes: {},
    privateMessages: {},
    roleState: freshRoleState(),
    deathGroups: null,
    witchRevives: {},
    chat: { town: [], killers: [] },
    chatSeq: 0,
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
  room.votes = {};
  room.privateMessages = {};
  room.roleState = freshRoleState();
  room.deathGroups = null;
  room.witchRevives = {};
  room.chat = { town: [], killers: [] };
  room.chatSeq = 0;
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
  return true;
}

// Players who must submit a chosen night action this night.
export function pendingNightActors(room: Room): Player[] {
  return alivePlayers(room).filter((p) => actsTonight(room, p));
}

export function submitNightAction(
  room: Room,
  playerId: string,
  targetIds: string[]
): void {
  if (room.phase !== "night") return;
  const player = get(room, playerId);
  if (!player || !player.alive || !actsTonight(room, player)) return;
  room.nightActions[playerId] = targetIds;
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
  };
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

// The Item is drawn to a random, never-before-visited player each night.
// Returns itemPlayerId -> targetId for everyone holding the Item.
function runItem(room: Room): Record<string, string> {
  const targets: Record<string, string> = {};
  for (const item of aliveWithRole(room, "item")) {
    const visited = room.roleState.itemVisited[item.id] ?? [];
    const candidates = alivePlayers(room).filter(
      (p) => p.id !== item.id && !visited.includes(p.id)
    );
    if (candidates.length === 0) continue;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    targets[item.id] = pick.id;
    room.roleState.itemVisited[item.id] = [...visited, pick.id];
    room.privateMessages[item.id] = `🎲 Tonight you were drawn to ${pick.name}.`;
  }
  return targets;
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

function aliveWitchWithRevives(room: Room): Player | null {
  return (
    aliveWithRole(room, "witch").find(
      (w) => (room.witchRevives[w.id] ?? 0) < WITCH_MAX_REVIVES
    ) ?? null
  );
}

// Resolve the night. Either pauses for the Witch, or finalizes into morning.
export function resolveNight(room: Room): void {
  if (room.phase !== "night") return;
  const ctx = buildNightContext(room);

  // Run each chosen night action in priority order.
  for (const roleDef of nightRolesInOrder()) {
    if (roleDef.night?.firstNightOnly && room.day !== 1) continue;
    if (roleDef.night?.everyOtherNight && room.day % 2 === 0) continue;
    for (const actor of aliveWithRole(room, roleDef.id)) {
      roleDef.resolve?.(actor.id, room.nightActions[actor.id] ?? [], ctx);
    }
  }

  // The Police squad's single shared investigation.
  resolvePolice(room, ctx);

  // Surface private results (Police findings, Cupid's love notes).
  room.privateMessages = { ...ctx.privateResults };

  // The Item acts automatically, then we compute the night's death groups.
  const itemTargets = runItem(room);
  const groups = computeDeaths(room, ctx, itemTargets);
  const anyDeaths = groups.some((g) => g.members.length > 0);

  // A Psycho Killer healed by the Doctor secretly becomes a Vigilante.
  for (const psycho of aliveWithRole(room, "psycho")) {
    if (ctx.protectedIds.has(psycho.id)) {
      psycho.roleId = "vigilante";
      room.privateMessages[psycho.id] =
        "🪓 → 🔫 The Doctor's care has changed something in you. You are now a Vigilante — hunt the Killers.";
    }
  }

  // If a Witch can still act and someone died, pause for her decision. She is
  // shown only each group's primary; reviving it brings the whole group back.
  const witch = aliveWitchWithRevives(room);
  if (anyDeaths && witch) {
    room.deathGroups = groups;
    room.phase = "witch";
    const names = groups.map((g) => nameOf(room, g.primary)).join(", ");
    const left = WITCH_MAX_REVIVES - (room.witchRevives[witch.id] ?? 0);
    room.privateMessages[witch.id] =
      `🧙 Fell tonight: ${names}. You may revive one — anyone bound to them returns too (${left} left).`;
    return;
  }

  finalizeNight(room, groups, null);
}

// Apply the night's death groups (sparing the one the Witch revived, whole) and
// open the day. Reviving a group's primary spares every member bound to it.
function finalizeNight(
  room: Room,
  groups: DeathGroup[],
  revive: { witchId: string; primaryId: string } | null
): void {
  const revivedPrimary = revive?.primaryId ?? null;
  const dead: string[] = [];
  const revivedNames: string[] = [];
  for (const g of groups) {
    if (g.primary === revivedPrimary) {
      // The whole group is spared — collect names for the morning narration.
      for (const id of g.members) revivedNames.push(nameOf(room, id));
      continue;
    }
    for (const id of g.members) {
      const p = get(room, id);
      if (p && p.alive) {
        p.alive = false;
        dead.push(p.name);
      }
    }
  }

  room.phase = "day";
  room.deathGroups = null;
  room.nightActions = {};

  if (revive && revivedNames.length) {
    room.witchRevives[revive.witchId] = (room.witchRevives[revive.witchId] ?? 0) + 1;
    room.log.push({
      phase: "day",
      day: room.day,
      text: `🧙 The Witch's magic pulled ${revivedNames.join(" and ")} back from death!`,
    });
  }

  if (dead.length === 0) {
    room.log.push({
      phase: "day",
      day: room.day,
      text: "☀️ Morning breaks. No one died last night.",
    });
  } else {
    room.log.push({
      phase: "day",
      day: room.day,
      text: `☀️ Morning breaks. ${dead.join(" and ")} ${
        dead.length > 1 ? "were" : "was"
      } found dead.`,
    });
  }

  const winner = checkWinner(room);
  if (winner) endGame(room, winner);
}

// ---- witch sub-phase ----

export function resolveWitch(
  room: Room,
  witchId: string | null,
  targetId: string | null
): void {
  if (room.phase !== "witch") return;
  const groups = room.deathGroups ?? [];
  const witch = witchId ? get(room, witchId) : null;
  // The witch revives by choosing a group's primary (which spares the whole group).
  const canRevive =
    witch &&
    witch.roleId === "witch" &&
    witch.alive &&
    (room.witchRevives[witch.id] ?? 0) < WITCH_MAX_REVIVES &&
    targetId &&
    groups.some((g) => g.primary === targetId);
  finalizeNight(
    room,
    groups,
    canRevive ? { witchId: witch!.id, primaryId: targetId! } : null
  );
}

// ---- day phase (voting) ----

export function submitVote(
  room: Room,
  voterId: string,
  targetId: string | null
): void {
  if (room.phase !== "day") return;
  const voter = get(room, voterId);
  if (!voter || !voter.alive || voter.isHost) return;
  room.votes[voterId] = targetId;
}

function aliveVoters(room: Room): Player[] {
  return alivePlayers(room);
}

export function allVotesIn(room: Room): boolean {
  return aliveVoters(room).every((p) => p.id in room.votes);
}

export function voteCounts(room: Room): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const target of Object.values(room.votes)) {
    if (!target) continue;
    counts[target] = (counts[target] ?? 0) + 1;
  }
  return counts;
}

export function resolveDay(room: Room): void {
  if (room.phase !== "day") return;
  const counts = voteCounts(room);
  let topId: string | null = null;
  let topVotes = 0;
  let tie = false;
  for (const [id, n] of Object.entries(counts)) {
    if (n > topVotes) {
      topVotes = n;
      topId = id;
      tie = false;
    } else if (n === topVotes) {
      tie = true;
    }
  }

  if (!topId || tie || topVotes === 0) {
    room.log.push({
      phase: "day",
      day: room.day,
      text: "🗳️ The vote was tied or no one was chosen. No one is eliminated.",
    });
  } else {
    const victim = get(room, topId);
    if (victim) {
      victim.alive = false;
      const role = getRole(victim.roleId);
      room.log.push({
        phase: "day",
        day: room.day,
        text: `🗳️ The town voted out ${victim.name} — they were the ${role?.emoji ?? ""} ${role?.name ?? "Unknown"}.`,
      });
      // The Jester wins outright if lynched.
      if (role?.winsIfLynched) {
        room.votes = {};
        endGame(
          room,
          role.team,
          `🤡 ${victim.name} the ${role.name} got exactly what they wanted — voted out, and victorious!`
        );
        return;
      }
      // A lynched Lover drags their partner down with them.
      applyLynchLovers(room, victim.id);
    }
  }

  room.votes = {};

  const winner = checkWinner(room);
  if (winner) {
    endGame(room, winner);
  } else {
    room.day += 1;
    room.phase = "night";
    room.privateMessages = {};
    room.log.push({
      phase: "night",
      day: room.day,
      text: `🌙 Night ${room.day} falls. The town sleeps...`,
    });
  }
}

// If one Lover is lynched, the other dies of heartbreak.
function applyLynchLovers(room: Room, deadId: string): void {
  const lovers = room.roleState.lovers;
  if (!lovers) return;
  const [a, b] = lovers;
  const partner = deadId === a ? b : deadId === b ? a : null;
  if (!partner) return;
  const p = get(room, partner);
  if (p && p.alive) {
    p.alive = false;
    room.log.push({
      phase: "day",
      day: room.day,
      text: `💔 ${p.name} died of heartbreak, having lost their Lover.`,
    });
  }
}

// ---- win conditions ----

export function checkWinner(room: Room): Team | null {
  const living = alivePlayers(room);
  const killers = living.filter((p) => teamOf(room, p.id) === "mafia").length;
  const others = living.length - killers; // town + any surviving neutrals
  if (killers === 0) return "town";
  if (killers >= others) return "mafia";
  return null;
}

function endGame(room: Room, winner: Team, message?: string): void {
  room.phase = "ended";
  room.winner = winner;
  const text =
    message ??
    (winner === "town"
      ? "🎉 The Town wins! All Killers have been eliminated."
      : winner === "mafia"
        ? "💀 The Killers win! They control the town."
        : "🤡 The Neutral player wins!");
  room.log.push({ phase: "ended", day: room.day, text });
}

export function resetToLobby(room: Room): void {
  room.phase = "lobby";
  room.day = 0;
  room.winner = null;
  room.nightActions = {};
  room.votes = {};
  room.privateMessages = {};
  room.roleState = freshRoleState();
  room.deathGroups = null;
  room.witchRevives = {};
  room.chat = { town: [], killers: [] };
  room.chatSeq = 0;
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
  };
}

function buildPrompt(room: Room, viewer: Player): ActionPrompt | null {
  if (viewer.isHost || !viewer.alive) return null;

  if (room.phase === "night") {
    if (!actsTonight(room, viewer)) return null;
    const role = getRole(viewer.roleId)!;
    const targets = alivePlayers(room)
      .filter((p) => role.night!.canTargetSelf || p.id !== viewer.id)
      .map((p) => p.id);
    return {
      kind: "night",
      text: role.night!.prompt,
      roleId: role.id,
      targets,
      selectCount: role.night!.selectCount ?? 1,
      canSkip: true,
      submitted: viewer.id in room.nightActions,
    };
  }

  if (room.phase === "witch") {
    const witch = aliveWitchWithRevives(room);
    if (!witch || witch.id !== viewer.id) return null;
    return {
      kind: "witch",
      text: "Revive one of the fallen (anyone bound to them returns too), or let fate stand?",
      roleId: "witch",
      // Only each group's primary is offered — bound deaths come back with it.
      targets: (room.deathGroups ?? []).map((g) => g.primary),
      selectCount: 1,
      canSkip: true,
      submitted: false,
    };
  }

  if (room.phase === "day") {
    const targets = alivePlayers(room)
      .filter((p) => p.id !== viewer.id)
      .map((p) => p.id);
    return {
      kind: "vote",
      text: "Vote to eliminate a suspect (or skip).",
      roleId: null,
      targets,
      selectCount: 1,
      canSkip: true,
      submitted: viewer.id in room.votes,
    };
  }

  return null;
}

function buildHostStatus(room: Room): HostStatus {
  if (room.phase === "night") {
    const pending = pendingNightActors(room);
    const acted = pending.filter((p) => p.id in room.nightActions).length;
    return { acted, pending: pending.length, voteCounts: {} };
  }
  if (room.phase === "witch") {
    const witch = aliveWitchWithRevives(room);
    return { acted: 0, pending: witch ? 1 : 0, voteCounts: {} };
  }
  if (room.phase === "day") {
    const voters = aliveVoters(room);
    const acted = voters.filter((p) => p.id in room.votes).length;
    return { acted, pending: voters.length, voteCounts: voteCounts(room) };
  }
  return { acted: 0, pending: 0, voteCounts: {} };
}

export { ROLES };
