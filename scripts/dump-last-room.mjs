// Read-only: dump the most-recently-updated room from Firestore so we can inspect
// what happened in the last game (players, roles, night actions, log, chronicle).
//
//   node scripts/dump-last-room.mjs
import fs from "fs";
import admin from "firebase-admin";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const line = env.split("\n").find((l) => l.startsWith("FIREBASE_SERVICE_ACCOUNT="));
if (!line) {
  console.error("FIREBASE_SERVICE_ACCOUNT not found in .env.local");
  process.exit(1);
}
const creds = JSON.parse(line.slice("FIREBASE_SERVICE_ACCOUNT=".length));
if (typeof creds.private_key === "string") creds.private_key = creds.private_key.replace(/\\n/g, "\n");

admin.initializeApp({ credential: admin.credential.cert(creds) });
const db = admin.firestore();

const snap = await db.collection("rooms").orderBy("updatedAt", "desc").limit(3).get();
if (snap.empty) {
  console.log("No rooms found.");
  process.exit(0);
}

for (const doc of snap.docs) {
  const r = doc.data();
  console.log("\n========================================");
  console.log(`ROOM ${doc.id}  phase=${r.phase} day=${r.day} winner=${r.winner ?? "-"}  updated=${new Date(r.updatedAt).toISOString()}`);
  console.log("nightStep:", r.nightStep, " voteStage:", r.voteStage);
  console.log("\nPLAYERS:");
  for (const p of r.players ?? []) {
    console.log(`  ${p.isHost ? "[HOST]" : "      "} ${p.name.padEnd(14)} role=${(p.roleId ?? "-").padEnd(11)} alive=${p.alive} conn=${p.connected} id=${p.id}`);
  }
  console.log("\nCONFIG:", JSON.stringify(r.config));
  console.log("\nnightActions (playerId -> targetIds):");
  console.log(JSON.stringify(r.nightActions ?? {}, null, 2));
  console.log("\nroleState:", JSON.stringify(r.roleState ?? {}));
  console.log("witchRevives:", JSON.stringify(r.witchRevives ?? {}));
  console.log("\nCHRONICLE:");
  console.log(JSON.stringify(r.chronicle ?? [], null, 2));
  console.log("\nLOG:");
  for (const e of r.log ?? []) console.log(`  [${e.phase} d${e.day}] ${e.text.replace(/\n/g, "\n      ")}`);
}
process.exit(0);
