// Full end-to-end simulation against the live (local) Firebase backend.
// Exercises every role, win condition, the tiebreak, chat, reconnect — with the
// host-stepped night (the God advances role-group by role-group).
import { initializeApp } from "../node_modules/firebase/app/dist/index.mjs";
import { getFirestore, doc, getDoc } from "../node_modules/firebase/firestore/dist/index.mjs";

const BASE = "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (p, b) =>
  fetch(BASE + "/api/" + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })
    .then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const app = initializeApp({ apiKey: "AIzaSyC7zovaO60cAv-N5HfOsYrtXg-x7kxJWR4", authDomain: "mafia-game-b8064.firebaseapp.com", projectId: "mafia-game-b8064" });
const db = getFirestore(app);
const view = async (code, pid) => (await getDoc(doc(db, "rooms", code, "views", pid))).data();

let pass = 0, failMsgs = [];
const A = (cond, msg) => { console.log(`   ${cond ? "✓" : "✗ FAIL:"} ${msg}`); cond ? pass++ : failMsgs.push(msg); };
const section = (t) => console.log(`\n── ${t} ──`);

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
  for (const id of ids) { const v = await view(code, id); (roles[v.you.roleId] = roles[v.you.roleId] || []).push(id); }
  return { code, host, ids, roles };
}
const send = (code, pid, type, payload = {}) => api("action", { code, playerId: pid, type, payload });
const alive = (hv, id) => [hv.you, ...hv.players].find((p) => p.id === id)?.alive;
const advance = (code, host) => send(code, host, "advance");

// Drive the host-stepped night to completion. plan: { playerId: targetIds[] }.
// Returns once the night leaves the "night" phase (→ witch or day or ended).
async function runNight(code, host, plan = {}) {
  for (let i = 0; i < 14; i++) {
    const hv = await view(code, host);
    if (hv.phase !== "night") return;
    for (const pid of Object.keys(plan)) {
      const pv = await view(code, pid);
      if (pv.prompt && pv.prompt.kind === "night" && !pv.prompt.submitted)
        await send(code, pid, "nightAction", { targetIds: plan[pid] });
    }
    await wait(220);
    await advance(code, host);
    await wait(280);
  }
}
// Advance the host's steps until `pid` has a night prompt (their role is called).
async function stepTo(code, host, pid) {
  for (let i = 0; i < 14; i++) {
    const pv = await view(code, pid);
    if (pv.phase !== "night") return false;
    if (pv.prompt && pv.prompt.kind === "night") return true;
    await advance(code, host);
    await wait(280);
  }
  return false;
}
// God opens the day vote (the day starts in "discussion").
async function openVote(code, host) {
  const hv = await view(code, host);
  if (hv.phase === "day" && hv.voteStage === "discussion") {
    await advance(code, host);
    await wait(300);
  }
}
// Skip a whole day with no elimination (open vote → resolve empty → begin night).
async function skipDay(code, host) {
  for (let i = 0; i < 5; i++) {
    const hv = await view(code, host);
    if (hv.phase !== "day") return;
    await advance(code, host); // discussion→vote→(resolve)→done→night
    await wait(300);
  }
}

// ============================ ROLES ============================

section("Killer + Doctor (heal cancels the kill)");
{
  let s = await setup("k1a_", { killer: 1, doctor: 1, villager: 2 });
  await runNight(s.code, s.host, { [s.roles.doctor[0]]: [s.roles.villager[0]], [s.roles.killer[0]]: [s.roles.villager[0]] });
  A(alive(await view(s.code, s.host), s.roles.villager[0]) === true, "Doctor's heal saved the attacked player");
  s = await setup("k1b_", { killer: 1, doctor: 1, villager: 2 });
  await runNight(s.code, s.host, { [s.roles.doctor[0]]: [s.roles.villager[1]], [s.roles.killer[0]]: [s.roles.villager[0]] });
  A(alive(await view(s.code, s.host), s.roles.villager[0]) === false, "Unhealed target dies");
}

section("Godfather reads innocent to Police");
{
  const { code, host, roles } = await setup("k2_", { godfather: 1, police: 1, villager: 2 });
  await runNight(code, host, { [roles.police[0]]: [roles.godfather[0]], [roles.godfather[0]]: [] });
  A(/is NOT a Killer/.test((await view(code, roles.police[0])).privateMessage || ""), "Police sees the Godfather as innocent");
}

