// Sandbox/dev bootstrap: the Firebase credential files are gitignored, so they
// are materialized from environment variables before the dev server starts.
//
// - firebase-applet-config.json  <- FIREBASE_* client values
// - firebase-admin-sdk.json      <- FIREBASE_ADMIN_SDK_JSON (at FIREBASE_ADMIN_SDK_PATH)
//
// Values are read from env only; nothing is ever written into git.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

const clientConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.FIREBASE_APP_ID || "",
};

const databaseId = process.env.FIREBASE_FIRESTORE_DATABASE_ID?.trim();
if (databaseId) {
  clientConfig.firestoreDatabaseId = databaseId;
}

const configPath = path.join(root, "firebase-applet-config.json");
fs.writeFileSync(configPath, `${JSON.stringify(clientConfig, null, 2)}\n`);
console.log(`[base44] wrote ${path.basename(configPath)}`);

const adminSdk = process.env.FIREBASE_ADMIN_SDK_JSON?.trim();
if (adminSdk) {
  const target =
    process.env.FIREBASE_ADMIN_SDK_PATH ||
    path.join(root, "firebase-admin-sdk.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${adminSdk}\n`, { mode: 0o600 });
  console.log(`[base44] wrote Firebase admin credentials to ${target}`);
} else {
  console.warn(
    "[base44] FIREBASE_ADMIN_SDK_JSON not set — admin/service endpoints will be disabled.",
  );
}
