import { io } from "socket.io-client";

const URL = "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const assert = (cond, msg) => {
  console.log(`  ${cond ? "✓" : "✗ FAIL:"} ${msg}`);
  if (!cond) failures++;
};

let seq = 0;
function mkClient(pid) {
  const s = io(URL, { forceNew: true });
  s.last = null;
  s.code = null;
  s.on("room", (v) => (s.last = v));
  s.on("joined", (p) => (s.code = p.code));
  s.on("error", (m) => console.log(`    [${pid}] ERR: ${m}`));
  s.pid = pid;
  return s;
}
async function setup(names, config) {
  const tag = "a" + seq++;
  const host = mkClient("host");
  host.emit("create", { name: "H", playerId: tag + "_h" });
  await wait(250);
  const code = host.code;
  const ps = names.map((n) => {
    const c = mkClient(n);
    c.emit("join", { code, name: n, playerId: tag + "_" + n });
    return c;
  });
  await wait(350);
  host.emit("setConfig", { config });
  await wait(150);
  host.emit("start");
  await wait(350);
  return { host, ps };
}
const byRole = (ps, role) => ps.find((p) => p.last.you.roleId === role);
const allByRole = (ps, role) => ps.filter((p) => p.last.you.roleId === role);
const state = (host, id) =>
  [host.last.you, ...host.last.players].find((p) => p.id === id);
const close = (host, ps) => {
  host.close();
  ps.forEach((p) => p.close());
};

// Everyone with a night prompt skips; auto-skip any witch step.
async function passNight(ps) {
  for (const p of ps)
    if (p.last.you.alive && p.last.prompt?.kind === "night")
      p.emit("nightAction", { targetIds: [] });
  await wait(500);
  for (const p of ps)
    if (p.last.prompt?.kind === "witch") p.emit("nightAction", { targetIds: [] });
  await wait(300);
}
async function passDay(ps) {
  for (const p of ps)
    if (p.last.you.alive && p.last.prompt?.kind === "vote")
      p.emit("vote", { targetId: null });
  await wait(500);
}

// ---------------------------------------------------------------------------
console.log("\nTEST 1 — Psycho Killer healed by the Doctor becomes a Vigilante");
{
  const { host, ps } = await setup(
    ["A", "B", "C", "D", "E"],
    { psycho: 1, killer: 1, doctor: 1, villager: 2 }
  );
  const psycho = byRole(ps, "psycho");
  const doctor = byRole(ps, "doctor");
  const killer = byRole(ps, "killer");
  assert(psycho.last.prompt?.kind === "night", "psycho is active on night 1 (odd)");
  doctor.emit("nightAction", { targetIds: [psycho.last.you.id] }); // heal the psycho
  psycho.emit("nightAction", { targetIds: [] });
  killer.emit("nightAction", { targetIds: [] });
  await wait(700);
  assert(psycho.last.you.roleId === "vigilante", "psycho secretly became a Vigilante");
  assert(/Vigilante/.test(psycho.last.privateMessage || ""), "psycho was privately told");
  close(host, ps);
}

// ---------------------------------------------------------------------------
console.log("\nTEST 2 — A transformed Vigilante is idle on even nights, shoots a Killer cleanly on odd");
{
  const { host, ps } = await setup(
    ["A", "B", "C", "D", "E"],
    { psycho: 1, killer: 1, doctor: 1, villager: 2 }
  );
  const psycho = byRole(ps, "psycho"); // becomes the vigilante
  const doctor = byRole(ps, "doctor");
  const killer = byRole(ps, "killer");

  // Night 1: heal the psycho -> Vigilante. Everyone else holds.
  doctor.emit("nightAction", { targetIds: [psycho.last.you.id] });
  psycho.emit("nightAction", { targetIds: [] });
  killer.emit("nightAction", { targetIds: [] });
  await wait(700);
  assert(psycho.last.you.roleId === "vigilante", "psycho is now a Vigilante");

  await passDay(ps); // -> night 2 (even)
  assert(host.last.day === 2 && host.last.phase === "night", "reached night 2 (even)");
  assert(psycho.last.prompt === null, "Vigilante has NO action on the even night");

  await passNight(ps); // night 2 resolves with skips
  await passDay(ps); // -> night 3 (odd)
  assert(host.last.day === 3 && host.last.phase === "night", "reached night 3 (odd)");
  assert(psycho.last.prompt?.kind === "night", "Vigilante is active again on the odd night");

  // Vigilante shoots the Killer (and the Killer + Doctor submit so the night resolves).
  psycho.emit("nightAction", { targetIds: [killer.last.you.id] });
  killer.emit("nightAction", { targetIds: [] });
  if (doctor.last.you.alive) doctor.emit("nightAction", { targetIds: [] });
  await wait(700);
  assert(state(host, killer.last.you.id)?.alive === false, "the Killer is dead");
  assert(state(host, psycho.last.you.id)?.alive === true, "the Vigilante survived (shot a Killer)");
  assert(host.last.winner === "town", "Town wins — all Killers eliminated");
  close(host, ps);
}

// ---------------------------------------------------------------------------
console.log("\nTEST 3 — A transformed Vigilante that shoots an innocent dies for it");
{
  const { host, ps } = await setup(
    ["A", "B", "C", "D", "E", "F"],
    { psycho: 1, killer: 1, doctor: 1, villager: 3 }
  );
  const psycho = byRole(ps, "psycho");
  const doctor = byRole(ps, "doctor");
  const killer = byRole(ps, "killer");

  doctor.emit("nightAction", { targetIds: [psycho.last.you.id] });
  psycho.emit("nightAction", { targetIds: [] });
  killer.emit("nightAction", { targetIds: [] });
  await wait(700);
  assert(psycho.last.you.roleId === "vigilante", "psycho is now a Vigilante");

  await passDay(ps); // night 2 (even)
  await passNight(ps);
  await passDay(ps); // night 3 (odd)
  assert(host.last.phase === "night" && host.last.day === 3, "reached night 3 (odd)");

  const innocent = allByRole(ps, "villager").find((v) => v.last.you.alive);
  psycho.emit("nightAction", { targetIds: [innocent.last.you.id] }); // shoot an innocent
  if (doctor.last.you.alive) doctor.emit("nightAction", { targetIds: [] });
  killer.emit("nightAction", { targetIds: [] });
  await wait(700);
  assert(state(host, innocent.last.you.id)?.alive === false, "the innocent target died");
  assert(state(host, psycho.last.you.id)?.alive === false, "the Vigilante died for shooting an innocent");
  close(host, ps);
}

await wait(300);
console.log(
  failures === 0
    ? "\n✅ ALL PSYCHO/VIGILANTE TESTS PASSED"
    : `\n❌ ${failures} assertion(s) failed`
);
process.exit(failures === 0 ? 0 : 1);