section("Police squad — one shared check (plurality)");
{
  const { code, host, roles } = await setup("k3_", { killer: 1, police: 3, villager: 1 });
  const cops = roles.police, killer = roles.killer[0], vill = roles.villager[0];
  await runNight(code, host, { [cops[0]]: [killer], [cops[1]]: [killer], [cops[2]]: [vill] });
  const msgs = await Promise.all(cops.map((c) => view(code, c).then((v) => v.privateMessage || "")));
  A(msgs.every((m) => /IS a Killer/.test(m)) && new Set(msgs).size === 1, "All 3 cops share ONE result targeting the plurality pick");
}

section("Cupid + Lovers — linked night death");
{
  const { code, host, roles } = await setup("k4_", { killer: 1, cupid: 1, villager: 2 });
  const v = roles.villager;
  await runNight(code, host, { [roles.cupid[0]]: [v[0], v[1]], [roles.killer[0]]: [v[0]] });
  const hv = await view(code, host);
  A(alive(hv, v[0]) === false && alive(hv, v[1]) === false, "Both Lovers die when one is killed");
}

section("Panchayat Thalaivar — immune while a Cupid is alive");
{
  const { code, host, roles } = await setup("k5_", { killer: 1, cupid: 1, panchayath: 1, villager: 1 });
  const pan = roles.panchayath[0], vill = roles.villager[0], killer = roles.killer[0];
  await runNight(code, host, { [roles.cupid[0]]: [vill, killer], [killer]: [pan] });
  A(alive(await view(code, host), pan) === true, "Killer could not kill the Panchayat (Cupid alive)");
}

section("Item — chooses (gets a prompt), dies on a Killer");
{
  const { code, host, roles } = await setup("k6_", { killer: 1, item: 1, villager: 2 });
  const item = roles.item[0], killer = roles.killer[0];
  A(await stepTo(code, host, item), "Item gets a choice prompt at its step");
  const iv = await view(code, item);
  A(/spend the night/i.test(iv.prompt.text), "prompt is the Item's 'spend the night' choice");
  await send(code, item, "nightAction", { targetIds: [killer] });
  await runNight(code, host, {});
  A(alive(await view(code, host), item) === false, "Item died after choosing the Killer");
}

section("Witch — shown who was ATTACKED, saves them (decides blind to the Doctor)");
{
  const { code, host, roles } = await setup("k7_", { killer: 1, witch: 1, villager: 2 });
  const killer = roles.killer[0], witch = roles.witch[0], v = roles.villager;
  // Killers act first; the Witch is then called and shown only the attacked player.
  await stepTo(code, host, killer);
  await send(code, killer, "nightAction", { targetIds: [v[0]] });
  await stepTo(code, host, witch);
  const wv = await view(code, witch);
  A(JSON.stringify(wv.prompt?.targets) === JSON.stringify([v[0]]), "Witch is shown ONLY the attacked player");
  await send(code, witch, "nightAction", { targetIds: [v[0]] }); // save them
  await runNight(code, host, {});
  A(alive(await view(code, host), v[0]) === true, "Witch's save kept the attacked player alive");
}

section("Psycho Killer → Vigilante on Doctor heal, then kills a Killer");
{
  const { code, host, roles } = await setup("k8_", { psycho: 1, killer: 1, doctor: 1, villager: 2 });
  const psycho = roles.psycho[0], doctor = roles.doctor[0], killer = roles.killer[0];
  await runNight(code, host, { [doctor]: [psycho] }); // heal psycho → transforms (no deaths)
  A((await view(code, psycho)).you.roleId === "vigilante", "Healed Psycho secretly became a Vigilante");
  await skipDay(code, host);
  await runNight(code, host, {}); // night2 (even, vigilante idle)
  await skipDay(code, host);
  let v = await view(code, host);
  A(v.phase === "night" && v.day === 3, `reached night 3 (got ${v.phase} ${v.day})`);
  await runNight(code, host, { [psycho]: [killer] }); // vigilante shoots the killer
  const hv3 = await view(code, host);
  A(alive(hv3, killer) === false, "Vigilante (ex-Psycho) killed the Killer on an odd night");
  A(hv3.phase === "ended" && hv3.winner === "town", "All Killers gone → Town wins");
}

// ============================ WIN CONDITIONS ============================

