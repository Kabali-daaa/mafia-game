import "server-only";

// Server-side Firebase Admin — used inside /api routes to read & write game
// state with full privileges (it bypasses the security rules). Credentials come
// from the FIREBASE_SERVICE_ACCOUNT env var (a service-account JSON string).
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let app: App;
let db: Firestore;

export function adminDb(): Firestore {
  if (!db) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
      throw new Error(
        "FIREBASE_SERVICE_ACCOUNT env var is missing (the service-account JSON)."
      );
    }
    const creds = JSON.parse(raw);
    // Vercel stores the private key with literal "\n"; turn them into newlines.
    if (typeof creds.private_key === "string") {
      creds.private_key = creds.private_key.replace(/\\n/g, "\n");
    }
    app = getApps().length ? getApps()[0] : initializeApp({ credential: cert(creds) });
    db = getFirestore(app);
    db.settings({ ignoreUndefinedProperties: true });
  }
  return db;
}
