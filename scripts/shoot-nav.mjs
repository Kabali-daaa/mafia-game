import { io } from "socket.io-client";
import puppeteer from "puppeteer-core";
import fs from "fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = "/Users/karthikeyanm/Desktop/game/screens";
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function mk(id) {
  const s = io("http://localhost:3000", { forceNew: true });
  s.last = null; s.code = null;
  s.on("room", (v) => (s.last = v));
  s.on("joined", (p) => (s.code = p.code));
  return s;
}
const host = mk("N_GOD");
host.emit("create", { name: "GOD", playerId: "N_GOD" });
await wait(300);
const code = host.code;
const names = ["Aisha", "Ben", "Chloe", "Dev", "Esha"];
const ps = names.map((n) => { const c = mk("N_" + n); c.emit("join", { code, name: n, playerId: "N_" + n }); return c; });
await wait(500);
host.emit("setConfig", { config: { killer: 1, police: 1, cupid: 1, villager: 2 } });
await wait(200);
host.emit("start");
await wait(500);
const byRole = (r) => ps.find((p) => p.last.you.roleId === r);
const killer = byRole("killer"), police = byRole("police"), cupid = byRole("cupid");
const vills = ps.filter((p) => p.last.you.roleId === "villager");
cupid.emit("nightAction", { targetIds: [vills[0].last.you.id, vills[1].last.you.id] });
police.emit("nightAction", { targetIds: [killer.last.you.id] });
killer.emit("nightAction", { targetIds: [] }); // no death -> straight to day
await wait(600);
// seed some chat
vills[0].emit("chat", { channel: "town", text: "Morning! Anyone notice anything?" });
police.emit("chat", { channel: "town", text: "Keep your eyes open today." });
await wait(400);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
const MOBILE = { width: 390, height: 844, isMobile: true, hasTouch: true };
const DESKTOP = { width: 1320, height: 880, isMobile: false };

async function open(playerId, name, vp) {
  const page = await browser.newPage();
  await page.setViewport({ ...vp, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((pid, nm) => {
    localStorage.setItem("mafia:playerId", pid);
    localStorage.setItem("mafia:name", nm);
  }, playerId, name);
  await page.goto(`http://localhost:3000/room/${code}`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 700));
  return page;
}
async function snap(page, file) {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (m.sw > m.iw) console.log(`  ⚠ OVERFLOW ${file}`);
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
}
async function clickTab(page, label) {
  await page.evaluate((lbl) => {
    const btns = [...document.querySelectorAll("nav button")];
    const b = btns.find((x) => x.textContent && x.textContent.includes(lbl));
    b && b.click();
  }, label);
  await new Promise((r) => setTimeout(r, 400));
}

// ---- Player on mobile: Game tab, then a NEW message arrives (unread badge) ----
const pol = police.last.you;
let page = await open(pol.id, pol.name, MOBILE);
await snap(page, "nav-player-mobile-game.png");           // game tab, no unread yet
vills[0].emit("chat", { channel: "town", text: "Wait — where was Ben at midnight?" });
await new Promise((r) => setTimeout(r, 700));
await snap(page, "nav-player-mobile-game-unread.png");    // unread badge on Chat
await clickTab(page, "Chat");
await snap(page, "nav-player-mobile-chat.png");           // chat tab open
await page.close();

// ---- Player on desktop: left menu, game then chat ----
page = await open(pol.id, pol.name, DESKTOP);
vills[1].emit("chat", { channel: "town", text: "Could be anyone, stay sharp." });
await new Promise((r) => setTimeout(r, 700));
await snap(page, "nav-player-desktop-game.png");          // left sidebar + game, unread badge
await clickTab(page, "Chat");
await snap(page, "nav-player-desktop-chat.png");          // left sidebar + chat
await page.close();

// ---- Host on desktop: left menu ----
page = await open("N_GOD", "GOD", DESKTOP);
await snap(page, "nav-host-desktop-game.png");
await page.close();

await browser.close();
host.close(); ps.forEach((p) => p.close());
console.log("nav screens saved");
process.exit(0);