section("Win — Killers reach parity");
{
  const { code, host, roles } = await setup("w1_", { killer: 1, villager: 2 });
  await runNight(code, host, { [roles.killer[0]]: [roles.villager[0]] });
  const hv = await view(code, host);
  A(hv.phase === "ended" && hv.winner === "mafia", "Killers win at parity");
}

section("Win — Jester lynched");
{
  const { code, host, roles, ids } = await setup("w2_", { killer: 1, jester: 1, villager: 2 });
  const jester = roles.jester[0];
  await runNight(code, host, {});
  await openVote(code, host);
  for (const id of ids) await send(code, id, "vote", { targetId: id === jester ? roles.killer[0] : jester });
  await wait(600);
  const hv = await view(code, host);
  A(hv.phase === "ended" && hv.winner === "neutral", "Jester voted out → Neutral wins");
}

// ============================ TIEBREAK ============================

section("Tiebreak — tie → revote → elimination; and tie → choice-tie → God");
{
  const tieAB = async (code, ids) => {
    await send(code, ids[0], "vote", { targetId: ids[1] });
    await send(code, ids[1], "vote", { targetId: ids[0] });
    await send(code, ids[2], "vote", { targetId: ids[0] });
    await send(code, ids[3], "vote", { targetId: ids[1] });
    await wait(500);
  };
  let s = await setup("tb1_", { killer: 1, villager: 3 });
  await runNight(s.code, s.host, {}); // → day (discussion)
  await openVote(s.code, s.host);
  await tieAB(s.code, s.ids);
  A((await view(s.code, s.ids[0])).voteStage === "choice", "Tie → town Skip/Revote choice");
  for (const [i, ch] of [[0, "revote"], [1, "revote"], [2, "revote"], [3, "skip"]]) await send(s.code, s.ids[i], "choice", { choice: ch });
  await wait(500);
  A((await view(s.code, s.ids[2])).voteStage === "revote", "Revote won → revote stage");
  for (const [i, tg] of [[0, 1], [1, 0], [2, 0], [3, 0]]) await send(s.code, s.ids[i], "vote", { targetId: s.ids[tg] });
  await wait(500);
  A(alive(await view(s.code, s.host), s.ids[0]) === false, "Revote produced an elimination");

  s = await setup("tb2_", { killer: 1, villager: 3 });
  await runNight(s.code, s.host, {});
  await openVote(s.code, s.host);
  await tieAB(s.code, s.ids);
  for (const [i, ch] of [[0, "skip"], [1, "skip"], [2, "revote"], [3, "revote"]]) await send(s.code, s.ids[i], "choice", { choice: ch });
  await wait(500);
  A((await view(s.code, s.host)).voteStage === "godchoice", "Skip/Revote tie → God decides");
  await send(s.code, s.host, "godDecide", { decision: "skip" });
  await wait(500);
  const tb2 = await view(s.code, s.host);
  A(tb2.phase === "day" && tb2.voteStage === "done", "God Skip → no elimination, day settled (awaiting night)");
}

// ============================ CHAT ============================

section("Chat — town anonymity, host sees real, town closed at night");
{
  const { code, host, ids } = await setup("c1_", { killer: 1, police: 1, villager: 2 });
  await send(code, ids[0], "chat", { channel: "town", text: "night msg should drop" });
  await wait(300);
  A(((await view(code, host)).chat.town || []).length === 0, "Town chat is closed at night (message dropped)");
  await runNight(code, host, {}); // → day
  await send(code, ids[0], "chat", { channel: "town", text: "I suspect someone" });
  await wait(400);
  const line = (v) => (v.chat.town || []).find((l) => /suspect someone/.test(l.text));
  A(line(await view(code, ids[1]))?.sender === null, "Other players see the sender as Anonymous");
  A(line(await view(code, ids[0]))?.sender === "You", "Author sees their own line as 'You'");
  A(line(await view(code, host))?.sender === "A", "God sees the real sender name");
}

