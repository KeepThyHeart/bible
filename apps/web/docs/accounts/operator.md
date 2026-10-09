# Accounts and sync: operator guide

**Last verified:** 0150-web-accounts (2026-10-09)

Accounts give a reader end-to-end encrypted sync of notes, highlights, bookmarks and memory data between devices. The server only stores encrypted blobs. This page is for the person who runs the web server: how to turn it on, what to configure and what the server can and cannot see. Code map:

- Server module: `apps/web/server/modules/accounts/manifest.ts` (flag `accounts`), `routes.ts` (mounts `/api/sync/v1`), `createAccounts.ts` (database, secret, purge timer, HSTS), `syncOptions.ts` (site config to sync-server options), `serverSecret.ts`.
- The sync server itself: `packages/sync-server/src/createSyncServer.ts` (an Express router, SQLite store, its own per-IP and per-account rate limits).
- Config: `apps/web/server/SiteConfig.ts` (`accounts` and `server.trustProxy`), `apps/web/config/site-config.example.json`, `apps/web/config/site-config.schema.json`.

## Turning it on

Two switches, both off by default:

```json
{
  "features": { "localUserDb": true, "accounts": true },
  "server": { "trustProxy": true },
  "accounts": {
    "publicUrl": "https://bible.example.org",
    "signupOpen": true,
    "quotaMB": 50,
    "minAge": 16,
    "termsUrl": "https://bible.example.org/terms",
    "privacyUrl": "https://bible.example.org/privacy",
    "email": { "kind": "smtp", "host": "smtp.example.org", "port": 587, "user": "bible", "pass": "...", "from": "Bible <noreply@example.org>" }
  }
}
```

