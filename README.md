# 🎭 Mafia — real-time party game

A web-based game of **Mafia** (a.k.a. Werewolf) with a **God / narrator** who runs
the game and **players** who join from their own phones with a room code. Roles are
secret, the town argues by day, and the Killers strike by night.

**▶️ Play:** https://game-mafia.vercel.app

Built with **Next.js + Firebase Firestore** — game state lives in Firestore and
pushes live updates to every player, so it runs fully on free serverless hosting —
plus **Google Gemini** for an AI-written end-game story.

---

## ✨ Features at a glance

- 🎭 **12 roles** across Killers / Town / Neutral — each with distinct night powers and
  twists (transformations, cross-team lovers, a deadly curse, village immunity, a
  trickster who wins by losing).
- 📱 **Phone-first & real-time** — join by **QR or link**, instant Firestore updates,
  refresh-safe, and **rejoin-by-name** even from another device mid-game.
- 🎙️ **God / narrator mode** — host-stepped nights with a live "who-acted" board and
  **skip-safe** controls that can't accidentally drop a player's action.
- 🔔 **Never miss your move** — turn pop-ups (vote / kill / heal / investigate…),
  tap-gated private-result pop-ups, and tab badges for chat / story / your turn.
- 🕵️ **Full mystery** — roles are **never revealed mid-game**, not on death, not on
  banishment; the morning narration is gruesome but role-blind.
- ✨ **AI story recap** (Gemini) — the whole match retold as a cinematic,
  fact-grounded tale, with every role finally unmasked.
- 🌗 **Dark, responsive UI** — bottom tabs on mobile, a left menu on desktop, zero
  horizontal overflow (verified by a browser sweep).
- 🆓 **Runs free** on Vercel + Firebase.

---

## The goal

Two main sides are fighting (plus a lone trickster):

| Side | Wins when… |
|------|------------|
| 🔵 **Town** | **every Killer is eliminated** |
| 🔴 **Killers** | the Killers **equal or outnumber** everyone else still alive |
| 🟡 **Jester** (neutral) | the town **votes the Jester out** |
| 💞 **Lovers** (cross-team couple) | the two linked Lovers are the **last two players alive** |

The Town finds and votes out the Killers by day; the Killers quietly pick off the
Town by night. The Jester plays for itself and wins only by getting voted out (banished).

### Every winning scenario in detail

The game checks for a winner **after each night is resolved** and **after every day
elimination**. The first side to meet its condition wins immediately.