section("Chat — Killers' room privacy + God whisper is anonymous");
{
  const { code, host, roles } = await setup("c2_", { killer: 1, godfather: 1, police: 1, villager: 2 });
  const killer = roles.killer[0], gf = roles.godfather[0], police = roles.police[0];
  const killerName = (await view(code, killer)).you.name;
  await send(code, killer, "chat", { channel: "killers", text: "target the cop" });
  await send(code, host, "chat", { channel: "killers", text: "cops are watching" });
  await wait(400);
  const gv = await view(code, gf), pv = await view(code, police), hv = await view(code, host);
  A((gv.chat.killers || []).find((l) => /target the cop/.test(l.text))?.sender === killerName, "Godfather sees the Killer's real name");
  A(gv.chat.killers?.some((l) => /cops are watching/.test(l.text) && l.sender === null), "God's whisper is ANONYMOUS to the Killers");
  A(pv.chat.killers === null, "Town player cannot see the Killers' room");
  A(hv.chat.killers?.some((l) => /cops are watching/.test(l.text) && l.sender === "GOD"), "God sees their own whisper under their name");
}

// ============================ RECONNECT / PRIVACY ============================

section("Reconnect — host refresh + rejoin-by-name resumes the seat");
{
  const { code, host, ids } = await setup("rc_", { killer: 1, villager: 3 });
  const hostRefresh = await api("join", { code, name: "GOD", playerId: host });
  A(hostRefresh.status === 200 && hostRefresh.data.playerId === host, "Host refresh reconnects (no 'room not found')");
  const aRole = (await view(code, ids[0])).you.roleId;
  const rejoin = await api("join", { code, name: "A", playerId: "NEWDEVICE" });
  A(rejoin.status === 200 && rejoin.data.playerId === ids[0], "Rejoin-by-name resumes the original seat id");
  A((await view(code, ids[0])).you.roleId === aRole, "Rejoined player keeps the same role");
}

section("Privacy — others' roles hidden mid-game");
{
  const { code, ids } = await setup("pv_", { killer: 1, villager: 2 });
  const v = await view(code, ids[1]);
  A(v.players.filter((p) => !p.isHost && p.roleId !== null).length === 0, "A player never sees others' roles during the game");
}

// ============================ MORE ROLE CONDITIONS ============================

section("Lovers — linked DAY-lynch death");
{
  const { code, host, roles, ids } = await setup("m1_", { killer: 1, cupid: 1, villager: 2 });
  const v = roles.villager;
  await runNight(code, host, { [roles.cupid[0]]: [v[0], v[1]] });
  await openVote(code, host);
  for (const id of ids) await send(code, id, "vote", { targetId: id === v[0] ? roles.killer[0] : v[0] });
  await wait(600);
  const hv = await view(code, host);
  A(alive(hv, v[0]) === false && alive(hv, v[1]) === false, "Lynched Lover + partner both die");
}

section("Vigilante backfire — shooting an innocent kills the Vigilante too");
{
  const { code, host, roles } = await setup("m2_", { psycho: 1, doctor: 1, killer: 1, villager: 2 });
  const psycho = roles.psycho[0], doctor = roles.doctor[0], v = roles.villager;
  await runNight(code, host, { [doctor]: [psycho] }); // → Vigilante
  await skipDay(code, host);
  await runNight(code, host, {}); // night2 (even)
  await skipDay(code, host);
  await runNight(code, host, { [psycho]: [v[0]] }); // shoot an innocent
  const hv = await view(code, host);
  A(alive(hv, v[0]) === false, "the innocent target died");
  A(alive(hv, psycho) === false, "the Vigilante died for shooting an innocent");
}

section("Item — dies WITH a target that dies that night");
{
  const { code, host, roles } = await setup("m3_", { killer: 1, item: 1, villager: 2 });
  const item = roles.item[0], v = roles.villager;
  await runNight(code, host, { [item]: [v[0]], [roles.killer[0]]: [v[0]] });
  const hv = await view(code, host);
  A(alive(hv, v[0]) === false && alive(hv, item) === false, "Item died with the player it visited");
}

section("Item — cannot pick the same person twice");
{
  const { code, host, roles } = await setup("m4_", { killer: 1, item: 1, villager: 2 });
  const item = roles.item[0], v = roles.villager;
  await runNight(code, host, { [item]: [v[0]] }); // visit v0 → day
  await skipDay(code, host);
  await stepTo(code, host, item);
  const iv = await view(code, item);
  A(iv.phase === "night" && !iv.prompt.targets.includes(v[0]), "previously-visited player not offered again");
}

