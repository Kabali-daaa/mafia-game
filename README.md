# 🎭 Mafia — real-time party game

A web-based Mafia game with a **host** (narrator) and **players** who join from
their own phones using a room code. Built with Next.js + Socket.IO so the whole
table sees the game update live.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. To test with multiple players on one machine, open
several browser tabs (use incognito / different browsers so each gets its own
player id). On the same WiFi, others can reach you at `http://<your-ip>:3000`.

## How to play

1. One person clicks **Create room** — they become the Host/narrator and get a
   4-letter code.
2. Everyone else clicks **Join room**, enters the code and their name.
3. The host sets how many of each role to deal, then **Start game**.
   - Roles must add up to the number of players (the host doesn't get a role).
4. **Night** 🌙 — players with powers act secretly (Killers kill, Police
   investigate, Cupid links Lovers, the Witch may revive, etc.).
5. **Day** ☀️ — everyone discusses out loud, then votes someone out.
6. Repeat until the **Town** eliminates all Killers, or the **Killers** reach
   parity (or the **Jester** gets themselves lynched).

## Roles

| Role | Side | Power |
|------|------|-------|
| 🔪 Killer | Killers | Each night, choose one player to eliminate |
| 🎩 Godfather | Killers | Eliminates like a Killer, but the Police see them as innocent |
| 🪓 Psycho Killer | Killers | Kills on **odd nights** only; if the Doctor heals them, secretly becomes a Vigilante |
| 🚓 Police | Town | Each night, privately learn if a player is a Killer |
| 🩺 Doctor | Town | Each night, heal one player; an attack on them fails |
| 🔫 Vigilante | Town | Shoots on **odd nights**: kills a Killer cleanly, but dies if they shoot an innocent |
| 💘 Cupid | Town | Night 1 only: pick 2 players to become Lovers (linked fate) |
| 🏛️ Panchayat Thalaivar | Town | Killers can't kill them at night while a Cupid is alive |
| 🎲 Item | Town | Drawn to a random new player each night; dies if it's a Killer, or if they die |
| 🧙 Witch | Town | After each night, may revive one of the dead — twice per game |
| 🧑‍🌾 Villager | Town | No power — vote wisely |
| 🤡 Jester | Neutral | Wins if the town votes them out |

**Lovers** isn't a dealt role — it's the bond Cupid creates between two players. If
one Lover dies (night kill or day lynch), the other dies too.

### Chat
- **Town chat** — open during the day. Messages are **anonymous** to players (you
  see your own as "You", everyone else as "Anonymous"). The **host/God sees every
  real sender**.
- **Killers' room** — a private channel for the **Killer + Godfather** (real names
  among themselves), open at night and day. The **God can read it too**. The
  Psycho Killer is a lone wolf and is not in this room.

### Night flow
Players with night powers act in secret, the Item is drawn automatically, then —
if anyone died and a Witch is alive — the game pauses for the **Witch** to decide
whether to revive before morning is announced.

## Adding new roles & powers

Everything lives in **`src/game/roles.ts`**. Add one entry to the `ROLES`
object: its name/team/emoji/description, an optional `night` block (if it acts
at night), and a `resolve` function describing the power. The lobby, role
dealing, night prompts, and resolution all pick it up automatically — no other
files to touch for most roles.

## Deploying

This needs an **always-on Node server with WebSockets**, so it does *not* run on
Vercel's serverless functions. Easiest options (all have free tiers):

- **Railway** — New Project → Deploy from repo. It auto-detects Node. Set the
  start command to `npm run start` and it gives you a public URL.
- **Render** — New → Web Service → connect repo. Build: `npm install && npm run build`.
  Start: `npm run start`.
- **Fly.io / a VPS** — run `npm run build` then `npm run start` behind the
  platform's port (`PORT` env var is respected).

Build for production locally to verify:

```bash
npm run build && npm run start
```