- 🔵 **Town victory — all Killers gone.** The moment the number of living
  Killer-side players (Killer + Godfather + Psycho) hits **zero**, the Town wins.
  This can happen by a **day vote** (banishing the last Killer) or at **night**
  (e.g. the Vigilante shoots the last Killer, or a Killer is caught in the Item's /
  Lovers' linked fate).
- 🔴 **Killers victory — parity.** As soon as the living Killers **equal or
  outnumber** everyone else alive (`killers ≥ everyone-else`), the Killers win — they
  can no longer be out-voted. This usually triggers at **night** after a kill brings
  the town down to the Killers' level, but it can also trigger **by day** if a vote
  banishes a townsperson and tips the balance.
- 🟡 **Jester victory — banished.** The Jester wins **instantly and alone** the moment
  the **town votes them out** during the day — banished to live free in the forest, just
  as they dreamed. (Being killed at *night* does **not**
  win it for the Jester — it must be the day vote.) A Jester win ends the game even if
  a Town or Killer condition would also be met that turn.
- 💞 **Lovers victory — last two standing.** If Cupid links two players from **opposite
  sides** (e.g. a Police officer and a Killer), their bond overrides their teams: they
  win **together** the moment the **only two players left alive are the couple**. This
  is checked *before* the Town/Killer conditions, so a final Cop-lover + Killer-lover
  pair is a **Lovers win**, not a Killer win. (Lovers on the *same* side don't form a
  separate couple — they just resolve as their shared team.) A **Jester** counts as
  cross-team with anyone, so a Jester-lover can also win this way — surviving to the
  final couple, even without being voted out.

### Things that affect who wins

- **Surviving neutrals delay a Killer win.** A living Jester counts as one of
  "everyone else," so the Killers need one more kill to reach parity while the Jester
  is still around.
- **Lovers die together** — a night kill or a daytime banishment of one Lover kills the
  other of heartbreak. If they're on the **same** side they don't form a separate couple (their
  shared team's condition decides); if they're **cross-team** they win as a couple by
  being the last two alive (see the Lovers victory above).
- **A transformed Psycho counts for the Town.** Once the Doctor heals the Psycho
  Killer and it becomes a Vigilante, it no longer counts as a Killer — that alone can
  hand the Town the win if it was the last Killer-side player.
- **No one is left?** With the win checked after every death, the parity rule means
  the Killers clinch it before the town could ever be wiped to literally zero.

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
The game alternates **Night → Day**, repeating until a side wins. The God paces
everything — calling each night role in turn, then opening the vote and starting
the next night when ready.

#### 🌙 Night
Like an in-person narrator, the **God calls each role-group one at a time** and
taps **Next** to move on. Only the called role can act; everyone else waits. The
God sees a live board of **who acted and what they chose**. The order is:

1. 💘 **Cupid** — links the Lovers (night 1 only)
2. 🔪 **Killers / Godfather** — agree on **one** victim (one kill total, even with several)
3. 🪓 **Psycho Killer** (odd nights)
4. 🔫 **Vigilante** (odd nights, after transforming)
5. 🎲 **Item** — pick who to spend the night with
6. 🧙 **Witch** — shown who was **attacked**, may **save** one (blind to the Doctor)
7. 🩺 **Doctor** — heal someone
8. 🚓 **Police** — investigate a suspect

The attackers are always called **before** the Witch (so she truly sees who was
hit). The God **can't advance past a group while a connected member still hasn't
acted** — they get a "still waiting on…" notice and must wait or explicitly skip
that player, so a stray tap can never silently drop the Killers' kill. Players also
get a **pop-up when it's their turn** (vote / kill / heal / investigate…) so no one
misses their move.

On the last role the God taps **Resolve night** and everything is worked out
together (saves cancel kills, the Item's curse and Lovers' fate apply, etc.). Order
of resolution puts **protectors before kills**: the Doctor's heal and the Witch's
save are applied first, then the attacks land on whoever's left unprotected.

#### ☀️ Day
Morning is announced with a bit of flavour — who died overnight and *how* (poisoned,
stabbed, strangled…), but **never their role**. Players **discuss in the Town chat**
(anonymously) and any private night results appear (e.g. the Police's finding).
Then everyone **votes** to **banish** a suspect from the village (the day vote is an
exile, not an execution — that's the Jester's dream, and the Killers' nightly murders
are the real deaths).

When everyone has voted — or the God taps **Resolve vote** — the result is applied
and night falls again. The banished player's role is **never revealed** — the town is
left guessing (all roles are shown only on the end-game screen).

---

## Voting & ties

- Each living player casts **one vote** (or **Skip**). The God sees a live tally.
- The player with the **most votes is banished** — only **one** person per day.
- Their role is **never revealed** — no one learns what they were (until the game ends).

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
| 🔪 **Killer** | Each night the Killers — **as a team** — choose **one** player to eliminate. Even with several Killers + the Godfather, it's still **one kill per night** (the most-chosen target; ties broken at random). |
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
| 🧙 **Witch** | Called by the God after the Killers. She's shown **who was attacked** that night and may **save one of them** (**never herself**) — but she **won't know if the Doctor already protected them** (a redundant save is wasted). Only **twice per game**. |
| 🧑‍🌾 **Villager** | No special power. Use discussion and votes to find the Killers. |
| 🔫 **Vigilante** | *Not dealt at the start* — a Doctor-healed Psycho becomes one. Shoots on **odd nights**: kills a **Killer** cleanly, but **dies** if they shoot an innocent. |

### 🟡 Neutral
| Role | Power |
|------|-------|
| 🤡 **Jester** | A lone trickster who **dreams of being banished to live free in the forest** — so they **win instantly if the town votes them out**. No night power; their whole game is acting suspicious enough to get voted out. Being killed by the Killers at night is the one fate they dread. |

---

## Special mechanics

- **💞 Lovers** (created by Cupid): if **one Lover dies** — by a night kill **or** a
  daytime banishment — the **other dies too**. They're privately told who they love.
- **🎲 The Item's curse:** each night the Item **chooses** someone to spend the
  night with (never the same person twice). Chose a Killer → the Item dies. Chose
  someone who dies that night → the Item dies with them.
- **🪓→🔫 Psycho → Vigilante:** if the Doctor heals the Psycho Killer (any night),
  the Psycho **secretly becomes a Vigilante** (now Town-aligned). Only that player
  is notified; a fresh dramatic reveal shows their new role.
- **🧙 Witch saves blind:** when the God calls her, she sees who the Killers
  **attacked** and may shield one — but she's **not told whether the Doctor already
  protected them**, so a redundant save is wasted. Max **2 saves** per game, and she
  **cannot save herself** — if she's the one under attack, only the Doctor can spare her.
- **🏛️ Panchayat immunity:** Killers can't kill the Panchayat Thalaivar at night as
  long as a Cupid is alive — but the **day vote can always eliminate them**, Cupid
  or not.

---

## ✨ AI story recap (Google Gemini)

When the game ends, the God can tap **"✨ Write the story"** and an AI narrator turns
the whole match into a short, cinematic tale — naming every player, revealing their
secret role, and retelling each night and day in order, building to the winning side.
It's a world apart from a fill-in-the-blanks template.

- **Grounded in the real game.** The server builds a *factual brief* from the hidden
  chronicle (who acted on whom each night, every death and how, every banishment, the
  winner) and instructs the model to dramatize it **without inventing anything** — no
  invented deaths, saves, or roles.
- **Timeline-accurate.** Each role is described **as it was at that moment**: a Psycho
  the Doctor healed is the "Psycho Killer" on early nights and only "becomes the
  Vigilante" as a twist *when it actually happens* — never back-dated. An explicit
  final *survived / fell* list keeps the wrap-up honest.
- **Generated once, shared with everyone.** The recap is saved on the room so every
  player sees the same story; the God can **🔄 Rewrite** for a different take. The
  cryptic in-game death narration is hidden at the end so only the clean recap shows.
- **Host-controlled & safe to omit.** Only the God can trigger it (one API call per
  tap). Set `GEMINI_API_KEY` to enable it (model defaults to **`gemini-2.5-flash-lite`**,
  which works on Gemini's free tier; override with `GEMINI_MODEL`). With no key
  configured, the game simply shows the plain chronicle recap instead.

The call lives server-side in `src/lib/story.ts` (prompt + Gemini REST) behind the
`/api/story` route; the key is read from the environment and **never reaches the
browser**.

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

- **Join by link or QR:** the lobby shows a **QR code** and a **share link**
  (`/?room=CODE`) — scan or tap and the room code is pre-filled, no typing.
- **In-app help:** a **?** button in the header opens **Rules, Roles & Twists** any time.
- **Turn pop-ups & notifications:** when it's your move, a pop-up shows the exact
  action (vote / kill / heal / investigate…) so you never miss it; **private results**
  (the Police's finding, Cupid's love note) pop up too — tap-gated so a passer-by can't
  read them. Tab badges flag **new chat messages**, **new Story entries**, and **your
  turn**.
- **Skip-safe God controls:** the God's advance button **confirms before skipping**
  anyone who hasn't finished their duty, and refuses to drop an un-acted group — so a
  double-tap can't cost a player their action.
- **Creative death reveals:** each morning narrates who fell and *how* (poisoned,
  stabbed, drowned…) with variety — without ever leaking their role. (A fuzz test over
  20k games verifies no role word ever leaks into the in-game story.)
- **Story, paced right:** the running story is **hidden at night** and updates by day,
  and at the end you get the **AI story recap** (see above) — or, with no AI key, the
  full **chronicle** replayed with every role revealed.
- **Hide your role:** your role is **hidden by default** in the header (tap to
  reveal, tap again to hide) — so a glance at your phone gives nothing away.
- **Dramatic reveal:** when you're dealt a role (or it changes), a full-screen
  reveal builds suspense and shows your card with a team-colored glow.
- **Refresh-safe:** reloading keeps you in the room.
- **Rejoin by name:** leave and come back (even from another device, even
  mid-game) — enter the **same name** to reclaim your seat, role, and chat history.
- **Responsive:** bottom tab bar on mobile, left-hand menu on desktop —
  Game / Chat / Players / Story.
- **Lean on Firestore:** unchanged per-player views are skipped on each write
  (roughly **halving writes**), and abandoned rooms **auto-expire after 12h**.

---

## Run it locally

```bash
npm install
cp .env.local.example .env.local   # then fill in your Firebase values
npm run dev
```

Open http://localhost:3000. To test multiple players on one machine, open several
incognito windows (each needs its own browser identity).

### Tests

```bash
npm test     # fast in-memory unit tests for the game engine (no Firebase)
```

`src/game/engine.test.ts` exercises the rules — dealing, the Killers' single kill,
Doctor/Witch saves, Police checks, Lovers, the Item's curse, the Psycho→Vigilante
transform, Panchayat immunity, voting/ties, and **every win condition** — directly
over an in-memory `Room`, so it runs in milliseconds and never touches Firestore.

Two heavier **sweeps** live in `scripts/` and run against a local dev server + your
Firebase project, so they **use Firestore quota** — run them deliberately:

```bash
node scripts/e2e-all.mjs     # 90+ end-to-end checks: every role, win condition, voting/ties, chat, reconnect
node scripts/visual-all.mjs  # drives a real browser (Puppeteer) through every UI state, asserts no overflow, saves screenshots
```

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
- **AI recap:** `src/lib/story.ts` (server-only) builds the factual brief from the
  room's chronicle and calls Gemini; the `/api/story` route (host-only) generates it
  once the game ends and saves it onto the room for everyone to see.

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
2. **Gemini (optional, for the AI recap):** grab a free key at
   [aistudio.google.com](https://aistudio.google.com/app/apikey) and set it as
   `GEMINI_API_KEY` (optionally `GEMINI_MODEL`). Skip it and the game falls back to the
   plain chronicle recap.
3. **Vercel:** import the GitHub repo, add the environment variables from
   `.env.local.example` (the 7 Firebase values, plus `GEMINI_API_KEY` for the AI
   story), and deploy.

Secrets live only in `.env.local` (git-ignored) and Vercel's encrypted env vars —
never in the repo.
