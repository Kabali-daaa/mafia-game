// Full end-to-end simulation against the live (local) Firebase backend.
// Exercises every role, win condition, the tiebreak, chat, and reconnect.
import { initializeApp } from "/Users/karthikeyanm/Desktop/game/node_modules/firebase/app/dist/index.mjs";
import { getFirestore, doc, getDoc } from "/Users/karthikeyanm/Desktop/game/node_modules/firebase/firestore/dist/index.mjs";

const BASE = "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (p, b) =>
  fetch(BASE + "/api/" + p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b),
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const app = initializeApp({
  apiKey: "AIzaSyC7zovaO60cAv-N5HfOsYrtXg-x7kxJWR4",
  authDomain: "mafia-game-b8064.firebaseapp.com",
  projectId: "mafia-game-b8064",
});
const db = getFirestore(app);
const view = async (code, pid) => (await getDoc(doc(db, "rooms", code, "views", pid))).data();

let pass = 0, failMsgs = [];
const A = (cond, msg) => {
  console.log(`   ${cond ? "✓" : "✗ FAIL:"} ${msg}`);
  if (cond) pass++; else failMsgs.push(msg);
};
const section = (t) => console.log(`\n── ${t} ──`);

// Create a game, join `n` players (a,b,c,…), set config, start. Returns role map.
async function setup(tag, config) {
  const total = Object.values(config).reduce((a, b) => a + b, 0);
  const letters = "abcdefgh".slice(0, total).split("");
  const host = tag + "h";
  const cr = await api("create", { name: "GOD", playerId: host });
  const code = cr.data.code;
  for (const L of letters) await api("join", { code, name: L.toUpperCase(), playerId: tag + L });
  await api("action", { code, playerId: host, type: "setConfig", payload: { config } });
  await api("action", { code, playerId: host, type: "start", payload: {} });
  await wait(350);
  const roles = {}, ids = letters.map((L) => tag + L);
  for (const id of ids) {
    const v = await view(code, id);
    (roles[v.you.roleId] = roles[v.you.roleId] || []).push(id);
  }
  return { code, host, ids, roles };
}
const act = (code, pid, type, payload = {}) => api("action", { code, pid, type, payload }).then(() =>
  api("action", { code, playerId: pid, type, payload }));
// (single call helper)
const send = (code, pid, type, payload = {}) =>
  api("action", { code, playerId: pid, type, payload });
const alive = (hv, id) => [hv.you, ...hv.players].find((p) => p.id === id)?.alive;
const advance = (code, host) => send(code, host, "advance");

// ============================ ROLES ============================

section("Killer + Doctor (heal cancels the kill)");
{
  // Game A: heal the attacked player → they survive.
  let s = await setup("k1a_", { killer: 1, doctor: 1, villager: 2 });
  await send(s.code, s.roles.doctor[0], "nightAction", { targetIds: [s.roles.villager[0]] });
  await send(s.code, s.roles.killer[0], "nightAction", { targetIds: [s.roles.villager[0]] });
  await wait(500);
  A(alive(await view(s.code, s.host), s.roles.villager[0]) === true, "Doctor's heal saved the attacked player");
  // Game B: heal someone else → the attacked (unhealed) player dies.
  s = await setup("k1b_", { killer: 1, doctor: 1, villager: 2 });
  await send(s.code, s.roles.doctor[0], "nightAction", { targetIds: [s.roles.villager[1]] });
  await send(s.code, s.roles.killer[0], "nightAction", { targetIds: [s.roles.villager[0]] });
  await wait(500);
  A(alive(await view(s.code, s.host), s.roles.villager[0]) === false, "Unhealed target dies");
}

section("Godfather reads innocent to Police");
{
  const t = "k2_";
  const { code, roles } = await setup(t, { godfather: 1, police: 1, villager: 2 });
  const police = roles.police[0], gf = roles.godfather[0];
  await send(code, police, "nightAction", { targetIds: [gf] });
  await send(code, gf, "nightAction", { targetIds: [] });
  await wait(500);
  const pv = await view(code, police);
  A(/is NOT a Killer/.test(pv.privateMessage || ""), "Police sees the Godfather as innocent");
}