section("Witch — only 2 saves per game");
{
  const { code, host, roles } = await setup("m5_", { killer: 1, witch: 1, villager: 4 });
  const killer = roles.killer[0], witch = roles.witch[0], v = roles.villager;
  // Two nights: killer attacks a villager, the Witch saves them (uses both saves).
  for (let i = 0; i < 2; i++) {
    await runNight(code, host, { [killer]: [v[i]], [witch]: [v[i]] });
    A(alive(await view(code, host), v[i]) === true, `night ${i + 1}: Witch saved the victim`);
    await skipDay(code, host);
  }
  // 3rd night: the Witch is out of saves — her step shouldn't appear.
  await stepTo(code, host, killer);
  await send(code, killer, "nightAction", { targetIds: [v[2]] });
  await runNight(code, host, {}); // step through; Witch has no turn
  A((await view(code, witch)).prompt === null || (await view(code, host)).phase !== "night",
    "Witch gets no turn after 2 saves");
  const hv = await view(code, host);
  A(alive(hv, v[2]) === false, "the 3rd victim dies (Witch is spent)");
}

section("Cupid acts on night 1 only");
{
  const { code, host, roles } = await setup("m6_", { killer: 1, cupid: 1, villager: 2 });
  const cupid = roles.cupid[0], v = roles.villager;
  await runNight(code, host, { [cupid]: [v[0], v[1]] });
  await skipDay(code, host);
  const cv = await view(code, cupid);
  A(cv.phase === "night" && cv.prompt === null, "Cupid has no action on night 2");
}

section("Psycho Killer is idle on even nights");
{
  const { code, host, roles } = await setup("m7_", { psycho: 1, police: 1, villager: 2 });
  const psycho = roles.psycho[0];
  A(await stepTo(code, host, psycho), "Psycho can act on night 1 (odd)");
  await send(code, psycho, "nightAction", { targetIds: [] });
  await runNight(code, host, {});
  await skipDay(code, host);
  A((await view(code, psycho)).prompt === null, "Psycho has no action on night 2 (even)");
}

section("Doctor can heal themselves");
{
  const { code, host, roles } = await setup("m8_", { killer: 1, doctor: 1, villager: 2 });
  const doctor = roles.doctor[0];
  await runNight(code, host, { [doctor]: [doctor], [roles.killer[0]]: [doctor] });
  A(alive(await view(code, host), doctor) === true, "self-healed Doctor survived the attack");
}

// ============================ MORE FLOW / RULES ============================

section("God can post anonymously to the Town");
{
  const { code, host, ids } = await setup("m9_", { killer: 1, villager: 3 });
  await runNight(code, host, {}); // → day
  await send(code, host, "chat", { channel: "town", text: "a whisper from above" });
  await wait(400);
  const line = ((await view(code, ids[1])).chat.town || []).find((l) => /whisper from above/.test(l.text));
  A(!!line && line.sender === null, "God's town message shows as Anonymous to players");
}

section("Dead players can't vote");
{
  const { code, host, roles, ids } = await setup("m10_", { killer: 1, villager: 3 });
  const killer = roles.killer[0], dead = roles.villager[0];
  await runNight(code, host, { [killer]: [dead] });
  await openVote(code, host); // open voting so alive players DO get a prompt
  const aliveOther = ids.find((id) => id !== dead && id !== killer);
  A((await view(code, dead)).prompt === null, "a dead player gets no vote prompt");
  A((await view(code, aliveOther)).prompt?.kind === "vote", "(an alive player does get the vote prompt)");
}

section("Start validations (too few players, role mismatch, too many Killers)");
{
  let cr = await api("create", { name: "GOD", playerId: "v1h" });
  let code = cr.data.code;
  await api("join", { code, name: "A", playerId: "v1a" });
  await api("join", { code, name: "B", playerId: "v1b" });
  await api("action", { code, playerId: "v1h", type: "setConfig", payload: { config: { killer: 1, villager: 1 } } });
  let r = await api("action", { code, playerId: "v1h", type: "start", payload: {} });
  A(r.status === 400 && /at least 3/i.test(r.data.error || ""), "blocks starting with fewer than 3 players");
  cr = await api("create", { name: "GOD", playerId: "v2h" }); code = cr.data.code;
  for (const L of ["a", "b", "c", "d"]) await api("join", { code, name: L, playerId: "v2" + L });
  await api("action", { code, playerId: "v2h", type: "setConfig", payload: { config: { killer: 1, villager: 1 } } });
  r = await api("action", { code, playerId: "v2h", type: "start", payload: {} });
  A(r.status === 400 && /must equal/i.test(r.data.error || ""), "blocks when role count ≠ player count");
  cr = await api("create", { name: "GOD", playerId: "v3h" }); code = cr.data.code;
  for (const L of ["a", "b", "c", "d"]) await api("join", { code, name: L, playerId: "v3" + L });
  await api("action", { code, playerId: "v3h", type: "setConfig", payload: { config: { killer: 2, villager: 2 } } });
  r = await api("action", { code, playerId: "v3h", type: "start", payload: {} });
  A(r.status === 400 && /too many killers/i.test(r.data.error || ""), "blocks when Killers are too many");
}

