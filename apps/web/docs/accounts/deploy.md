# Deploying the web server with accounts

**Last verified:** 0150-web-accounts (2026-10-12)

How to run the web server in production with accounts and sync turned on. For the settings themselves see [operator.md](operator.md); for what users are told see [privacy-notes.md](privacy-notes.md) and [user-guide.md](user-guide.md). Example files live in `apps/web/deploy/`: `litestream.yml`, `systemd/kth-web.service`, `Caddyfile.example` and `nginx.conf.example`. They use `example.org` and placeholder paths; replace them with your own and never commit real hostnames or credentials.

## Overview

One Node process (`node dist/server/index.js`, port `PORT`, default 3100) behind a TLS-terminating reverse proxy. The sync server runs inside it as a module and keeps a SQLite file under the instance state directory. Nothing else is needed: no separate database server, queue or worker.

Build once on the machine or in CI, then run:

```sh
pnpm install --frozen-lockfile
pnpm --filter @bible/web run build
cd apps/web && node dist/server/index.js
```

## Site config

Start from `apps/web/config/site-config.example.json`. The settings that matter for accounts (all documented in [operator.md](operator.md)):

```json
{
  "features": { "localUserDb": true, "accounts": true },
  "server": { "trustProxy": 1 },
  "accounts": {
    "publicUrl": "https://bible.example.org",
    "signupOpen": true,
    "quotaMB": 50,
    "minAge": 16,
    "termsUrl": "https://bible.example.org/terms",
    "privacyUrl": "https://bible.example.org/privacy",
    "allowedOrigins": [],
    "email": { "kind": "smtp", "host": "smtp.example.org", "port": 587, "user": "bible", "pass": "set-me", "from": "Bible <noreply@example.org>" }
  }
}
```

Keep `site-config.json` readable only by the service user (it holds the SMTP password).

## Reverse proxy and `server.trustProxy`

The sync server rate-limits per client address (`req.ip`). Express only reads the real client address from `X-Forwarded-For` when `server.trustProxy` says how many proxies to believe.

- **Set `server.trustProxy` explicitly.** The accounts module refuses `true` and an unset value: it logs an error and `/api/sync/v1/*` answers 503 until you fix it (the rest of the site keeps working).
- One proxy (Caddy or nginx on the same host or one load balancer): `"trustProxy": 1`.
- Two hops (a CDN in front of your proxy): `2`, or list the proxies' subnets, for example `"loopback, 10.0.0.0/8"`.
- The server reached directly, with no proxy: `false`.
- The number must equal the number of proxies that append to `X-Forwarded-For`. Too high lets a client choose its own address; too low makes every user share the proxy's address and one rate-limit bucket.
- The proxy must overwrite or append to `X-Forwarded-For`, never pass a client-supplied value through as the only entry. The examples do this.

Other proxy requirements:

- Terminate TLS. Session cookies are `Secure`, so sign-in does not work over plain http (except on a loopback `publicUrl` for development). `publicUrl` must be the exact public https origin; cross-origin writes from any other origin are refused unless listed in `accounts.allowedOrigins`.
- Allow request bodies of at least 9 MB for `/api/sync/` (the record push is up to 8 MiB). The examples set this.
- Do not cache `/api/sync/`. The server already sends `Cache-Control: no-store`.
- Send HSTS site-wide from the proxy. The app itself only adds it under `/api/sync/v1`.
- Do not log request bodies or the `Cookie` header at the proxy. Access logs hold client addresses; decide how long to keep them and say so in your privacy policy.
- If the site password gate (`auth.enabled`) is on, desktop apps cannot reach the API (see [operator.md](operator.md)).

### Caddy

`apps/web/deploy/Caddyfile.example`: automatic certificates, HSTS, a 9 MB body limit for the sync path and a single `reverse_proxy`. Validate with `caddy validate --config /etc/caddy/Caddyfile`.

### nginx

`apps/web/deploy/nginx.conf.example`: port 80 redirect, TLS 1.2/1.3, HSTS, `client_max_body_size 9m` and the `X-Forwarded-*` headers. Obtain certificates with your usual tool (for example certbot). Validate with `nginx -t`.

## TLS