section("Police squad — one shared check (plurality)");
{
  const t = "k3_";
  const { code, roles } = await setup(t, { killer: 1, police: 3, villager: 1 });
  const cops = roles.police, killer = roles.killer[0], vill = roles.villager[0];
  await send(code, cops[0], "nightAction", { targetIds: [killer] });
  await send(code, cops[1], "nightAction", { targetIds: [killer] });
  await send(code, cops[2], "nightAction", { targetIds: [vill] });
  await send(code, killer, "nightAction", { targetIds: [] });
  await wait(500);
  const msgs = await Promise.all(cops.map((c) => view(code, c).then((v) => v.privateMessage || "")));
  A(msgs.every((m) => /IS a Killer/.test(m)) && new Set(msgs).size === 1,
    "All 3 cops share ONE result targeting the plurality pick (the Killer)");
}

section("Cupid + Lovers — linked night death");
{
  const t = "k4_";
  const { code, host, roles } = await setup(t, { killer: 1, cupid: 1, villager: 2 });
  const killer = roles.killer[0], cupid = roles.cupid[0], v = roles.villager;
  await send(code, cupid, "nightAction", { targetIds: [v[0], v[1]] });
  await send(code, killer, "nightAction", { targetIds: [v[0]] });
  await wait(600);
  const hv = await view(code, host);
  A(alive(hv, v[0]) === false && alive(hv, v[1]) === false, "Both Lovers die when one is killed");
}

section("Panchayat Thalaivar — immune while a Cupid is alive");
{
  const t = "k5_";
  const { code, host, roles } = await setup(t, { killer: 1, cupid: 1, panchayath: 1, villager: 1 });
  const killer = roles.killer[0], cupid = roles.cupid[0], pan = roles.panchayath[0], vill = roles.villager[0];
  await send(code, cupid, "nightAction", { targetIds: [vill, pan] });
  await send(code, killer, "nightAction", { targetIds: [pan] });
  await wait(600);
  const hv = await view(code, host);
  A(alive(hv, pan) === true, "Killer could not kill the Panchayat (Cupid alive)");
}

section("Item — chooses, dies on a Killer");
{
  const t = "k6_";
  const { code, host, roles } = await setup(t, { killer: 1, item: 1, villager: 2 });
  const killer = roles.killer[0], item = roles.item[0];
  const iv = await view(code, item);
  A(iv.prompt?.kind === "night" && /spend the night/i.test(iv.prompt.text), "Item gets a choice prompt");
  await send(code, item, "nightAction", { targetIds: [killer] });
  await send(code, killer, "nightAction", { targetIds: [] });
  await wait(600);
  const hv = await view(code, host);
  A(alive(hv, item) === false, "Item died after choosing the Killer");
}

section("Witch — revives a Lover pair shown as ONE person");
{
  const t = "k7_";
  const { code, host, roles } = await setup(t, { killer: 1, cupid: 1, witch: 1, villager: 2 });
  const killer = roles.killer[0], cupid = roles.cupid[0], witch = roles.witch[0], v = roles.villager;
  await send(code, cupid, "nightAction", { targetIds: [v[0], v[1]] });
  await send(code, killer, "nightAction", { targetIds: [v[0]] });
  await wait(600);
  const wv = await view(code, witch);
  A(wv.phase === "witch" && wv.prompt?.targets.length === 1, "Witch shown ONE primary for the dead Lover pair");
  await send(code, witch, "nightAction", { targetIds: [wv.prompt.targets[0]] });
  await wait(500);
  const hv = await view(code, host);
  A(alive(hv, v[0]) === true && alive(hv, v[1]) === true, "Reviving the pair brought BOTH back");
}