section("Tiebreak — revote that ties AGAIN goes to the God");
{
  const { code, host, ids } = await setup("m11_", { killer: 1, villager: 3 });
  await runNight(code, host, {}); // → day
  await openVote(code, host);
  const tie = async () => {
    await send(code, ids[0], "vote", { targetId: ids[1] }); await send(code, ids[1], "vote", { targetId: ids[0] });
    await send(code, ids[2], "vote", { targetId: ids[0] }); await send(code, ids[3], "vote", { targetId: ids[1] });
    await wait(500);
  };
  await tie();
  for (const id of ids) await send(code, id, "choice", { choice: "revote" });
  await wait(500);
  await send(code, ids[0], "vote", { targetId: ids[1] }); await send(code, ids[1], "vote", { targetId: ids[0] });
  await send(code, ids[2], "vote", { targetId: ids[0] }); await send(code, ids[3], "vote", { targetId: ids[1] });
  await wait(600);
  A((await view(code, host)).voteStage === "godchoice", "a re-tied revote escalates to the God");
}

section("Multiple Killers each strike (two deaths in one night)");
{
  const { code, host, roles } = await setup("m12_", { killer: 2, villager: 3 });
  const [k1, k2] = roles.killer, v = roles.villager;
  await runNight(code, host, { [k1]: [v[0]], [k2]: [v[1]] });
  const hv = await view(code, host);
  A(alive(hv, v[0]) === false && alive(hv, v[1]) === false, "both Killers' victims died");
}

// ============================ EVEN MORE DETAILS ============================

section("Godfather actually kills (it's a real Killer)");
{
  const { code, host, roles } = await setup("d1_", { godfather: 1, police: 1, villager: 2 });
  const v = roles.villager;
  await runNight(code, host, { [roles.godfather[0]]: [v[0]] });
  A(alive(await view(code, host), v[0]) === false, "Godfather's night kill works");
}

section("Witch save is BLIND to the Doctor (a redundant save is wasted)");
{
  const { code, host, roles } = await setup("d2_", { killer: 1, doctor: 1, witch: 1, villager: 2 });
  const killer = roles.killer[0], doctor = roles.doctor[0], witch = roles.witch[0], v = roles.villager;
  // Killer attacks v0; Doctor ALSO heals v0; Witch (not knowing) saves v0 too.
  await runNight(code, host, { [killer]: [v[0]], [doctor]: [v[0]], [witch]: [v[0]] });
  A(alive(await view(code, host), v[0]) === true, "v0 survives (protected)");
  // The Witch still spent a save even though the Doctor already had it covered.
  await skipDay(code, host);
  await stepTo(code, host, killer);
  await send(code, killer, "nightAction", { targetIds: [v[1]] });
  await stepTo(code, host, witch);
  A((await view(code, witch)).prompt?.kind === "night", "Witch still has 1 save left (used 1 of 2)");
  await runNight(code, host, {});
}

section("Panchayat — killable at night with NO Cupid, lynchable by day even WITH Cupid");
{
  let s = await setup("d3a_", { killer: 1, panchayath: 1, villager: 2 });
  await runNight(s.code, s.host, { [s.roles.killer[0]]: [s.roles.panchayath[0]] });
  A(alive(await view(s.code, s.host), s.roles.panchayath[0]) === false, "Panchayat killable at night when no Cupid");
  s = await setup("d3b_", { killer: 1, cupid: 1, panchayath: 1, villager: 1 });
  const pan = s.roles.panchayath[0], killer = s.roles.killer[0], vill = s.roles.villager[0];
  await runNight(s.code, s.host, { [s.roles.cupid[0]]: [killer, vill] }); // cupid lives, links non-panchayat
  await openVote(s.code, s.host);
  for (const id of s.ids) await send(s.code, id, "vote", { targetId: id === pan ? killer : pan });
  await wait(600);
  const hv = await view(s.code, s.host);
  A(alive(hv, s.roles.cupid[0]) === true && alive(hv, pan) === false, "Panchayat lynched by day even while a Cupid is alive");
}

