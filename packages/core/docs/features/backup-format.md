# Backup Format

**Format version:** 1.0

The backup format is the file that holds a copy of a person's own data: their notes, highlights, links, collections, study data and the data extensions ask to keep. It is designed to be opened by any future version of the app, to be documented well enough that another program can read it, and to share its cryptography with the rest of `@bible/core`. This document is the public specification; the code is under `src/Crypto/` and `src/Backup/`.

Two files carry the same payload:

| File | What it is |
|---|---|
| `.bbk` | The **encrypted backup**: the payload sealed in a streamed, authenticated envelope, unlocked with a password. |
| `.zip` | The **unencrypted export**: the payload itself, a standard ZIP archive. Anyone with the file can read it. |

One reader opens both: the first bytes tell them apart (see [Sniffing](#sniffing)).

## Files

| File | Purpose |
|---|---|
| `src/Crypto/` | Browser-safe primitives: Argon2id (`hash-wasm`, loaded lazily), HKDF-SHA-256 and AES-256-GCM over WebCrypto, strict base64url, KDF-parameter validation, an injectable `RandomSource`. |
| `src/Backup/Envelope.ts` | The `.bbk` container: `sealStream`, `openStream`, `sniff`, `parseHeader`. |
| `src/Backup/StrictJson.ts` | A JSON parser that rejects duplicate keys, a byte order mark, trailing content and deep nesting. Used for the header and the manifest. |
| `src/Backup/Zip.ts` | The ZIP layer (`fflate`): safe-name rules, size and ratio guards, a strict reader. |
| `src/Backup/Payload.ts` | The payload: `createBackupPayload`, `readBackupPayload`, the manifest, the row encoding. |
| `src/Backup/BackupFile.ts` | `openBackupFile` / `readBackupFile`: sniff, decrypt if needed, verify. |
| `src/Backup/Registry.ts` | The user-table registry and `USER_SCHEMA_VERSION`. |
| `src/Backup/Restore.ts` | `inspectBackup`, `applyRestore`, replace and merge. |
| `src/Backup/ExtensionData.ts` | Resolving an extension manifest's `userData` block into what gets backed up. |
| `src/Backup/errors.ts` | The error classes a UI can tell apart. |
| `src/__tests__/Backup/`, `src/__tests__/Crypto/` | Known-answer tests, golden files (`fixtures/`), negative tests and property tests. |

Everything is in the `@bible/core/browser` barrel (namespaces `Backup` and `Crypto`); nothing imports a Node module. The desktop app supplies the platform parts (files, the database, Argon2id in a worker thread) - see the desktop backup doc.

## The encrypted container (`.bbk`)

```
preamble   16 bytes   magic (8) | major u16 BE | minor u16 BE | header length u32 BE
header     JSON       UTF-8, at most 65 536 bytes; key slots and stream parameters
segments   ...        AES-256-GCM: up to `segmentSize` plaintext bytes each, followed by a 16-byte tag
```

**Magic** is `89 4B 54 48 42 0D 0A 1A`: the high-bit byte catches 7-bit transfers, `CR LF` and `1A` catch newline and end-of-file mangling, and `KTHB` is recognisable in a hex dump. **Major** is `1`. A reader that sees a higher major refuses ("made by a newer version"); any minor under a known major is accepted.

### Header

```json
{
  "payload": "zip",
  "aead": "aes-256-gcm-stream",
  "segmentSize": 65536,
  "streamSalt": "<32 bytes, base64url>",
  "noncePrefix": "<7 bytes, base64url>",
  "keyCheck": "<32 bytes, base64url>",
  "slots": [
    {
      "type": "password",
      "kdf": { "id": "argon2id", "v": 19, "m": 65536, "t": 3, "p": 1, "salt": "<16 bytes, base64url>" },
      "nonce": "<12 bytes, base64url>",
      "wrapped": "<48 bytes, base64url>"
    }
  ]
}
```

- All binary values are **base64url without padding**, and the decoder is strict: only the URL-safe alphabet, no padding, no whitespace, and unused trailing bits must be zero, so each value has exactly one encoding. Every length is checked exactly.
- The header is parsed with a strict JSON parser (no duplicate keys at any depth, no byte order mark, nothing after the value). The stored bytes are what is authenticated, so writers use a fixed key order and no whitespace, and readers never re-serialise.
- `segmentSize` is between 4 096 and 4 194 304 bytes (the default is 65 536). `slots` holds 1 to 16 entries; a reader tries at most the first 4 password slots, so one file cannot demand unbounded key derivations.
- Unknown top-level keys are ignored (they are still covered by the header hash). A slot whose `type` is unknown, or whose `kdf.id` is not `argon2id` or `kdf.v` is not 19, is skipped, not an error.
- A reader checks, in this order, before doing any expensive work: the magic and version, the header length, the JSON, every field's type and size, the algorithm identifiers, and the KDF parameter bounds. Only then does it derive a key.

The header carries only what is needed to derive the key. No date, count or name is visible without the password.

### Key derivation

| Step | Definition |
|---|---|
| Password | The UTF-8 bytes of the password after Unicode NFC normalisation. It is not trimmed. |
| Master secret | `Argon2id(password, salt, m, t, p)`, version 0x13, 32 bytes. Defaults: `m` = 65 536 KiB (64 MiB), `t` = 3, `p` = 1, 16-byte salt. |
| Key-encryption key | `HKDF-SHA-256(ikm = master, salt = empty, info = "kth-backup-kek-v1", 32)` |
| File key | 32 random bytes, generated per file. |
| Wrapped key | `AES-256-GCM(key = KEK, nonce = slot.nonce, plaintext = file key, aad = "kth-backup-slot-v1" ‖ SHA-256(preamble))`; 32 bytes of ciphertext plus the 16-byte tag = 48 bytes. |
| Stream key | `HKDF-SHA-256(ikm = file key, salt = streamSalt, info = "kth-backup-stream-v1", 32)` |
| Key check | `HKDF-SHA-256(ikm = file key, salt = streamSalt, info = "kth-backup-commit-v1", 32)`, stored as `keyCheck` |

**Parameter bounds.** A reader rejects `m` below 19 456 KiB (19 MiB) or above 1 048 576 KiB (1 GiB), `t` below 2 or above 10, `p` outside 1 to 4, and a salt shorter than 16 or longer than 64 bytes. The floor is the current minimum recommendation for Argon2id; the ceiling stops a crafted file from making the app allocate unbounded memory.

`keyCheck` commits the file to one key: AES-GCM does not, so without it a crafted file with several slots could hold slots that unwrap *different* keys and show different plaintexts to different passwords. A reader compares it (in constant time) with the key each slot unwraps and treats a mismatch as a failed slot.

A random file key wrapped in key slots is what lets other ways of unlocking a file be added later (another key, a recovery code) without changing the format: a new slot type wraps the same file key.

### Segments

The plaintext is cut into segments of exactly `segmentSize` bytes; the last segment holds 0 to `segmentSize` bytes. Each segment is encrypted separately and stored as ciphertext followed by its tag, with no length prefix.

- **Nonce** of segment `i`: `noncePrefix (7 bytes) ‖ i as u32 big-endian (4 bytes) ‖ last flag (1 byte: 1 for the last segment, otherwise 0)` - 12 bytes.
- **AAD** of every segment: `SHA-256(preamble ‖ header bytes)`. Any change to the version, the header or the key slots fails the first segment.
- The **last** segment is the one that ends the file, and only that one carries the flag. An empty payload is one 16-byte segment (an empty ciphertext and a tag). A payload that is an exact multiple of `segmentSize` ends with a full segment carrying the flag; there is no extra empty segment.

A reader therefore reads `segmentSize + 16 + 1` bytes ahead: if at least that many are buffered the segment is not the last. This is the construction used by Tink's AES-GCM-HKDF streaming and by age's payload, built from WebCrypto calls; it is not a new primitive.

What it guarantees, each covered by a test: truncation at a segment boundary, dropping the last segment, appending data, reordering or duplicating segments, and splicing a segment in from another file with the same password all fail authentication. A segment's plaintext is released only after its tag verifies, and the first segment is verified before the file is reported as unlocked. **A restore must not write anything until the whole stream has been read**, because only the end of the stream proves it is complete; `readBackupFile` does exactly that.

### Errors a reader distinguishes

| Error | Meaning |
|---|---|
| `NotABackupError` | The magic does not match (or the major version is 0). |
| `NewerFormatError` | Higher major, unknown cipher or payload identifier, no usable password slot, a newer manifest or schema version, or a required section it does not know. |
| `WrongPasswordError` | Every password slot failed to unwrap the file key. (A tampered slot looks the same; it cannot be told apart without the password.) |
| `DamagedError` | Anything else: malformed header, KDF parameters outside the bounds, a failed segment tag after a good unlock, a truncated file, a bad checksum, a section without its key column. |
| `PasswordRequiredError` | The file is encrypted and no password was supplied. |

### Sniffing

`sniff(first bytes)` returns `'bbk'` for the magic, `'zip'` for `PK 03 04` (or `PK 05 06`, an empty archive), otherwise `'unknown'`.

## The payload (a ZIP)

A plain ZIP with fixed, lower-case, POSIX entry names. `manifest.json` is always the first entry, so a reader can plan before it has seen the data.

```
manifest.json                       format, app, schema version, entry list, sections
README.txt                          what this file is
user/<table>.ndjson                 one JSON object per row, columns by name
notes/<relative path>.bn            note files, exactly as stored
notes-history/<relative path>.bak   only when history is included
extensions/<id>/kv.ndjson           an extension's key-value rows
extensions/<id>/db/<name>.sqlite    an extension database it opted in
settings/preferences.json           optional preferences (a section, when a caller supplies them)
modules.json                        installed module ids and versions (information only)
```

### Manifest

```json
{
  "format": "kth-backup",
  "formatVersion": "1.0",
  "minReaderVersion": "1.0",
  "createdAt": "2026-09-26T14:03:11.000Z",
  "app": { "name": "...", "version": "0.1.0", "platform": "desktop-linux" },
  "userSchemaVersion": 1,
  "options": { "includeHistory": false },
  "entries":  [ { "path": "user/user_note.ndjson", "size": 1234, "sha256": "<hex>" } ],
  "sections": [
    { "id": "user.user_note", "kind": "table", "class": "content", "required": false, "count": 412,
      "table": "user_note", "columns": ["note_id", "title", "..."], "paths": ["user/user_note.ndjson"] }
  ]
}
```

- `entries` lists **every** other entry with its size and SHA-256 (lower-case hex). A reader checks all of them, and refuses an entry that is missing, changed or not listed.
- A **section** is a unit the user can choose to restore. `kind` is `table`, `files`, `extKv`, `extDb`, `prefs` or `info`. `class` is `content`, `extension`, `workspace`, `history` or `excluded` (see below). `paths` names the entries it owns.
- The manifest is parsed with the strict JSON parser. Unknown keys are ignored.
- What a section says about itself is checked, and its `class` is taken from this version, never from the file: `table` sections must name a registry table other than `extension_storage` and be called `user.<table>` (once), `files` sections are `notes` and `notes.history`, `extKv` and `extDb` sections carry valid extension ids and database names, and each section's `count` must match its entry. A section of another shape is unknown (skipped, or a refusal when `required`).

### Rows

`user/<table>.ndjson` has one JSON object per line, keys are column names, and the file ends with a newline (an empty table is an empty file). Values are numbers, strings and `null` (a boolean is refused); a key named `__proto__` is refused; a BLOB is `{"$b64": "<base64url>"}`. Nested objects and arrays are not valid column values: JSON columns are stored as text, as in the database.

### ZIP rules

The writer produces stored or deflate entries, sizes and CRCs in the local headers, and a fixed timestamp, so equal input gives equal bytes. The reader refuses: names that are absolute, empty, longer than 512 characters, contain `.` or `..` segments, a backslash, a control character or a drive letter; duplicate names (compared case-insensitively); compression methods other than stored and deflate; entries whose sizes are not declared, exceed their declared size or fall short of it; entries over 1 MiB compressing more than 100:1, and an archive whose overall ratio exceeds 100:1; and more than 512 MiB in an entry, 2 GiB in total, 8 MiB of `manifest.json` or 200 000 entries. Directory entries are ignored. A file whose name Windows cannot store (`:`, reserved device names, trailing dots) is refused when it is written to the notes folder on Windows.

## What a backup holds

Every user table is classified in the [registry](#the-table-registry), and a test fails if a table exists that is not classified.

| Class | What | In a backup |
|---|---|---|
| `content` | Notes, verse links, highlights, cross-references, collections and pins, reading plans and progress, prayers, journal, user data items; the `.bn` note files | Always |
| `extension` | An extension's key-value store (`extension_storage`), and the databases an extension opted in | Key-value data unless the extension opts out; databases only when declared |
| `workspace` | Saved sessions and layouts, keybindings, settings, display options | Yes; restored only when chosen in merge mode |
| `history` | Search and navigation history, command history, `.bak` note history | Only when the backup is made with history |
| `excluded` | Install state, marketplace sources, derived indexes, sync bookkeeping, keychain secrets, extension code, modules themselves | Never |

Modules (Bibles, dictionaries) are listed in `modules.json` but not included: they can be downloaded again.

## Extension data

An extension declares what part of its data is the user's in its manifest (`extension.json`):

```json
"userData": {
  "backup": true,
  "databases": {
    "progress":   { "backup": true },
    "embeddings": { "backup": false }
  }
}
```

- The **key-value store is included by default** (it is small and it is the user's data); `"backup": false` opts out.
- A **database is included only when declared** with `"backup": true`, per name (the name passed to `openDatabase()`), because databases are often indexes or caches. The host copies a consistent snapshot, never the live file.
- **Secrets are never included.**
- `"sync"` (at both levels) is reserved for a future version; it validates and is ignored.
- Data for an extension that is not installed on the restoring machine is restored anyway, keyed by extension id, so installing it later finds its data. No extension code runs during a backup or a restore.

## The table registry

`src/Backup/Registry.ts` describes each user table: its columns, primary key, foreign keys (including logical ones such as `verse_link.source_id`, whose target depends on `source_type`), how two rows are recognised as the same when merging, its class, and row upgraders. `USER_SCHEMA_VERSION` (currently `1`) is the version of these shapes and is recorded in every backup. The desktop database also stores it in `PRAGMA user_version`. Drift tests compare the registry with the schema core ships (`UserDatabase.sql`) and with the desktop's own DDL.

## Restore

Restore is two steps. `inspectBackup(archive, target)` maps a verified backup onto a database and returns a plan with per-section counts, dropped columns, warnings and a dry-run preview of both modes (run inside a transaction that is rolled back). `applyRestore(plan, target, { mode, sections })` then applies the chosen sections. All database work is one transaction: any row that cannot be restored rolls everything back and reports the table and row. Files (notes, extension databases) are written after the transaction commits, and a failure there is reported without undoing it.

**Replace** empties the selected tables and inserts the backup's rows with their original ids. Nothing is left pointing at data that is gone, and the database's own rule is mirrored: a table whose rows belong to an emptied one loses them (links and pins of the old notes; the whole table when every row belongs to it), and a table that merely refers to it has the reference cleared (a highlight stays, without its note). Rows the backup holds for such a table are restored only when that section is selected too, and only those whose parents are part of the restore - a backup row is never attached to a local row that happens to share its id. Rows this machine owns (its `system` settings) stay. Before notes are replaced, the existing notes folder is moved aside, not deleted.

**Merge** adds a backup to a database in use.

- Rows get new local ids, and foreign keys are remapped through the registry; parents are processed before children, and a self-referencing table (notes with a parent note, nested collections) is processed parents-first.
- A row already present is recognised by its table's identity rule and reused, so **merging the same backup twice changes nothing**. Most tables compare all non-key columns after foreign keys are remapped, counting duplicates (a source that held two identical rows keeps two). Tables with a natural key compare that key: reading plans and their days and progress, user data items (the **newer** `modified_date` wins), extension key-value data (the **newer** `updated_at` wins), settings, display options and keybindings (local wins), command history (larger counters win). If a section lacks a column its key needs, that section is skipped and reported, never merged blindly.
- A merge never adds a second default notebook or session, and skips a rolling autosave, stock layout presets, internal settings and the local profile.
- A note file that exists and differs is kept as `<name> (restored YYYY-MM-DD).bn`; a copy with identical content from an earlier merge is reused. Names are compared without regard to case or Unicode form, so on Windows and macOS `Foo.bn` and `foo.bn` are one file and never overwrite each other.
- A child whose parent is not part of the restore is dropped or has the reference cleared, as its table specifies, and the report says how many.

**Schema versions.** A backup with a higher `userSchemaVersion` is refused ("update the app"). An older one passes its rows through the registered upgraders, one per version step. Upgraders run first, so they may rename or add columns; then columns the target does not have are dropped and counted, and columns the backup lacks entirely take their defaults. A section for a table whose key column is missing or repeated is refused as damaged. Table names come only from the registry, never from the file.

## Forward compatibility

| Change | How it is signalled | What an older reader does |
|---|---|---|
| New container layout | Preamble major | Refuses. |
| New cipher, KDF or payload type | New `aead`, `kdf.id`, `payload` | Refuses before running any KDF. |
| New way to unlock (key slot) | New slot `type` | Ignores slots it does not know; uses a password slot if there is one. |
| New optional section (a table, extension data) | A section with `required: false` | Skips it and lists it in the report. |
| Something a reader must understand | `required: true`, or a higher `minReaderVersion` | Refuses. |
| New column | Higher minor of `formatVersion` | Drops the column and reports it. |
| New header or manifest keys | Any | Ignored (the header is still authenticated as a whole). |

"Preserved" applies to data, not to the file: a reader never rewrites a backup.

## Tests and test vectors

- **Known answers** (`src/__tests__/Crypto/`): HKDF-SHA-256 (RFC 5869 A.1 to A.3), AES-256-GCM (the GCM specification's test case 14 and independently generated vectors), Argon2id (the reference implementation's vector for 64 MiB / 2 / 1, and vectors at the default and the floor parameters generated with OpenSSL's Argon2id). They are committed and never regenerated.
- **Golden files** (`src/__tests__/Backup/fixtures/*.bbk`): encrypted files produced with a fixed random source and a fixed password for an empty payload, one byte, one segment minus one, exactly one segment, one segment plus one, three segments, and the default parameters. Every future version must open them, and sealing with the same random source must reproduce them byte for byte. A deliberate change to the writer adds new files; it never overwrites these. The random source used for them (`deterministicRandom`) exists for tests only.
- **Independent builder** (`src/__tests__/Backup/envelopeSpec.ts`): assembles a `.bbk` from this specification using only `node:crypto`, so a mistake that is symmetric (wrong on both the write and the read side) is caught.
- **Fuzzing and review regressions** (`fuzz.test.ts`, `hardening.test.ts`): mutated files must fail with a typed error or open to the original content; hostile manifests, missing keys, deep parent chains, resource limits.
- **Negative tests**: a flipped bit in every region, truncation at and inside segments, appended data, reordered and spliced segments, hostile headers (duplicate keys, wrong sizes, parameters outside the bounds, oversize lengths) that must fail before any key derivation, and hostile ZIP entries.
- **Property tests** (`fast-check`): round trips for lengths clustered on segment boundaries with random chunking; restore and merge over random data graphs (replace reproduces every table; merge into an empty database equals replace apart from ids; merging twice equals merging once; merging never changes an existing row; no reference is left dangling).

## Gotchas

- The `Crypto` and `Backup` namespaces are exported from both `@bible/core` and `@bible/core/browser`. Adding an import of a Node module under `src/Crypto/` or `src/Backup/` fails `browserBarrel.test.ts`.
- `hash-wasm` is imported lazily, so nothing is downloaded or compiled until a password is actually hashed.
- The payload is built in memory before it is encrypted, because the manifest comes first and lists every entry's checksum. Only the encryption layer streams.
- After a code change that adds a table, add it to `USER_TABLES` (or `EXCLUDED_TABLES`) and bump `USER_SCHEMA_VERSION` with a row upgrader if an existing column changed shape.