Use certificates from a public CA (Let's Encrypt via Caddy or certbot is fine) and renew automatically. Redirect http to https. Do not point `publicUrl` at an `http://` address in production: the module only accepts that for loopback development, and the console mail sender is only allowed there.

## Email (SMTP)

Accounts need working email: verification links (valid 24 hours), password reset ("start over") links (valid 1 hour) and security notices. Without a working sender users cannot verify or reset.

- Any SMTP relay works: Amazon SES, Postmark, Mailgun, SendGrid, your own provider. Set `accounts.email.kind` to `"smtp"` with `host`, `from`, and normally `user` and `pass`.
- Port 587 with STARTTLS is the default (`secure` false). Port 465 uses implicit TLS: set `"secure": true` (the port then defaults to 465).
- Use a dedicated sender address on a domain you control, and publish SPF, DKIM and DMARC records for it, or reset mails will land in spam.
- Use a credential that can only send mail.
- The sync server rate-limits mail sending (per address and overall) so a stranger cannot use your sender to flood a mailbox.
- `"console"` prints links (which are credentials) to the server log. It is accepted only for a loopback http `publicUrl` and is for development.
- Test after deploying: sign up with a real address, check the mail arrives and the link opens. Mail is sent after the HTTP response, so a delivery failure shows in the server log, not in the user's browser.

## Backups and Litestream

The sync database is the SQLite file `apps/web/data/plugin-data/sync/sync.db` (WAL mode, so also `-wal` and `-shm` files). The directory also holds `server-secret.key`. Back up both. The `apps/web/data` directory is the state directory, so the path is relative to the `apps/web` package, whatever the working directory.

Everything in a backup is ciphertext, email addresses and password-verification material. Treat backups like the account database itself: encrypted storage, restricted access, bounded retention.

### Litestream

`apps/web/deploy/litestream.yml` replicates the file continuously (every 10 seconds) to object storage. Run it as a second systemd service next to the web server, for example `litestream replicate -config /etc/litestream.yml`. Give it credentials through its environment file, not the YAML. Litestream and the web server must run on the same host with access to the same file. Do not run two web servers against one database.

Back up `server-secret.key` separately (it never changes), to storage with the same protection.

### Restore

1. Stop the web server (`systemctl stop kth-web`).
2. Move the damaged `sync.db`, `sync.db-wal` and `sync.db-shm` aside.
3. Restore: `litestream restore -config /etc/litestream.yml -o /opt/kth-bible/apps/web/data/plugin-data/sync/sync.db /opt/kth-bible/apps/web/data/plugin-data/sync/sync.db`. Add `-timestamp` to restore to a point in time.
4. Put `server-secret.key` back next to it, mode 0600, owned by the service user.
5. Start the server and sign in with a test account.

Clients that synced after the restore point simply push their newer records again. If you did not use Litestream, `sqlite3 sync.db ".backup 'copy.db'"` makes a consistent copy of a live database; a plain `cp` of a live WAL database can be corrupt.

Test a restore on a scratch machine before you need it.

## Running under systemd

`apps/web/deploy/systemd/kth-web.service` runs the server as an unprivileged user, restarts it on failure and limits where it can write to the `apps/web/data` directory. Install:

```sh
useradd --system --home /opt/kth-bible kth-web
cp apps/web/deploy/systemd/kth-web.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now kth-web
journalctl -u kth-web -f
```

Adjust `WorkingDirectory`, `ReadWritePaths` and `ExecStart` (the path of `node`) to your layout. Check with `systemd-analyze verify /etc/systemd/system/kth-web.service`. The service user must own `apps/web/data`.

## Upgrades

1. Take a backup (or confirm Litestream is current).
2. Pull the new version, install and build as in the overview.
3. `systemctl restart kth-web`. The sync database migrates itself on start (`PRAGMA user_version`).
4. Check `journalctl -u kth-web` for accounts errors (config, `trustProxy`, mail) and sign in.

Migrations only move forward. A server refuses to start on a database written by a newer version, so to roll back the code restore a backup made before the upgrade. Old browsers and desktop apps keep working across upgrades: the API is versioned (`/api/sync/v1`).

## Routine operation

- An hourly job deletes expired sessions (90 days after the last sign-in; 30 minutes for recovery sessions), expired email tokens, and unverified accounts after 7 days. It logs only on failure.
- Deleting an account (the user does this in the app) removes all of its rows in one transaction. Backups still hold it until they expire: keep backup retention short and say so in the privacy policy.
- Watch disk space: each account may use up to `quotaMB` of encrypted records.
- `signupOpen: false` closes sign-up and leaves existing accounts working.

## What you cannot do for users

The server holds no key that opens user data.

- **Forgotten password.** You cannot reset it and keep the data. A user who has the recovery code can set a new password from it. A user who has neither uses "start over" from the emailed link: the account (the same email address) is emptied and re-keyed, and every old encrypted record is deleted. Devices that are still signed in keep their local copies and upload them again.
- **Lost recovery code.** It cannot be shown again, only replaced by a new one while signed in.
- **Reading, searching or moving a user's data.** Not possible. Support can see the email address, counts, sizes and times; device names are sealed on the device.
- **Restoring one user's data from a backup** does not help them if they lost their keys; it restores ciphertext.

Say this up front in your support notes.
