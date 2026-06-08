import "server-only";

// Server-side Firebase Admin — used inside /api routes to read & write game
// state with full privileges (it bypasses the security rules). Credentials come
// from the FIREBASE_SERVICE_ACCOUNT env var (a service-account JSON string).
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// Cache on globalThis so it survives module duplication / dev hot-reloads
// (otherwise each route bundle tries to call settings() again and crashes).
const g = globalThis as unknown as { __mafiaDb?: Firestore };

export function adminDb(): Firestore {
  if (g.__mafiaDb) return g.__mafiaDb;

  let app: App;
  if (getApps().length) {
    app = getApps()[0];
  } else {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
      throw new Error(
        "FIREBASE_SERVICE_ACCOUNT env var is missing (the service-account JSON)."
      );
    }
    const creds = JSON.parse(raw);
    if (typeof creds.private_key === "string") {
      creds.private_key = creds.private_key.replace(/\\n/g, "\n");
    }
    app = initializeApp({ credential: cert(creds) });
  }

  const db = getFirestore(app);
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // settings() can only run once per Firestore instance — safe to ignore if
    // it was already applied by an earlier module instance.
  }
  g.__mafiaDb = db;
  return db;
}
