import { io } from "socket.io-client";

const URL = "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const assert = (cond, msg) => {
  console.log(`  ${cond ? "✓" : "✗ FAIL:"} ${msg}`);
  if (!cond) failures++;
};

let seq = 0;
function mk(id) {
  const s = io(URL, { forceNew: true });
  s.last = null; s.code = null;
  s.on("room", (v) => (s.last = v));
  s.on("joined", (p) => (s.code = p.code));
  return s;
}
async function setup(names, config) {
  const tag = "w" + seq++;
  const host = mk(tag + "_h");
  host.emit("create", { name: "H", playerId: tag + "_h" });
  await wait(280);
  const code = host.code;
  const ps = names.map((n) => { const c = mk(tag + "_" + n); c.emit("join", { code, name: n, playerId: tag + "_" + n }); return c; });
  await wait(380);
  host.emit("setConfig", { config });
  await wait(150);
  host.emit("start");
  await wait(380);
  return { host, ps };
}
const byRole = (ps, r) => ps.find((p) => p.last.you.roleId === r);
const allByRole = (ps, r) => ps.filter((p) => p.last.you.roleId === r);
const state = (host, id) => [host.last.you, ...host.last.players].find((p) => p.id === id);
const close = (host, ps) => { host.close(); ps.forEach((p) => p.close()); };

// ---------------------------------------------------------------------------
console.log("\nTEST 1 — Lovers: Witch sees ONE primary; reviving brings back BOTH");
{
  const { host, ps } = await setup(["A","B","C","D","E"], { killer:1, cupid:1, witch:1, villager:2 });
  const killer = byRole(ps,"killer"), cupid = byRole(ps,"cupid"), witch = byRole(ps,"witch");
  const [l1, l2] = allByRole(ps,"villager");
  cupid.emit("nightAction", { targetIds: [l1.last.you.id, l2.last.you.id] });
  killer.emit("nightAction", { targetIds: [l1.last.you.id] });
  await wait(600);
  assert(host.last.phase === "witch", "entered witch phase (a lover died)");
  assert(witch.last.prompt?.targets.length === 1, `Witch is shown only ONE person (got ${witch.last.prompt?.targets.length})`);
  assert(witch.last.prompt?.targets[0] === l1.last.you.id, "the one shown is the killed lover (the primary)");
  witch.emit("nightAction", { targetIds: [l1.last.you.id] }); // revive the pair
  await wait(500);
  assert(state(host, l1.last.you.id)?.alive === true, "lover 1 revived");
  assert(state(host, l2.last.you.id)?.alive === true, "lover 2 revived too (bound to the primary)");
  close(host, ps);
}

// ---------------------------------------------------------------------------
console.log("\nTEST 2 — Lovers: if the Witch does NOT revive, BOTH die");
{
  const { host, ps } = await setup(["A","B","C","D","E"], { killer:1, cupid:1, witch:1, villager:2 });
  const killer = byRole(ps,"killer"), cupid = byRole(ps,"cupid"), witch = byRole(ps,"witch");
  const [l1, l2] = allByRole(ps,"villager");
  cupid.emit("nightAction", { targetIds: [l1.last.you.id, l2.last.you.id] });
  killer.emit("nightAction", { targetIds: [l1.last.you.id] });
  await wait(600);
  assert(host.last.phase === "witch", "entered witch phase");
  witch.emit("nightAction", { targetIds: [] }); // skip the revive
  await wait(500);
  assert(state(host, l1.last.you.id)?.alive === false, "lover 1 is dead");
  assert(state(host, l2.last.you.id)?.alive === false, "lover 2 is dead too");
  close(host, ps);
}

// ---------------------------------------------------------------------------
console.log("\nTEST 3 — Villager + Item: Witch sees ONLY the villager; reviving saves both");
{
  let done = false;
  for (let attempt = 0; attempt < 16 && !done; attempt++) {
    const { host, ps } = await setup(["A","B","C","D"], { killer:1, item:1, witch:1, villager:1 });
    const killer = byRole(ps,"killer"), item = byRole(ps,"item"), witch = byRole(ps,"witch");
    const vill = byRole(ps,"villager");
    killer.emit("nightAction", { targetIds: [vill.last.you.id] }); // kill the villager
    await wait(550);
    if (host.last.phase !== "witch") { close(host, ps); continue; }
    // Did the Item get drawn to the villager we killed? (only then are they linked)
    const drewVillager = (item.last.privateMessage || "").includes(`drawn to ${vill.last.you.name}`);
    if (!drewVillager) { close(host, ps); continue; }
    console.log(`  (attempt ${attempt + 1}: Item was drawn to the doomed villager)`);
    assert(witch.last.prompt?.targets.length === 1, `Witch shown only ONE person (got ${witch.last.prompt?.targets.length})`);
    assert(witch.last.prompt?.targets[0] === vill.last.you.id, "the one shown is the villager, not the Item");
    witch.emit("nightAction", { targetIds: [vill.last.you.id] }); // revive
    await wait(500);
    assert(state(host, vill.last.you.id)?.alive === true, "villager revived");
    assert(state(host, item.last.you.id)?.alive === true, "the bound Item revived with them");
    done = true;
    close(host, ps);
  }
  assert(done, "reproduced the Item-drawn-to-victim case within the attempts");
}

await wait(300);
console.log(failures === 0 ? "\n✅ ALL WITCH-LINK TESTS PASSED" : `\n❌ ${failures} assertion(s) failed`);
process.exit(failures === 0 ? 0 : 1);
