// One-shot cleanup: delete ALL rooms (and their per-player view subcollections)
// from Firestore, to start fresh. Uses the Admin SDK creds from .env.local.
//
//   node scripts/cleanup-firestore.mjs
//
// NOTE: deletes count against the daily Firestore write quota, so run it when the
// quota has room (e.g. after the daily reset).
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

const rooms = await db.collection("rooms").listDocuments();
console.log(`Found ${rooms.length} room(s). Deleting (with their views subcollections)…`);
await db.recursiveDelete(db.collection("rooms"));
console.log("✅ Firestore 'rooms' collection wiped — fresh start.");
process.exit(0);