- `features.accounts` is the only on switch (it requires `features.localUserDb`, the browser's local database). The `accounts` block holds settings only.
- With the flag off, the module's code is never loaded and every `/api/sync/*` request answers the standard "not available" 404. The server behaves exactly as before.
- `publicUrl` is required. It is used for links in emails and for the Origin check that protects cookie-authenticated writes: only the origin of `publicUrl` (plus any explicit `accounts.allowedOrigins`) may write. The request's own Host header is never trusted. If it is missing or invalid the site stays up and `/api/sync/v1/*` answers 503 with the reason (see the server log).
- Session cookies are `Secure` unless `publicUrl` is plain `http` on `localhost`, `127.0.0.1`, `[::1]` or `*.localhost`.
- When `publicUrl` is https, responses under `/api/sync/v1` carry `Strict-Transport-Security: max-age=31536000`. Site-wide HSTS (and `includeSubDomains`) belongs to the reverse proxy; the main server leaves it off on purpose so plain-http development keeps working.
- `quotaMB` is the per-account storage quota (default 50). `minAge` defaults to 16. `signupOpen: false` closes sign-up to new accounts while existing ones keep syncing.
- Email: `kind: "console"` (the default) prints each message, including sign-in and reset links, to the server log. Use it for development only; production needs `"smtp"` (works with SES, Postmark or any relay). `smtp` needs `host` and `from`; `port` defaults to 587 (465 when `secure` is true).

## The site password gate

The sync routes mount after the site password gate, like every other module. If `auth.enabled` is true, a browser must have passed the gate before it can sign up or sync, and a client that cannot hold the gate cookie (for example the desktop app talking to this server) cannot reach the API. Run the sync server on a site without the gate if desktop devices should use it.

## Reverse proxy and `server.trustProxy`

The rate limiters count requests per `req.ip`. Behind a reverse proxy that address is the proxy's unless Express is told to trust the forwarded header.

- `server.trustProxy` accepts `true`, `false`, a hop count (`1`), a subnet string (`"loopback, 10.0.0.0/8"`) or a list of them, exactly as Express's `trust proxy`.
- When it is not set, the server keeps its pre-existing behaviour (`true`, defined by `UNSET_TRUST_PROXY` in `apps/web/server/trustProxy.ts`), so an existing deployment behind Apache or nginx is unchanged.
- If the server is reachable directly (no proxy), set `false`: with `true` any client can send its own `X-Forwarded-For` and dodge the per-IP limits.
- Prefer a hop count or the proxy's subnet over `true` when you know them.

The sync API is exempt from the main server's global and tier rate limits (`isGloballyRateLimitExempt` in `apps/web/server/middleware/rateLimiter.ts`), because the sync server enforces its own.

## Storage and backups

Everything the sync server keeps is under the instance state directory (`apps/web/data`), in `plugin-data/sync/`:

| File | What it is | Notes |
|---|---|---|
| `sync.db` (+ `-wal`, `-shm`) | accounts, devices, sessions and the encrypted records | SQLite in WAL mode. |
| `server-secret.key` | 32 random bytes, created on first start, mode `0600` | Never logged. Keep it with the database backups. If it is lost the server starts a new one; accounts keep working but unknown-email lookups change their fake salts, which can reveal which emails exist. |

Back up with SQLite's online backup, not a plain copy of a live WAL database:

```sh
sqlite3 plugin-data/sync/sync.db ".backup 'sync-backup.db'"
```

Continuous replication with Litestream works too. Back up `server-secret.key` alongside it, to storage with the same protection as the database. A backup contains only ciphertext: restoring it cannot expose reading data, but it does contain email addresses and password-verification material, so protect it like any account database.

An hourly timer (unreferenced, so it never keeps the process alive) removes expired sessions, tokens and unverified accounts.

## What the server can and cannot see

Can see:

- Email addresses, account creation and last-seen times, device names and when each device last synced.
- Record counts, sizes, record ids (random-looking, derived with a key the server does not have) and change times.
- IP addresses of requests, in memory only for rate limiting (and in your reverse proxy's logs, which you control).
- Metadata of encrypted records that must be visible to route them: the account they belong to and a version number.

Cannot see:

- Notes, highlights, bookmarks, memory data or anything else inside a record: each is encrypted on the device with a key derived from the account password (and an optional recovery code) that never leaves the device.
- The account password. The server stores only a verifier derived from it.

It follows that the operator cannot reset a forgotten password and recover the data. A user who loses both the password and the recovery code loses their synced data (devices that are still signed in keep their local copy).

Never put keys, tokens or passwords in server logs. The sync server logs only error names and messages, never request bodies or headers.

## What the web build can and cannot promise

End-to-end encryption on the web means the browser encrypts before upload. The browser runs JavaScript this server delivers, so a server (or anyone who controls its files, its CDN or the TLS endpoint) that wants to read user data could serve altered JavaScript that captures the password or the keys. Encryption protects against a database leak, a backup leak and a passive observer. It does not protect against a malicious or compromised operator of the site the user is signing in to. The same is true of every browser-based E2EE product.

The Content-Security-Policy (`apps/web/server/cspDirectives.ts`) keeps `'unsafe-inline'` for scripts because `index.html` has an inline error fallback, so CSP is not a defence against injected inline script here. Users who need the stronger guarantee should use the desktop app, whose code is signed and installed rather than delivered on every visit. State this plainly in your privacy policy; the app's privacy panel says the same.

## Service worker

The service worker never caches `/api/sync` or anything under it (`NEVER_CACHE_PATHS` in `apps/web/src/sw/cacheRules.ts`, covered by `apps/web/src/sw/cacheRules.test.ts`). Responses carry `Cache-Control: no-store`.

## Request size

The record push may be up to 8 MiB. The server module registers a body parser for `/api/sync/v1/push` only (limit 9 MB, ahead of the host's 100 kB parser); every other route under `/api/sync/v1` and the rest of the site keep small limits. If a reverse proxy sits in front, allow at least 9 MB request bodies for that path (nginx: `client_max_body_size 9m;`).