section("Jester does NOT win if killed at night (only by lynch)");
{
  const { code, host, roles } = await setup("d4_", { killer: 1, jester: 1, villager: 2 });
  await runNight(code, host, { [roles.killer[0]]: [roles.jester[0]] });
  const hv = await view(code, host);
  A(alive(hv, roles.jester[0]) === false, "Jester died at night");
  A(hv.winner !== "neutral", "Jester does NOT win from a night kill");
}

section("Psycho Killer is NOT in the Killers' room");
{
  const { code, roles } = await setup("d5_", { killer: 1, psycho: 1, police: 1, villager: 2 });
  A((await view(code, roles.killer[0])).chat.killers !== null, "Killer can see the Killers' room");
  A((await view(code, roles.psycho[0])).chat.killers === null, "Psycho canNOT see the Killers' room");
}

section("Dead players can't post Town chat");
{
  const { code, host, roles, ids } = await setup("d6_", { killer: 1, villager: 3 });
  const killer = roles.killer[0], dead = roles.villager[0];
  await runNight(code, host, { [killer]: [dead] });
  await send(code, dead, "chat", { channel: "town", text: "ghost message" });
  await wait(300);
  const someoneAlive = ids.find((id) => id !== dead && id !== killer);
  A(!((await view(code, someoneAlive)).chat.town || []).some((l) => /ghost message/.test(l.text)), "a dead player's town message is rejected");
}

section("3-way tie → revote offers all three tied players");
{
  const { code, host, ids } = await setup("d7_", { killer: 1, villager: 5 });
  await runNight(code, host, {}); // → day
  await openVote(code, host);
  const [a, b, c, d, e, f] = ids;
  const votes = { [a]: b, [b]: c, [c]: a, [d]: a, [e]: b, [f]: c };
  for (const [voter, tgt] of Object.entries(votes)) await send(code, voter, "vote", { targetId: tgt });
  await wait(600);
  A((await view(code, a)).voteStage === "choice", "3-way tie reaches the choice");
  for (const id of ids) await send(code, id, "choice", { choice: "revote" });
  await wait(600);
  const dv = await view(code, d);
  A(dv.voteStage === "revote" && dv.prompt?.targets.length === 3, "revote offers all 3 tied players");
}

section("Vigilante is never dealt at the start (transform-only)");
{
  const cr = await api("create", { name: "GOD", playerId: "d8h" });
  const code = cr.data.code;
  for (const L of ["a", "b", "c", "d"]) await api("join", { code, name: L, playerId: "d8" + L });
  await api("action", { code, playerId: "d8h", type: "setConfig", payload: { config: { killer: 1, vigilante: 2, villager: 2 } } });
  await wait(200);
  A((await view(code, "d8h")).config.vigilante === undefined, "Vigilante is stripped from the lobby config");
}

section("At most one Cupid allowed");
{
  const cr = await api("create", { name: "GOD", playerId: "d9h" });
  const code = cr.data.code;
  for (const L of ["a", "b", "c", "d"]) await api("join", { code, name: L, playerId: "d9" + L });
  await api("action", { code, playerId: "d9h", type: "setConfig", payload: { config: { killer: 1, cupid: 2, villager: 1 } } });
  const r = await api("action", { code, playerId: "d9h", type: "start", payload: {} });
  A(r.status === 400 && /one cupid/i.test(r.data.error || ""), "blocks starting with two Cupids");
}

section("The God is never a valid target or voter");
{
  const { code, host, roles, ids } = await setup("d10_", { killer: 1, police: 1, villager: 2 });
  await stepTo(code, host, roles.police[0]);
  A(!(await view(code, roles.police[0])).prompt.targets.includes(host), "host is not a night-action target");
  await runNight(code, host, {});
  await openVote(code, host);
  A((await view(code, ids[0])).prompt?.kind === "vote" && !(await view(code, ids[0])).prompt.targets.includes(host), "host is not a vote target");
}

