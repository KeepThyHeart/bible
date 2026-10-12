# Accounts and sync: privacy notes (draft)

> **Draft — needs legal review.** This is a factual description of what the software does, to help the operator write a privacy policy. It is not legal advice and not a finished policy. Check it against the law that applies to you (for example GDPR, CCPA, children's-privacy rules) before publishing anything.

**Last verified:** 0150-web-accounts (2026-10-12)

Written for the operator of a server with accounts turned on ([operator.md](operator.md), [deploy.md](deploy.md)). Statements describe the code at the verified commit; if you change the configuration or the code, re-check them.

## What the server stores

Per account (the SQLite tables `account`, `keyset`, `device`, `session`, `record`, `email_token` in `apps/web/data/plugin-data/sync/sync.db`):

| Data | Visible to the server? | Notes |
|---|---|---|
| Email address | Yes, in clear | Needed for sign-in and reset mail. Stored lower-cased. |
| Whether the address is verified, account creation time | Yes | |
| Password | No | Only a verifier (a SHA-256 hash of a key derived from the password on the device) is stored. The password never leaves the device. |
| Recovery code | No | Only a verifier of a key derived from it. |
| Wrapped account keys and data keys | Stored, not readable | Encrypted on the device with keys derived from the password and from the recovery code. The server has neither. |
| Key-derivation parameters (cost settings, salt) | Yes | Not secret. |
| Notes, highlights, bookmarks, memory data | No | Each is one encrypted record (a ciphertext blob). |
| Record ids | Opaque | Derived on the device with a key the server does not have. |
| Record count, sizes, version numbers, change order | Yes | Needed to sync and enforce the quota. A record's size and when it changed are visible. |
| Whether a record was deleted | Yes | The deleted marker; its content is sealed. |
| Devices | Partly | Device id and creation time are visible. The device name is sealed on the device. |
| Sessions | Yes | A hash of the session token, device id, creation, last-seen and expiry times, and the browser's User-Agent string (cut to 256 characters). |
| Email tokens | Yes | Hashes of single-use verify and reset tokens, and their expiry. |
| IP addresses | Not stored in the database | Used in memory for rate limiting only (windows of minutes to an hour). Your reverse proxy and the app's log may record them: you decide. |
| Message contents | Not logged | The sync server logs error names and messages, never request bodies, headers, keys or tokens. |

The server cannot read what users write. That is a property of the design, with the limits below.

## What the server cannot see

Anything inside a record, the password, the recovery code and the keys. A database leak, a stolen backup or a curious administrator reading the database sees ciphertext plus the metadata above.

## Limits you must disclose

- **Web delivery.** The browser runs JavaScript delivered by your server. Whoever controls that server (or its CDN or TLS endpoint) could deliver code that captures the password. End-to-end encryption on the web therefore protects against database and backup leaks and passive observers, not against a malicious or compromised operator. The desktop app, installed and signed, does not have this weakness. See [operator.md](operator.md).
- **Metadata.** Email address, activity times and data volumes are visible to you.
- **Email.** Reset and verification messages pass through your mail provider. They contain links but no user data.

## Retention

| Data | Kept |
|---|---|
| Account and records | Until the user deletes the account |
| Unverified account (never confirmed by email) | Deleted after 7 days |
| Sessions | 90 days after sign-in; recovery sessions 30 minutes |
| Verify and reset links | 24 hours and 1 hour; single use |
| Rate-limit counters | In memory only; lost on restart |
| Backups (for example Litestream) | As long as you configure; a deleted account stays in older backups until they expire |
| Reverse proxy and server logs | As long as you configure |

The hourly purge job does the deletions in the first four rows.

## Deleting data

- **By the user.** The account privacy panel offers account deletion (needs the password). It removes the account row and all its records, keys, devices, sessions and tokens in one transaction, and signs the browser out. Local data on devices is kept unless the user chooses to wipe it.
- **"Start over".** After a forgotten password and recovery code, the emailed reset link empties the account (all records, devices and sessions) and re-keys it under a new password. The email address stays.
- **By the operator.** There is no admin interface. Deleting an account by request means deleting its rows in the database (and waiting out backup retention). Ask the requester to delete through the app where possible.

## Export

The account privacy panel offers a download of one JSON file (`sync-export.json`, format `kth-sync-export`): account email and creation time, usage, the device list, the key sets and every encrypted record. The records are ciphertext: the file is only readable with the user's password or recovery code in this software. It is limited to 3 exports per hour per account. The user's own notes and highlights are also on their devices in the app's normal export and backup features.

## Age and consent

The sign-up form requires the user to confirm the terms and the minimum age (`accounts.minAge`, default 16) and links your `termsUrl` and `privacyUrl`. Set both to real pages before opening sign-up. Whether 16 is right for your jurisdiction is a legal question.

## Checklist for your policy

1. Controller identity and contact.
2. The table above, with your own log and backup retention.
3. The limits (operator can in principle serve altered code; metadata is visible).
4. Mail provider and any hosting or CDN providers as processors.
5. How users delete and export, and what you do on a request that arrives by email.
6. Legal basis, user rights, regulator contact: needs legal review.
