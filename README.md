# 🎭 Mafia — real-time party game

A web-based game of **Mafia** (a.k.a. Werewolf) with a **God / narrator** who runs
the game and **players** who join from their own phones with a room code. Roles are
secret, the town argues by day, and the Killers strike by night.

**▶️ Play:** https://mafia-game-gold.vercel.app

Built with **Next.js + Firebase Firestore** — game state lives in Firestore and
pushes live updates to every player, so it runs fully on free serverless hosting.

---

## The goal

Two main sides are fighting (plus a lone trickster):

| Side | Wins when… |
|------|------------|
| 🔵 **Town** | **every Killer is eliminated** |
| 🔴 **Killers** | the Killers **equal or outnumber** everyone else still alive |
| 🟡 **Jester** (neutral) | the town **votes the Jester out** |

The Town finds and votes out the Killers by day; the Killers quietly pick off the
Town by night. The Jester plays for itself and wins only by getting lynched.

---

## How to play

### Setup
1. One person opens the link and taps **Host a new game** → they become the
   **God** (narrator) and get a **4-letter room code**.
2. Everyone else opens the link, enters their **name** and the **code**, and taps
   **Join**.
3. The God sets **how many of each role** to deal (must add up to the number of
   players — the God doesn't get a role) and taps **Start game**.
   - Need at least **3 players** besides the God, at least 1 Killer-side role, and
     the Killers can't already be at parity.

### The round loop
The game alternates **Night → (Witch) → Day**, repeating until a side wins.

#### 🌙 Night
There's **no "wake up one at a time"** — **everyone with a night power acts at the
same time**, privately on their own phone. In a single night that can include:

- 🔪 **Killers / Godfather** choose a victim
- 🪓 **Psycho Killer** (odd nights) / 🔫 **Vigilante** (odd nights) take their shot
- 🚓 **Police** investigate a suspect
- 🩺 **Doctor** heals someone
- 🎲 **Item** picks who to spend the night with
- 💘 **Cupid** links the Lovers (night 1 only)

Players with no night power simply wait. Once **everyone who can act has acted** —
or the God taps **Resolve night** — all the actions are worked out **together**
(heals cancel kills, the Item's curse and Lovers' fate apply, etc.).

#### 🧙 Witch interlude (only if a Witch is alive and someone died)
Before morning is announced, the game pauses just for the **Witch**: she's shown
who died and may **revive one** of them (see her role below). Everyone else waits.

#### ☀️ Day
Morning is announced (who died overnight). Players **discuss in the Town chat**
(anonymously) and any private night results appear (e.g. the Police's finding).
Then everyone **votes** to eliminate a suspect.

When everyone has voted — or the God taps **Resolve vote** — the result is applied,
the eliminated player's role is **revealed**, and night falls again.

---

## Voting & ties

- Each living player casts **one vote** (or **Skip**). The God sees a live tally.
- The player with the **most votes is eliminated** — only **one** person per day.
- Their role is **revealed** to everyone in the story log.

### Tie-break
If two or more players tie for the most votes:

1. **The town chooses:** everyone votes **⏭️ Skip** (no elimination) or
   **🔁 Revote**.
2. **If Revote wins:** everyone votes again, but **only the tied players** can be
   chosen.
3. **If the revote ties again** — or the Skip-vs-Revote vote itself ties — the
   **God decides** (Skip or Revote) to break the deadlock.

---

## Roles

### 🔴 Killers' side
| Role | Power |
|------|-------|
| 🔪 **Killer** | Each night, the Killers choose **one player to eliminate**. |
| 🎩 **Godfather** | Eliminates like a Killer, **but reads as innocent** if the Police investigate them. |
| 🪓 **Psycho Killer** | A lone killer who strikes **only on odd nights** (1, 3, 5…). **Twist:** if the Doctor ever heals the Psycho, they **secretly transform into a 🔫 Vigilante** (Town) — only they are told. |

### 🔵 Town
| Role | Power |
|------|-------|
| 🚓 **Police** | Each night, investigate one player and **privately learn if they are a Killer**. With several Police, the squad makes **one shared check** per night (the most-chosen suspect). The Godfather fools them. |
| 🩺 **Doctor** | Each night, **heal one player** (may heal **themselves**) — if they're attacked that night, they survive. (Healing the Psycho Killer triggers its transformation.) |
| 💘 **Cupid** | On **night 1 only**, pick **two players** to become **Lovers**. |
| 🏛️ **Panchayat Thalaivar** | The village head — **Killers cannot kill them at night while any Cupid is alive**. They can **always be voted out by day**, even while a Cupid lives. |
| 🎲 **Item** | Each night, **choose someone to spend the night with** — you **can't pick the same person twice**. The Item **dies** if that player is a **Killer**, or if that player **dies that night**. |
| 🧙 **Witch** | After each night, she learns **who died** and may **bring one of them back** — at most **twice per game**. She **can't revive herself** (if she dies that night, she has no turn). |
| 🧑‍🌾 **Villager** | No special power. Use discussion and votes to find the Killers. |
| 🔫 **Vigilante** | *Not dealt at the start* — a Doctor-healed Psycho becomes one. Shoots on **odd nights**: kills a **Killer** cleanly, but **dies** if they shoot an innocent. |

### 🟡 Neutral
| Role | Power |
|------|-------|
| 🤡 **Jester** | Plays alone. **Wins instantly if the town votes them out.** Has no night power — their whole game is acting suspicious enough to get lynched. |

---

## Special mechanics

- **💞 Lovers** (created by Cupid): if **one Lover dies** — by a night kill **or** a
  day lynch — the **other dies too**. They're privately told who they love.
- **🎲 The Item's curse:** each night the Item **chooses** someone to spend the
  night with (never the same person twice). Chose a Killer → the Item dies. Chose
  someone who dies that night → the Item dies with them.
- **🪓→🔫 Psycho → Vigilante:** if the Doctor heals the Psycho Killer (any night),
  the Psycho **secretly becomes a Vigilante** (now Town-aligned). Only that player
  is notified; a fresh dramatic reveal shows their new role.
- **🧙 Witch revives:** linked deaths are shown to the Witch as **one** person
  (e.g. a Lover pair, or a villager + the Item that died with them). Reviving that
  one person **brings the whole bound group back**; not reviving leaves them all
  dead. Max **2 revives** per game.
- **🏛️ Panchayat immunity:** Killers can't kill the Panchayat Thalaivar at night as
  long as a Cupid is alive — but the **day vote can always eliminate them**, Cupid
  or not.
- **🧙 No self-revive:** the Witch can never bring **herself** back. If she dies in
  the night, she gets no revive turn.

---

## Chat

- **🏙️ Town chat** — open during the **day**. Messages are **anonymous**: you see
  your own as "You" and everyone else as "Anonymous", so no one can prove who said
  what. The **God sees every real sender** and can also drop **anonymous** messages.
- **🔪 Killers' room** — a private channel for the **Killer + Godfather** (they see
  each other's real names to coordinate), open at night and day. The **God can read
  it and whisper anonymously**. The Psycho Killer is a lone wolf and is **not** in
  this room. A 🔴 badge shows unread messages.

---

## Privacy & quality-of-life

- **Hide your role:** your role is **hidden by default** in the header (tap to
  reveal, tap again to hide) — so a glance at your phone gives nothing away.
- **Dramatic reveal:** when you're dealt a role (or it changes), a full-screen
  reveal builds suspense and shows your card with a team-colored glow.
- **Refresh-safe:** reloading keeps you in the room.
- **Rejoin by name:** leave and come back (even from another device, even
  mid-game) — enter the **same name** to reclaim your seat, role, and chat history.
- **Responsive:** bottom tab bar on mobile, left-hand menu on desktop —
  Game / Chat / Players / Story.

---

## Run it locally

```bash
npm install
cp .env.local.example .env.local   # then fill in your Firebase values
npm run dev
```

Open http://localhost:3000. To test multiple players on one machine, open several
incognito windows (each needs its own browser identity).

## Architecture

- **Next.js app** (UI + `/api` routes) — deploys to **Vercel** for free, never sleeps.
- **Firestore** stores each room. The server (`/api` routes via the Firebase Admin
  SDK) is the only thing that mutates state; it writes a **per-player view
  document** that hides other players' roles, and browsers subscribe to their own
  view doc for instant live updates.
- Game logic is transport-agnostic in `src/game/`:
  - `roles.ts` — the role registry (one entry per role).
  - `engine.ts` — pure game logic over a `Room` object (phases, night resolution,
    voting/tiebreak, win checks, per-player views).
  - `actions.ts` — maps player actions onto the engine.

## Adding new roles

Most roles are **one entry in `src/game/roles.ts`** — name, team, emoji,
description, an optional `night` block (if it acts at night), and a `resolve`
function for its power. The lobby, dealing, night prompts, and resolution pick it
up automatically. Roles with cross-player effects (Lovers, Item, Witch, Panchayat)
have a small note pointing to their extra logic in `engine.ts`.

## Deploying (free: Vercel + Firebase)

1. **Firebase:** create a project, enable **Firestore**, register a **Web app**
   (gives the `NEXT_PUBLIC_FIREBASE_*` values), and generate a **service-account
   key** (the `FIREBASE_SERVICE_ACCOUNT` JSON). Publish the rules in
   `firestore.rules`.
2. **Vercel:** import the GitHub repo, add the 7 environment variables from
   `.env.local.example`, and deploy.

Secrets live only in `.env.local` (git-ignored) and Vercel's encrypted env vars —
never in the repo.