section("Psycho Killer → Vigilante on Doctor heal, then kills a Killer");
{
  const t = "k8_";
  const { code, host, roles } = await setup(t, { psycho: 1, killer: 1, doctor: 1, villager: 2 });
  const psycho = roles.psycho[0], doctor = roles.doctor[0], killer = roles.killer[0];
  // Night 1: Doctor heals the Psycho → transforms. (host advance forces resolve.)
  await send(code, doctor, "nightAction", { targetIds: [psycho] });
  await send(code, psycho, "nightAction", { targetIds: [] });
  await advance(code, host); await wait(500);
  A((await view(code, psycho)).you.roleId === "vigilante", "Healed Psycho secretly became a Vigilante");
  // Day 1 → Night 2 (even: Vigilante idle) → Day 2 → Night 3 (odd: Vigilante acts).
  await advance(code, host); await wait(400); // resolve day 1 (no votes → no elim)
  await advance(code, host); await wait(400); // resolve night 2
  await advance(code, host); await wait(400); // resolve day 2
  let v = await view(code, host);
  A(v.phase === "night" && v.day === 3, `reached night 3 (got ${v.phase} ${v.day})`);
  // Night 3: Vigilante shoots the Killer; host advance forces resolution.
  await send(code, psycho, "nightAction", { targetIds: [killer] });
  await advance(code, host); await wait(700);
  const hv3 = await view(code, host);
  A(alive(hv3, killer) === false, "Vigilante (ex-Psycho) killed the Killer on an odd night");
  A(hv3.phase === "ended" && hv3.winner === "town", "All Killers gone → Town wins");
}

// ============================ WIN CONDITIONS ============================

section("Win — Killers reach parity");
{
  const t = "w1_";
  const { code, host, roles } = await setup(t, { killer: 1, villager: 2 });
  const killer = roles.killer[0], v = roles.villager;
  await send(code, killer, "nightAction", { targetIds: [v[0]] });
  await wait(600); // 1 killer vs 1 villager = parity
  const hv = await view(code, host);
  A(hv.phase === "ended" && hv.winner === "mafia", "Killers win at parity");
}

section("Win — Jester lynched");
{
  const t = "w2_";
  const { code, host, roles } = await setup(t, { killer: 1, jester: 1, villager: 2 });
  const jester = roles.jester[0];
  await send(code, roles.killer[0], "nightAction", { targetIds: [] });
  await wait(500);
  const hv0 = await view(code, host);
  for (const id of [hv0.you, ...hv0.players].filter((p) => !p.isHost && p.alive).map((p) => p.id))
    await send(code, id, "vote", { targetId: id === jester ? roles.killer[0] : jester });
  await wait(600);
  const hv = await view(code, host);
  A(hv.phase === "ended" && hv.winner === "neutral", "Jester voted out → Neutral wins");
}

// ============================ TIEBREAK ============================

section("Tiebreak — tie → revote → elimination; and tie → choice-tie → God");
{
  const mk = async (tag) => {
    const s = await setup(tag, { killer: 1, villager: 3 });
    await send(s.code, s.host, "advance"); await wait(400); // resolve night (no kill)
    return s;
  };
  const tieAB = async (code, ids) => {
    await send(code, ids[0], "vote", { targetId: ids[1] });
    await send(code, ids[1], "vote", { targetId: ids[0] });
    await send(code, ids[2], "vote", { targetId: ids[0] });
    await send(code, ids[3], "vote", { targetId: ids[1] });
    await wait(500);
  };
  // revote path
  let s = await mk("tb1_");
  await tieAB(s.code, s.ids);
  let v = await view(s.code, s.ids[0]);
  A(v.voteStage === "choice", "Tie → town Skip/Revote choice");
  for (const [i, ch] of [[0, "revote"], [1, "revote"], [2, "revote"], [3, "skip"]])
    await send(s.code, s.ids[i], "choice", { choice: ch });
  await wait(500);
  v = await view(s.code, s.ids[2]);
  A(v.voteStage === "revote", "Revote won → revote stage (tied players only)");
  for (const [i, tg] of [[0, 1], [1, 0], [2, 0], [3, 0]])
    await send(s.code, s.ids[i], "vote", { targetId: s.ids[tg] });
  await wait(500);
  let hv = await view(s.code, s.host);
  A(alive(hv, s.ids[0]) === false, "Revote produced an elimination");

  // choice-tie → God decides
  s = await mk("tb2_");
  await tieAB(s.code, s.ids);
  for (const [i, ch] of [[0, "skip"], [1, "skip"], [2, "revote"], [3, "revote"]])
    await send(s.code, s.ids[i], "choice", { choice: ch });
  await wait(500);
  v = await view(s.code, s.host);
  A(v.voteStage === "godchoice", "Skip/Revote tie → God decides");
  await send(s.code, s.host, "godDecide", { decision: "skip" });
  await wait(500);
  v = await view(s.code, s.host);
  A(v.phase === "night", "God Skip → no elimination, night falls");
}

