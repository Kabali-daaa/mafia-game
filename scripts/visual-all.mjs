// Visual end-to-end: drive the real browser through every UI state, assert key
// elements + zero horizontal overflow, and save screenshots.
import puppeteer from "/Users/karthikeyanm/Desktop/game/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import { initializeApp } from "/Users/karthikeyanm/Desktop/game/node_modules/firebase/app/dist/index.mjs";
import { getFirestore, doc, getDoc } from "/Users/karthikeyanm/Desktop/game/node_modules/firebase/firestore/dist/index.mjs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://localhost:3000";
const OUT = "/Users/karthikeyanm/Desktop/game/screens";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (p, b) => fetch(URL + "/api/" + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const app = initializeApp({ apiKey: "AIzaSyC7zovaO60cAv-N5HfOsYrtXg-x7kxJWR4", authDomain: "mafia-game-b8064.firebaseapp.com", projectId: "mafia-game-b8064" });
const db = getFirestore(app);
const view = async (code, pid) => (await getDoc(doc(db, "rooms", code, "views", pid))).data();

let pass = 0, fails = [];
const A = (c, m) => { console.log(`   ${c ? "✓" : "✗ FAIL:"} ${m}`); c ? pass++ : fails.push(m); };
const section = (t) => console.log(`\n── ${t} ──`);

async function game(tag, config) {
  const total = Object.values(config).reduce((a, b) => a + b, 0);
  const letters = "abcdefgh".slice(0, total).split("");
  const cr = await api("create", { name: "GOD", playerId: tag + "h" });
  const code = cr.data.code;
  for (const L of letters) await api("join", { code, name: L.toUpperCase(), playerId: tag + L });
  await api("action", { code, playerId: tag + "h", type: "setConfig", payload: { config } });
  await api("action", { code, playerId: tag + "h", type: "start", payload: {} });
  await wait(350);
  const roles = {}, ids = letters.map((L) => tag + L);
  for (const id of ids) { const v = await view(code, id); (roles[v.you.roleId] = roles[v.you.roleId] || []).push(id); }
  return { code, host: tag + "h", ids, roles };
}
const send = (code, pid, type, payload = {}) => api("action", { code, playerId: pid, type, payload });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
const MOBILE = { width: 390, height: 844, isMobile: true, hasTouch: true };
const DESKTOP = { width: 1320, height: 900, isMobile: false };
async function openAs(code, pid, name, vp) {
  const page = await browser.newPage();
  await page.setViewport({ ...vp, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((p, n) => { localStorage.setItem("mafia:playerId", p); localStorage.setItem("mafia:name", n); }, pid, name);
  await page.goto(URL + "/room/" + code, { waitUntil: "domcontentloaded" });
  await wait(1600);
  return page;
}
const txt = (pg) => pg.evaluate(() => document.body.innerText);
const overflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const click = (pg, t) => pg.evaluate((t) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent && x.textContent.includes(t)); if (b) { b.click(); return true; } return false; }, t);
const shot = (pg, f) => pg.screenshot({ path: `${OUT}/${f}`, fullPage: true });
const until = async (pg, re) => { for (let i = 0; i < 25; i++) { try { if (re.test(await txt(pg))) return true; } catch {} await wait(300); } return false; };

// ---------------------------------------------------------------------------
section("Dramatic role reveal + hide toggle (mobile)");
{
  const g = await game("vz1_", { killer: 1, police: 1, villager: 2 });
  const p = g.ids[0];
  const page = await openAs(g.code, p, "A", MOBILE);
  A(await until(page, /YOU ARE THE/i), "dramatic reveal overlay appears on a new role");
  A(!(await overflow(page)), "reveal: no horizontal overflow (mobile)");
  await shot(page, "vis-reveal-mobile.png");
  await click(page, "Got it");
  A(await until(page, /Tap to reveal/), "after 'Got it', role is hidden in the header");
  await shot(page, "vis-hidden-mobile.png");
  await click(page, "Tap to reveal");
  await wait(600);
  A(/Killer|Police|Villager/.test(await txt(page)), "tapping reveals the role again");
  await page.close();
}

section("Mobile bottom nav + unread chat badge");
{
  const g = await game("vz2_", { killer: 1, police: 1, villager: 2 });
  await send(g.code, g.host, "advance"); await wait(400); // → day so town chat is open
  const page = await openAs(g.code, g.ids[0], "A", MOBILE);
  // dismiss any reveal
  await click(page, "Got it"); await wait(500);
  const body = await txt(page);
  A(/Game/.test(body) && /Chat/.test(body) && /Players/.test(body) && /Story/.test(body), "bottom nav shows Game/Chat/Players/Story");
  A(!(await overflow(page)), "nav: no horizontal overflow (mobile)");
  // a teammate posts in town → unread badge on Chat
  await send(g.code, g.ids[1], "chat", { channel: "town", text: "psst over here" });
  await wait(1200);
  await shot(page, "vis-nav-unread-mobile.png");
  const badge = await page.evaluate(() =>
    [...document.querySelectorAll("nav")].some((n) => /Chat\s*\d/.test(n.innerText))
  );
  A(badge, "Chat tab shows an unread badge (count next to Chat) after a new message");
  await page.close();
}

section("Skip / Revote choice UI (mobile player)");
{
  const g = await game("vz3_", { killer: 1, villager: 3 });
  await send(g.code, g.host, "advance"); await wait(400); // → day
  const [a, b, c, d] = g.ids;
  await send(g.code, a, "vote", { targetId: b });
  await send(g.code, b, "vote", { targetId: a });
  await send(g.code, c, "vote", { targetId: a });
  await send(g.code, d, "vote", { targetId: b });
  await wait(500);
  const page = await openAs(g.code, c, "C", MOBILE);
  await click(page, "Got it"); await wait(400);
  A(await until(page, /Skip/i) && /Revote/i.test(await txt(page)), "player sees Skip & Revote buttons on a tie");
  A(!(await overflow(page)), "choice UI: no overflow (mobile)");
  await shot(page, "vis-choice-mobile.png");
  await page.close();
}

section("God controls during a deadlock (desktop)");
{
  const g = await game("vz4_", { killer: 1, villager: 3 });
  await send(g.code, g.host, "advance"); await wait(400);
  const [a, b, c, d] = g.ids;
  await send(g.code, a, "vote", { targetId: b }); await send(g.code, b, "vote", { targetId: a });
  await send(g.code, c, "vote", { targetId: a }); await send(g.code, d, "vote", { targetId: b });
  await wait(500);
  // choice tie → godchoice
  await send(g.code, a, "choice", { choice: "skip" }); await send(g.code, b, "choice", { choice: "skip" });
  await send(g.code, c, "choice", { choice: "revote" }); await send(g.code, d, "choice", { choice: "revote" });
  await wait(600);
  const page = await openAs(g.code, g.host, "GOD", DESKTOP);
  A(await until(page, /Skip/) && /Revote/.test(await txt(page)), "God sees Skip/Revote decision buttons");
  A(/Game/.test(await txt(page)), "desktop left sidebar present");
  A(!(await overflow(page)), "god controls: no overflow (desktop)");
  await shot(page, "vis-godchoice-desktop.png");
  await page.close();
}

section("Witch revive prompt (mobile)");
{
  const g = await game("vz5_", { killer: 1, witch: 1, villager: 2 });
  await send(g.code, g.roles.killer[0], "nightAction", { targetIds: [g.roles.villager[0]] });
  await wait(600);
  const page = await openAs(g.code, g.roles.witch[0], "W", MOBILE);
  A(await until(page, /Revive|fallen/i), "Witch sees the revive prompt");
  A(!(await overflow(page)), "witch prompt: no overflow (mobile)");
  await shot(page, "vis-witch-mobile.png");
  await page.close();
}

section("Game-over screen (mobile)");
{
  const g = await game("vz6_", { killer: 1, villager: 2 });
  await send(g.code, g.roles.killer[0], "nightAction", { targetIds: [g.roles.villager[0]] });
  await wait(700); // killers reach parity → ended
  const page = await openAs(g.code, g.ids[0], "A", MOBILE);
  A(await until(page, /\bwins?!/i), "game-over screen shows the winner");
  A(!(await overflow(page)), "ended screen: no overflow (mobile)");
  await shot(page, "vis-ended-mobile.png");
  await page.close();
}

section("Desktop left-hand menu layout");
{
  const g = await game("vz7_", { killer: 1, police: 1, villager: 2 });
  await send(g.code, g.host, "advance"); await wait(400);
  const page = await openAs(g.code, g.host, "GOD", DESKTOP);
  const body = await txt(page);
  A(/Game/.test(body) && /Chat/.test(body) && /Players/.test(body) && /Story/.test(body), "desktop sidebar shows all sections");
  A(!(await overflow(page)), "desktop layout: no overflow");
  await shot(page, "vis-sidebar-desktop.png");
  await page.close();
}

await browser.close();
console.log(`\n══════════════════════════════════════`);
console.log(`  ${pass} visual checks passed, ${fails.length} failed`);
fails.forEach((m) => console.log("   ✗ " + m));
console.log(fails.length === 0 ? "\n✅ ALL VISUAL STATES VERIFIED" : "\n❌ SOME VISUAL CHECKS FAILED");
process.exit(fails.length ? 1 : 0);
