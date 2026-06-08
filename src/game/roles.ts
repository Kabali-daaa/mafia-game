// ============================================================================
// ROLE REGISTRY  —  the file you extend to add new roles & powers.
//
// Simple roles (act on a target at night) are fully described here: give them a
// `night` block + a `resolve` function. More intricate roles whose powers touch
// global state (Cupid's lovers, the Item's curse, the Witch's revive, the
// Panchayath Thalivar's immunity) also have hooks in `engine.ts` — each is
// marked with a NOTE pointing to where its special logic lives.
// ============================================================================

import type { Team } from "@/lib/types";

// Persistent, whole-game state that some roles read/write across nights.
export interface RoleState {
  // The two players Cupid linked, or null if none.
  lovers: [string, string] | null;
  // itemPlayerId -> player ids the Item has already visited (never repeats).
  itemVisited: Record<string, string[]>;
  // The Item's target for the current night (set during resolution).
  itemTargetThisNight: string | null;
}

export function freshRoleState(): RoleState {
  return { lovers: null, itemVisited: {}, itemTargetThisNight: null };
}

// The mutable scratch-pad the engine builds while resolving a night.
export interface NightContext {
  day: number;
  // playerId -> the target ids they chose this night (Cupid has 2).
  actions: Record<string, string[]>;
  alivePlayerIds: string[];
  roleOf: (playerId: string) => string | null;
  teamOf: (playerId: string) => Team | null;
  apparentTeamOf: (playerId: string) => Team | null; // Godfather reads as town
  nameOf: (playerId: string) => string;
  state: RoleState;

  // outputs the engine reads after all roles resolve:
  protectedIds: Set<string>;
  markedForDeath: Set<string>;
  privateResults: Record<string, string>; // playerId -> message shown only to them
  // Vigilante shots: shooterId -> targetId. Engine applies the "kill a killer,
  // or die for shooting an innocent" rule (see engine.ts).
  vigilanteShots: Record<string, string>;
  // Item visits: itemPlayerId -> the player they chose this night. Engine applies
  // the Item's curse (dies if it's a Killer, or if that player dies tonight).
  itemTargets: Record<string, string>;
}

export interface RoleDef {
  id: string;
  name: string;
  team: Team;
  emoji: string;
  description: string;
  // False for roles that are never dealt at game start and so don't appear in
  // the host's lobby (e.g. Vigilante, which only exists via transformation).
  assignable?: boolean;
  // True for roles that share the Killers' private chat room (Killer, Godfather).
  killerChat?: boolean;
  // What this role appears as when investigated. Defaults to `team`.
  apparentTeam?: Team;
  // True if this role wins immediately when the town votes them out.
  winsIfLynched?: boolean;
  // Night action config. Omit for roles with no chosen night action.
  night?: {
    order: number; // lower resolves first (protectors before killers)
    prompt: string;
    canTargetSelf: boolean;
    canTargetDead: boolean;
    selectCount?: number; // how many targets to choose (default 1)
    firstNightOnly?: boolean; // Cupid only acts on night 1
    everyOtherNight?: boolean; // only acts on odd nights (1, 3, 5, …)
  };
  // Apply this player's chosen targets into the shared night context.
  resolve?: (actorId: string, targetIds: string[], ctx: NightContext) => void;
}

// How many times the Witch may revive in a whole game.
export const WITCH_MAX_REVIVES = 2;