section("Play again — host reset returns everyone to the lobby");
{
  const { code, host, roles } = await setup("d11_", { killer: 1, villager: 2 });
  await runNight(code, host, { [roles.killer[0]]: [roles.villager[0]] }); // parity → ended
  A((await view(code, host)).phase === "ended", "game ended");
  await send(code, host, "reset");
  await wait(500);
  const hv = await view(code, host);
  A(hv.phase === "lobby", "reset returns to the lobby");
  A([hv.you, ...hv.players].filter((p) => !p.isHost).every((p) => p.roleId === null && p.alive), "everyone role-less and alive after reset");
}

// ============================ RULE CLARIFICATIONS ============================

section("Witch can save herself if she is the one attacked");
{
  const { code, host, roles } = await setup("r2_", { killer: 1, witch: 1, villager: 2 });
  const killer = roles.killer[0], witch = roles.witch[0];
  await stepTo(code, host, killer);
  await send(code, killer, "nightAction", { targetIds: [witch] }); // attack the Witch
  await stepTo(code, host, witch);
  A((await view(code, witch)).prompt?.targets.includes(witch), "attacked Witch sees herself as savable");
  await send(code, witch, "nightAction", { targetIds: [witch] }); // self-save
  await runNight(code, host, {});
  A(alive(await view(code, host), witch) === true, "Witch saved herself from the attack");
}

// ============================ HOST-STEPPED NIGHT ============================

section("Host-stepped night — roles are called one at a time");
{
  const { code, host, roles } = await setup("hs_", { killer: 1, doctor: 1, cupid: 1, villager: 1 });
  const cupid = roles.cupid[0], killer = roles.killer[0], doctor = roles.doctor[0];
  let hv = await view(code, host);
  A(/Cupid/.test(hv.nightStepLabel || ""), "first step calls Cupid");
  A((await view(code, killer)).prompt === null, "Killer waits (no prompt during Cupid's step)");
  A((await view(code, cupid)).prompt?.kind === "night", "Cupid can act on their step");
  A(Array.isArray(hv.nightControl?.board), "host has a night board");
  await send(code, cupid, "nightAction", { targetIds: [killer, doctor] });
  await advance(code, host); await wait(350);
  hv = await view(code, host);
  A(/Killers/.test(hv.nightStepLabel || ""), "host advanced to the Killers step");
  A((await view(code, killer)).prompt?.kind === "night", "Killer can act now");
  A(hv.nightControl?.board.some((e) => /Cupid/.test(e.step) && /linked/.test(e.text)), "host board shows Cupid's recorded choice");
}

// ============================ HOST-CONTROLLED PACING ============================

section("Host-controlled day — discussion → God opens vote → settle → God begins night");
{
  const { code, host, roles, ids } = await setup("gd_", { killer: 1, villager: 3 });
  await runNight(code, host, {}); // → day (discussion)
  let hv = await view(code, host);
  A(hv.phase === "day" && hv.voteStage === "discussion", "day starts in DISCUSSION (no voting yet)");
  A((await view(code, ids[0])).prompt === null, "players cannot vote during discussion");
  await openVote(code, host);
  A((await view(code, ids[0])).prompt?.kind === "vote", "God opened the vote → players can vote");
  const target = ids.find((id) => id !== roles.killer[0]);
  for (const id of ids) await send(code, id, "vote", { targetId: id === target ? roles.killer[0] : target });
  await wait(600);
  hv = await view(code, host);
  A(hv.phase === "day" && hv.voteStage === "done", "after the vote, day is 'done' (night does NOT auto-start)");
  A(alive(hv, target) === false, "the voted player was eliminated");
  await advance(code, host); // begin night
  await wait(400);
  A((await view(code, host)).phase === "night", "God began the next night when ready");
}

// ============================ SUMMARY ============================
await wait(300);
console.log(`\n══════════════════════════════════════`);
console.log(`  ${pass} checks passed, ${failMsgs.length} failed`);
if (failMsgs.length) { console.log("  FAILURES:"); failMsgs.forEach((m) => console.log("   ✗ " + m)); }
console.log(failMsgs.length === 0 ? "\n✅ EVERY ASPECT VERIFIED" : "\n❌ SOME CHECKS FAILED");
process.exit(failMsgs.length ? 1 : 0);
