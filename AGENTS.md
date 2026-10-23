# Smart Cafe — sandbox / dev notes

## Running it

```bash
docker compose -f docker-compose.base44.yml up -d
```

The container runs `npm ci` then `npm run dev` (`tsx server.ts`), which starts Express on
port 3000 and mounts Vite in middleware mode. That single port serves both the SPA and
the `/api/*` routes, so there is no separate frontend/backend process.

- `npm ci` uses the committed `package-lock.json`; `node_modules` lives in the named
  volume `app_node_modules`, so a rebuild isn't needed after dependency changes.
- Only the frontend hot-reloads (Vite HMR). Changes to `server.ts` need
  `docker compose -f docker-compose.base44.yml restart app`.

## External dependencies (no local database)

All data lives in **Firebase** (Firestore + Firebase Auth); there is no local DB service.
The AI concierge calls **Groq**.

The two credential files are gitignored and are generated at container start by
`scripts/base44-write-firebase-config.mjs`:

| File | Source env | Needed for |
| --- | --- | --- |
| `firebase-applet-config.json` | `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`, optional `FIREBASE_FIRESTORE_DATABASE_ID` | Frontend SDK; `src/firebase.ts` imports it statically, so it must exist or Vite fails to serve the app |
| `firebase-admin-sdk.json` (`FIREBASE_ADMIN_SDK_PATH`) | `FIREBASE_ADMIN_SDK_JSON` (whole service-account JSON) | Backend admin/service API routes and admin custom-claim checks |

Placeholders in `.env.base44-defaults` let the app boot without credentials; the app is
listed *after* none and `/run/base44/app.env` (platform secrets) is loaded last, so real
values always win. A missing admin key only logs "Firebase Admin SDK initialization
failed" — the server still starts.

Without real Firebase values the UI renders (landing page, concierge shell) but menu
items, sign-in and orders come back empty. Without `GROQ_API_KEY` the concierge requests
fail; `ApiKeyGuard` only checks that the value is non-empty.

## Verifying it works

```bash
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/   # 200, Vite dev HTML with /@vite/client
docker compose -f docker-compose.base44.yml ps                   # app "healthy"
docker compose -f docker-compose.base44.yml logs --tail=50 app
```

The served HTML must contain `/@vite/client` and `/src/main.tsx` — that proves it is the
dev server from the bind-mounted source, not a prebuilt bundle.
