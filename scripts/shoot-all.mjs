import { io } from "socket.io-client";
import puppeteer from "puppeteer-core";
import fs from "fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = "/Users/karthikeyanm/Desktop/game/screens";
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- drive a real game with socket bots ---------------- */
function mk(id) {
  const s = io("http://localhost:3000", { forceNew: true });
  s.last = null; s.code = null;
  s.on("room", (v) => (s.last = v));
  s.on("joined", (p) => (s.code = p.code));
  return s;
}
const host = mk("Z_GOD");
host.emit("create", { name: "GOD", playerId: "Z_GOD" });
await wait(300);
const code = host.code;
const names = ["Aisha","Ben","Chloe","Dev","Esha","Farid","Gita","Hari","Iris","Jay","Kiran"];
const ids = names.map((n) => "Z_" + n);
const ps = names.map((n, i) => { const c = mk(ids[i]); c.emit("join", { code, name: n, playerId: ids[i] }); return c; });
await wait(600);
host.emit("setConfig", { config: {
  killer:1, godfather:1, police:1, doctor:1, cupid:1, panchayat:1, item:1, witch:1, villager:2, jester:1
}});
await wait(200);
host.emit("start");
await wait(500);

const byRole = (r) => ps.find((p) => p.last.you.roleId === r);
const allByRole = (r) => ps.filter((p) => p.last.you.roleId === r);
const killer = byRole("killer"), godfather = byRole("godfather"), police = byRole("police"),
  doctor = byRole("doctor"), cupid = byRole("cupid"), panchayat = byRole("panchayat"),
  witch = byRole("witch"), jester = byRole("jester");
const vills = allByRole("villager");

// Pre-fill the Killers' room so those views aren't empty (night chat is allowed there).
killer.emit("chat", { channel: "killers", text: "I'll take the quiet one tonight." });
godfather.emit("chat", { channel: "killers", text: "Keep it clean. Cops are sniffing." });
host.emit("chat", { channel: "killers", text: "…someone is onto you." });
await wait(400);

/* ---------------- browser screenshotting ---------------- */
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
const MOBILE = { width: 390, height: 844, isMobile: true, hasTouch: true };
const DESKTOP = { width: 1320, height: 900, isMobile: false };

async function shot(playerId, name, file, vp) {
  const page = await browser.newPage();
  await page.setViewport({ ...vp, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((pid, nm) => {
    localStorage.setItem("mafia:playerId", pid);
    localStorage.setItem("mafia:name", nm);
  }, playerId, name);
  await page.goto(`http://localhost:3000/room/${code}`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 700));
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (m.sw > m.iw) console.log(`  ⚠ OVERFLOW ${file}`);
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  await page.close();
}
async function both(player, label) {
  const id = player === host ? "Z_GOD" : player.last.you.id;
  const nm = player === host ? "GOD" : player.last.you.name;
  await shot(id, nm, `${label}-mobile.png`, MOBILE);
  await shot(id, nm, `${label}-desktop.png`, DESKTOP);
  console.log("  captured", label);
}

console.log("NIGHT 1 views:");
await both(host, "host-night");
await both(killer, "killer-night");
await both(police, "police-night");
await both(doctor, "doctor-night");
await both(cupid, "cupid-night");
await both(vills[0], "villager-night");
await both(witch, "witch-night");

/* ---- submit night actions to reach the Witch phase ---- */
cupid.emit("nightAction", { targetIds: [panchayat.last.you.id, jester.last.you.id] }); // lovers (not the victim)
police.emit("nightAction", { targetIds: [godfather.last.you.id] }); // will read "not a Killer"
doctor.emit("nightAction", { targetIds: [vills[1].last.you.id] }); // heal someone else
killer.emit("nightAction", { targetIds: [vills[0].last.you.id] }); // kill villager 1
godfather.emit("nightAction", { targetIds: [] });
await wait(700);

console.log("WITCH phase:", host.last.phase);
await both(witch, "witch-phase");
await both(host, "host-witch");

/* ---- witch skips revive -> day ---- */
witch.emit("nightAction", { targetIds: [] });
await wait(600);

/* ---- daytime chat, then day views ---- */
vills[1].emit("chat", { channel: "town", text: "Ben barely spoke last night 👀" });
police.emit("chat", { channel: "town", text: "Let's hear from Ben before we decide." });
host.emit("chat", { channel: "town", text: "The village wakes, uneasy…" });
await wait(500);

console.log("DAY views:", host.last.phase);
await both(host, "host-day");
await both(police, "police-day");      // shows the squad's private result + vote UI
await both(vills[1], "villager-day");  // a normal alive player voting

await browser.close();
host.close(); ps.forEach((p) => p.close());
console.log("\nAll screens saved to", OUT);
process.exit(0);
