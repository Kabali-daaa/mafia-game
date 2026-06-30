// Simulation: drive one night that produces TWO kill types + a save, then
// screenshot the host's "God's eye — the truth" panel. (Reuses the visual-all harness.)
import fs from "fs";
import puppeteer from "../node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import { initializeApp } from "../node_modules/firebase/app/dist/index.mjs";
import { getFirestore, doc, getDoc } from "../node_modules/firebase/firestore/dist/index.mjs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://localhost:3000";
const OUT = "screens";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (p, b) => fetch(URL + "/api/" + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));

const env = Object.fromEntries(
  fs.readFileSync(new globalThis.URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const app = initializeApp({
  apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const db = getFirestore(app);
const view = async (code, pid) => (await getDoc(doc(db, "rooms", code, "views", pid))).data();
const send = (code, pid, type, payload = {}) => api("action", { code, playerId: pid, type, payload });

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
async function skipCurrent(code, host) {
  const hv = await view(code, host);
  for (const e of hv.nightControl?.board ?? []) if (e.current && !e.done) await send(code, host, "hostSkip", { targetId: e.id });
}
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
    await skipCurrent(code, host);
    await send(code, host, "advance");
    await wait(280);
  }
}

// 1 Killer + 1 Psycho (both attack on night 1) + Doctor + Police + 2 Villagers.
const g = await game("god_", { killer: 1, psycho: 1, doctor: 1, police: 1, villager: 2 });
const killer = g.roles.killer[0], psycho = g.roles.psycho[0], doctor = g.roles.doctor[0], police = g.roles.police[0];
const [v0, v1] = g.roles.villager;
console.log("roles:", JSON.stringify(g.roles));

// Killer aims at V0 — but the Doctor heals V0 (the save). The Psycho kills V1.
await runNight(g.code, g.host, {
  [killer]: [v0],
  [doctor]: [v0],
  [psycho]: [v1],
  [police]: [killer],
});

const hv = await view(g.code, g.host);
console.log("phase after night:", hv.phase);
console.log("godLog:", JSON.stringify(hv.godLog, null, 2));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1320, height: 1000, isMobile: false, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument((p, n) => { localStorage.setItem("mafia:playerId", p); localStorage.setItem("mafia:name", n); }, g.host, "GOD");
await page.goto(URL + "/room/" + g.code, { waitUntil: "domcontentloaded" });
await wait(2000);

// Full host desktop view.
await page.screenshot({ path: `${OUT}/godlog-host-desktop.png`, fullPage: true });

// Just the God's-eye panel.
const panel = await page.evaluateHandle(() => {
  const h = [...document.querySelectorAll("h2,h3,div,p")].find((e) => /God's eye/i.test(e.textContent || ""));
  return h ? h.closest("section") : null;
});
if (panel && panel.asElement()) {
  await panel.asElement().screenshot({ path: `${OUT}/godlog-panel.png` });
  console.log("saved screens/godlog-panel.png");
} else {
  console.log("panel not found on page");
}

// Mobile shot too.
const m = await browser.newPage();
await m.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await m.evaluateOnNewDocument((p, n) => { localStorage.setItem("mafia:playerId", p); localStorage.setItem("mafia:name", n); }, g.host, "GOD");
await m.goto(URL + "/room/" + g.code, { waitUntil: "domcontentloaded" });
await wait(2000);
await m.screenshot({ path: `${OUT}/godlog-host-mobile.png`, fullPage: true });

await browser.close();
console.log("done — room", g.code);
process.exit(0);