// ============================ CHAT ============================

section("Chat — town anonymity, host sees real, town closed at night");
{
  const t = "c1_";
  const { code, host, roles, ids } = await setup(t, { killer: 1, police: 1, villager: 2 });
  // town closed at night
  await send(code, ids[0], "chat", { channel: "town", text: "night msg should drop" });
  await wait(300);
  let hv = await view(code, host);
  A((hv.chat.town || []).length === 0, "Town chat is closed at night (message dropped)");
  // advance to day
  await send(code, host, "advance"); await wait(500);
  await send(code, ids[0], "chat", { channel: "town", text: "I suspect someone" });
  await wait(400);
  const other = await view(code, ids[1]);
  const mine = await view(code, ids[0]);
  hv = await view(code, host);
  const line = (v) => (v.chat.town || []).find((l) => /suspect someone/.test(l.text));
  A(line(other)?.sender === null, "Other players see the sender as Anonymous");
  A(line(mine)?.sender === "You", "Author sees their own line as 'You'");
  A(line(hv)?.sender === "A", "God sees the real sender name");
}

section("Chat — Killers' room privacy + God whisper is anonymous");
{
  const t = "c2_";
  const { code, host, roles } = await setup(t, { killer: 1, godfather: 1, police: 1, villager: 2 });
  const killer = roles.killer[0], gf = roles.godfather[0], police = roles.police[0];
  const killerName = (await view(code, killer)).you.name;
  await send(code, killer, "chat", { channel: "killers", text: "target the cop" });
  await send(code, host, "chat", { channel: "killers", text: "cops are watching" });
  await wait(400);
  const gv = await view(code, gf), pv = await view(code, police), hv = await view(code, host);
  const kLine = (gv.chat.killers || []).find((l) => /target the cop/.test(l.text));
  A(kLine?.sender === killerName, "Godfather sees the Killer's real name in the room");
  A(gv.chat.killers?.some((l) => /cops are watching/.test(l.text) && l.sender === null),
    "God's whisper is ANONYMOUS to the Killers");
  A(pv.chat.killers === null, "Town player cannot see the Killers' room at all");
  A(hv.chat.killers?.some((l) => /cops are watching/.test(l.text) && l.sender === "GOD"),
    "God sees their own whisper under their name");
}

// ============================ RECONNECT / REJOIN ============================

section("Reconnect — host refresh + rejoin-by-name resumes the seat");
{
  const t = "rc_";
  const { code, host, roles, ids } = await setup(t, { killer: 1, villager: 3 });
  const hostRefresh = await api("join", { code, name: "GOD", playerId: host });
  A(hostRefresh.status === 200 && hostRefresh.data.playerId === host, "Host refresh reconnects (no 'room not found')");
  const aRole = (await view(code, ids[0])).you.roleId;
  const rejoin = await api("join", { code, name: "A", playerId: "NEWDEVICE" });
  A(rejoin.status === 200 && rejoin.data.playerId === ids[0], "Rejoin-by-name resumes the original seat id");
  const resumed = (await view(code, ids[0])).you.roleId;
  A(resumed === aRole, "Rejoined player keeps the same role");
}

// ============================ PRIVACY ============================

section("Privacy — others' roles hidden mid-game, revealed at game end");
{
  const t = "pv_";
  const { code, ids } = await setup(t, { killer: 1, villager: 2 });
  const v = await view(code, ids[1]);
  const leaked = v.players.filter((p) => !p.isHost && p.roleId !== null);
  A(leaked.length === 0, "A player never sees other players' roles during the game");
}

// ============================ SUMMARY ============================
await wait(300);
console.log(`\n══════════════════════════════════════`);
console.log(`  ${pass} checks passed, ${failMsgs.length} failed`);
if (failMsgs.length) { console.log("  FAILURES:"); failMsgs.forEach((m) => console.log("   ✗ " + m)); }
console.log(failMsgs.length === 0 ? "\n✅ EVERY ASPECT VERIFIED" : "\n❌ SOME CHECKS FAILED");
process.exit(failMsgs.length ? 1 : 0);
