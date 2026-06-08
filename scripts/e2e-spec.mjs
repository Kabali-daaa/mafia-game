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

// Spin up a host + N named players, deal `config`, and start.
async function setup(names, config) {
  const tag = "g" + seq++;
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

// ---------------------------------------------------------------------------
console.log("\nTEST 1 — Police sees the Godfather as innocent");
{
  const { host, ps } = await setup(
    ["A", "B", "C", "D"],
    { godfather: 1, police: 1, villager: 2 }
  );
  const police = byRole(ps, "police");
  const gf = byRole(ps, "godfather");
  assert(!!police && !!gf, "police + godfather dealt");
  police.emit("nightAction", { targetIds: [gf.last.you.id] });
  gf.emit("nightAction", { targetIds: [] }); // godfather skips the kill
  await wait(500);
  const msg = police.last.privateMessage || "";
  assert(/is NOT a Killer/.test(msg), `police told godfather is innocent ("${msg}")`);
  close(host, ps);
}

// ---------------------------------------------------------------------------
console.log("\nTEST 2 — Lovers die together (night kill)");
{
  const { host, ps } = await setup(
    ["A", "B", "C", "D"],
    { killer: 1, cupid: 1, villager: 2 }
  );
  const killer = byRole(ps, "killer");
  const cupid = byRole(ps, "cupid");
  const vills = allByRole(ps, "villager");
  const [l1, l2] = vills;
  cupid.emit("nightAction", { targetIds: [l1.last.you.id, l2.last.you.id] });
  killer.emit("nightAction", { targetIds: [l1.last.you.id] });
  await wait(600);
  assert(state(host, l1.last.you.id)?.alive === false, "lover 1 (killed) is dead");
  assert(state(host, l2.last.you.id)?.alive === false, "lover 2 died of the link");
  close(host, ps);
}

// ---------------------------------------------------------------------------
console.log("\nTEST 3 — Lovers die together (day lynch)");
{
  const { host, ps } = await setup(
    ["A", "B", "C", "D"],
    { killer: 1, cupid: 1, villager: 2 }
  );
  const killer = byRole(ps, "killer");
  const cupid = byRole(ps, "cupid");
  const vills = allByRole(ps, "villager");
  const [l1, l2] = vills;
  cupid.emit("nightAction", { targetIds: [l1.last.you.id, l2.last.you.id] });
  killer.emit("nightAction", { targetIds: [] });
  await wait(500);
  assert(host.last.phase === "day", "reached day");
  // Everyone votes lover 1 out.
  for (const p of ps) {
    if (p.last.you.alive && p.last.you.id !== l1.last.you.id)
      p.emit("vote", { targetId: l1.last.you.id });
  }
  l1.emit("vote", { targetId: killer.last.you.id });
  await wait(600);
  assert(state(host, l1.last.you.id)?.alive === false, "lynched lover is dead");
  assert(state(host, l2.last.you.id)?.alive === false, "partner died of heartbreak");
  close(host, ps);
}

// ---------------------------------------------------------------------------
console.log("\nTEST 4 — Witch revives the night's victim");
{
  const { host, ps } = await setup(
    ["A", "B", "C", "D"],
    { killer: 1, witch: 1, villager: 2 }
  );
  const killer = byRole(ps, "killer");
  const vict = allByRole(ps, "villager")[0];
  killer.emit("nightAction", { targetIds: [vict.last.you.id] });
  await wait(500);
  assert(host.last.phase === "witch", "entered witch sub-phase after a death");
  const witch = byRole(ps, "witch");
  assert(witch.last.prompt?.kind === "witch", "witch has a revive prompt");
  witch.emit("nightAction", { targetIds: [vict.last.you.id] });
  await wait(500);
  assert(host.last.phase === "day", "advanced to day after revive");
  assert(state(host, vict.last.you.id)?.alive === true, "victim was revived");
  close(host, ps);
}

// ---------------------------------------------------------------------------
console.log("\nTEST 5 — Panchayath Thalivar immune while Cupid alive");
{
  const { host, ps } = await setup(
    ["A", "B", "C", "D"],
    { killer: 1, cupid: 1, panchayath: 1, villager: 1 }
  );
  const killer = byRole(ps, "killer");
  const cupid = byRole(ps, "cupid");
  const pan = byRole(ps, "panchayath");
  const others = ps.filter(
    (p) => p.last.you.id !== cupid.last.you.id && p.last.you.alive
  );
  // Cupid must link two players; pick the first two non-cupid alive players.
  cupid.emit("nightAction", {
    targetIds: [others[0].last.you.id, others[1].last.you.id],
  });
  killer.emit("nightAction", { targetIds: [pan.last.you.id] });
  await wait(600);
  assert(
    state(host, pan.last.you.id)?.alive === true,
    "Panchayath survived the Killer (Cupid alive)"
  );
  close(host, ps);
}

// ---------------------------------------------------------------------------
console.log("\nTEST 6 — Item never repeats a target, dies on the Killer");
{
  const { host, ps } = await setup(
    ["A", "B", "C", "D", "E"],
    { killer: 1, item: 1, villager: 3 }
  );
  const killer = byRole(ps, "killer");
  const item = byRole(ps, "item");
  const visits = new Set();
  let itemDiedNight = false;
  for (let night = 1; night <= 5 && host.last.phase !== "ended"; night++) {
    if (host.last.phase !== "night") break;
    killer.emit("nightAction", { targetIds: [] }); // killer skips so only the Item's curse acts
    await wait(450);
    // Record the Item's visit (from its private message).
    const msg = item.last.privateMessage || "";
    const m = msg.match(/drawn to (\w+)/);
    if (m) {
      assert(!visits.has(m[1]), `night ${night}: Item visited a NEW player (${m[1]})`);
      visits.add(m[1]);
    }
    if (state(host, item.last.you.id)?.alive === false) {
      itemDiedNight = true;
      break;
    }
    // Day: everyone skips so no one is lynched.
    if (host.last.phase === "day") {
      for (const p of ps) if (p.last.you.alive) p.emit("vote", { targetId: null });
      await wait(450);
    }
  }
  assert(itemDiedNight, "Item eventually died after being drawn to the Killer");
  close(host, ps);
}

// ---------------------------------------------------------------------------
console.log("\nTEST 7 — Jester wins when lynched");
{
  const { host, ps } = await setup(
    ["A", "B", "C", "D"],
    { killer: 1, jester: 1, villager: 2 }
  );
  byRole(ps, "killer").emit("nightAction", { targetIds: [] });
  await wait(500);
  const jester = byRole(ps, "jester");
  for (const p of ps) {
    if (p.last.you.alive && p.last.you.id !== jester.last.you.id)
      p.emit("vote", { targetId: jester.last.you.id });
  }
  jester.emit("vote", { targetId: byRole(ps, "killer").last.you.id });
  await wait(600);
  assert(host.last.phase === "ended", "game ended on lynching the Jester");
  assert(host.last.winner === "neutral", `Jester won (winner=${host.last.winner})`);
  close(host, ps);
}

await wait(300);
console.log(
  failures === 0
    ? "\n✅ ALL SPEC TESTS PASSED"
    : `\n❌ ${failures} assertion(s) failed`
);
process.exit(failures === 0 ? 0 : 1);
