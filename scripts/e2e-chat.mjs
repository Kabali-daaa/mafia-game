import { io } from "socket.io-client";

const URL = "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const assert = (cond, msg) => {
  console.log(`  ${cond ? "✓" : "✗ FAIL:"} ${msg}`);
  if (!cond) failures++;
};

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
const byRole = (ps, role) => ps.find((p) => p.last.you.roleId === role);
const allByRole = (ps, role) => ps.filter((p) => p.last.you.roleId === role);

const host = mkClient("host");
host.emit("create", { name: "GOD", playerId: "c_h" });
await wait(300);
const code = host.code;
const names = ["A", "B", "C", "D", "E"];
const ps = names.map((n) => {
  const c = mkClient(n);
  c.emit("join", { code, name: n, playerId: "c_" + n });
  return c;
});
await wait(400);
host.emit("setConfig", { config: { killer: 1, godfather: 1, police: 1, villager: 2 } });
await wait(150);
host.emit("start");
await wait(400);

const killer = byRole(ps, "killer");
const gf = byRole(ps, "godfather");
const police = byRole(ps, "police");
const villagers = allByRole(ps, "villager");
const vill = villagers[0];

console.log("\nTEST 1 — Killers' room is private and named to members + God");
killer.emit("chat", { channel: "killers", text: "let's hit C tonight" });
await wait(350);
{
  const gfLine = gf.last.chat.killers?.find((l) => /hit C/.test(l.text));
  assert(!!gfLine, "godfather sees the killer's message");
  assert(gfLine?.sender === killer.last.you.name, "godfather sees the REAL sender name");
  assert(police.last.chat.killers === null, "police (town) cannot see the Killers' room at all");
  assert(vill.last.chat.killers === null, "villager cannot see the Killers' room at all");
  const hostLine = host.last.chat.killers?.find((l) => /hit C/.test(l.text));
  assert(hostLine?.sender === killer.last.you.name, "GOD sees the Killers' room with real name");
}

console.log("\nTEST 2 — Town chat is closed at night");
vill.emit("chat", { channel: "town", text: "night message should be dropped" });
await wait(300);
assert(
  (host.last.chat.town || []).length === 0,
  "town message at night was rejected (town opens by day)"
);

console.log("\nTEST 3 — advance to day, then town chat is anonymous to players");
// Everyone with a night action skips so we reach the day.
killer.emit("nightAction", { targetIds: [] });
gf.emit("nightAction", { targetIds: [] });
police.emit("nightAction", { targetIds: [] });
await wait(500);
assert(host.last.phase === "day", "reached the day phase");

vill.emit("chat", { channel: "town", text: "I think B is suspicious" });
await wait(350);
{
  const v2 = villagers[1];
  const seenByOther = v2.last.chat.town.find((l) => /B is suspicious/.test(l.text));
  assert(!!seenByOther, "another player sees the town message");
  assert(seenByOther?.sender === null, "to other players the sender is ANONYMOUS");
  const seenBySelf = vill.last.chat.town.find((l) => /B is suspicious/.test(l.text));
  assert(seenBySelf?.sender === "You", "the author sees their own line as 'You'");
  const seenByGod = host.last.chat.town.find((l) => /B is suspicious/.test(l.text));
  assert(seenByGod?.sender === vill.last.you.name, "GOD sees the real author name");
}

await wait(300);
console.log(
  failures === 0 ? "\n✅ ALL CHAT TESTS PASSED" : `\n❌ ${failures} assertion(s) failed`
);
host.close();
ps.forEach((p) => p.close());
process.exit(failures === 0 ? 0 : 1);