export const ROLES: Record<string, RoleDef> = {
  // ---- Killers' side ----
  killer: {
    id: "killer",
    name: "Killer",
    team: "mafia",
    emoji: "🔪",
    killerChat: true,
    description:
      "Each night, the Killers choose one player to eliminate. They win when they equal or outnumber everyone else.",
    night: {
      order: 50,
      prompt: "Choose a player to eliminate tonight.",
      canTargetSelf: false,
      canTargetDead: false,
    },
    resolve: (_actorId, targetIds, ctx) => {
      const t = targetIds[0];
      if (t) ctx.markedForDeath.add(t);
    },
  },

  godfather: {
    id: "godfather",
    name: "Godfather",
    team: "mafia",
    apparentTeam: "town", // reads as innocent to the Police
    emoji: "🎩",
    killerChat: true,
    description:
      "The boss of the Killers. Eliminates a player each night and appears innocent if the Police investigate them.",
    night: {
      order: 50,
      prompt: "Choose a player to eliminate tonight.",
      canTargetSelf: false,
      canTargetDead: false,
    },
    resolve: (_actorId, targetIds, ctx) => {
      const t = targetIds[0];
      if (t) ctx.markedForDeath.add(t);
    },
  },

  psycho: {
    id: "psycho",
    name: "Psycho Killer",
    team: "mafia",
    emoji: "🪓",
    // NOTE: the "healed → becomes Vigilante" transformation is handled in engine.ts.
    description:
      "A lone killer who strikes only on odd nights (1, 3, 5…). If the Doctor ever happens to heal them, they secretly become a Vigilante.",
    night: {
      order: 50,
      prompt: "It's your night. Choose a player to kill (or skip).",
      canTargetSelf: false,
      canTargetDead: false,
      everyOtherNight: true,
    },
    resolve: (_actorId, targetIds, ctx) => {
      const t = targetIds[0];
      if (t) ctx.markedForDeath.add(t);
    },
  },

  // ---- Town side ----
  villager: {
    id: "villager",
    name: "Villager",
    team: "town",
    emoji: "🧑‍🌾",
    description:
      "An ordinary townsperson with no night power. Discuss and vote during the day to find the Killers.",
  },

  police: {
    id: "police",
    name: "Police",
    team: "town",
    // NOTE: the Police act as ONE squad — however many cops there are, only a
    // single suspect is investigated per night (plurality of their picks).
    // The shared resolution lives in engine.ts (resolvePolice); there is no
    // per-actor `resolve` here.
    emoji: "🚓",
    description:
      "The Police squad investigates ONE suspect per night — even with several cops, only one check happens, and they all share the result. (The Godfather reads as innocent.)",
    night: {
      order: 20,
      prompt: "Pick a suspect for the squad to investigate (the most-chosen one is checked).",
      canTargetSelf: false,
      canTargetDead: false,
    },
  },

  doctor: {
    id: "doctor",
    name: "Doctor",
    team: "town",
    emoji: "🩺",
    description:
      "Each night, choose one player to heal. If they're attacked that night, they survive.",
    night: {
      order: 10, // heal before kills are applied
      prompt: "Choose a player to heal tonight.",
      canTargetSelf: true,
      canTargetDead: false,
    },
    resolve: (_actorId, targetIds, ctx) => {
      const t = targetIds[0];
      if (t) ctx.protectedIds.add(t);
    },
  },

  vigilante: {
    id: "vigilante",
    name: "Vigilante",
    team: "town",
    emoji: "🔫",
    assignable: false, // not dealt at start — only a transformed Psycho Killer
    // NOTE: the "kill a Killer / die for shooting an innocent" rule lives in engine.ts.
    description:
      "Hunts the Killers on odd nights (1, 3, 5…). Shoot a Killer and they die. Shoot an innocent and you die for it too.",
    night: {
      order: 55,
      prompt: "It's your night. Shoot a suspected Killer (or hold your fire).",
      canTargetSelf: false,
      canTargetDead: false,
      everyOtherNight: true,
    },
    resolve: (actorId, targetIds, ctx) => {
      const t = targetIds[0];
      if (t) ctx.vigilanteShots[actorId] = t;
    },
  },

  cupid: {
    id: "cupid",
    name: "Cupid",
    team: "town",
    emoji: "💘",
    // NOTE: lovers are linked in engine.ts (computeDeaths chains their deaths).
    description:
      "On the first night, pick two players to become Lovers. If one Lover dies, so does the other.",
    night: {
      order: 5, // resolve early so lovers exist before any deaths
      prompt: "Pick two players to fall in love. If one dies, the other dies too.",
      canTargetSelf: false,
      canTargetDead: false,
      selectCount: 2,
      firstNightOnly: true,
    },
    resolve: (_actorId, targetIds, ctx) => {
      const [a, b] = targetIds;
      if (!a || !b || a === b) return;
      ctx.state.lovers = [a, b];
      ctx.privateResults[a] = `💘 You are in love with ${ctx.nameOf(b)}. If either of you dies, so does the other.`;
      ctx.privateResults[b] = `💘 You are in love with ${ctx.nameOf(a)}. If either of you dies, so does the other.`;
    },
  },

  panchayath: {
    id: "panchayath",
    name: "Panchayat Thalaivar",
    team: "town",
    emoji: "🏛️",
    // NOTE: immunity is enforced in engine.ts (computeDeaths skips them while a Cupid lives).
    description:
      "The village head. The Killers cannot eliminate them at night while a Cupid is still alive. (Still lynchable by day.)",
  },

  item: {
    id: "item",
    name: "Item",
    team: "town",
    emoji: "🎲",
    // NOTE: the curse (dies if the chosen player is a Killer, or dies that night)
    // is applied in engine.ts. Already-visited players are filtered out of the
    // prompt, and the visit is recorded here.
    description:
      "Each night, choose one person to spend the night with — you can't pick the same person twice. If they're a Killer, or they die that night, you die too.",
    night: {
      order: 30,
      prompt: "Choose someone to spend the night with (you can't repeat a past choice).",
      canTargetSelf: false,
      canTargetDead: false,
    },
    resolve: (actorId, targetIds, ctx) => {
      const t = targetIds[0];
      if (!t) return; // skipped (or no one left to visit)
      ctx.itemTargets[actorId] = t;
      ctx.state.itemVisited[actorId] = [
        ...(ctx.state.itemVisited[actorId] ?? []),
        t,
      ];
      ctx.privateResults[actorId] = `🎲 You spent the night with ${ctx.nameOf(t)}.`;
    },
  },

  witch: {
    id: "witch",
    name: "Witch",
    team: "town",
    emoji: "🧙",
    // NOTE: the Witch acts in the reactive "witch" sub-phase (see engine.ts),
    // after the night's deaths are known. Up to WITCH_MAX_REVIVES per game.
    description:
      "After each night, the Witch learns who died and may bring one of them back to life — at most twice per game.",
  },

  // ---- Neutral ----
  jester: {
    id: "jester",
    name: "Jester",
    team: "neutral",
    winsIfLynched: true,
    emoji: "🤡",
    description:
      "Plays alone. The Jester's only goal is to get voted out by the town — if lynched, the Jester wins the game.",
  },
};

export const ROLE_LIST: RoleDef[] = Object.values(ROLES);

// Roles the host can actually deal in the lobby (excludes transform-only roles).
export const ASSIGNABLE_ROLES: RoleDef[] = ROLE_LIST.filter(
  (r) => r.assignable !== false
);

export function isAssignable(roleId: string): boolean {
  return getRole(roleId)?.assignable !== false;
}

export function getRole(id: string | null): RoleDef | null {
  if (!id) return null;
  return ROLES[id] ?? null;
}

// Roles that take a *chosen* night action, in resolution order.
export function nightRolesInOrder(): RoleDef[] {
  return ROLE_LIST.filter((r) => r.night).sort(
    (a, b) => (a.night!.order ?? 0) - (b.night!.order ?? 0)
  );
}

// UI label for a team.
export function teamLabel(team: Team): string {
  return team === "mafia" ? "killers" : team;
}
