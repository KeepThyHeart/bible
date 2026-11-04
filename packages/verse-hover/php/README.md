# verse-hover PHP backend

`verse-hover.php` is one file with no dependencies (PHP 7.4+). It serves verses over HTTP, and from the
command line it generates the static data files and slim databases. Databases are opened read-only
through PDO sqlite or the `SQLite3` class (whichever exists; force one with the env var `VH_DRIVER=pdo|sqlite3`).

## PHP mode (dynamic API)

1. Put `verse-hover.php` and your Bible module `.db` file(s) on the server. Prefer keeping the `.db` outside the web root.
2. Either leave the `.db` next to the script (auto-discovery by `module_info.abbreviation`, cached in `verse-hover.cache.php`) or copy `verse-hover.config.sample.php` to `verse-hover.config.php` and list the translations.
3. Request: `verse-hover.php?t=KJV&r=43003014-43003018,45005008`, `?t=KJV&k=43003` (a chapter), `?t=KJV&m=1` (manifest), `?list=1`.

Verse ids are `book*1000000 + chapter*1000 + verse`. Limits: 50 ranges, 500 verses per request. A range crossing a chapter boundary returns one slice per chapter. Errors are `{"error":"..."}` with status 400, 404, 405 or 413.

If the `.db` lives under the web root, deny it:

```apache
# .htaccess
<FilesMatch "\.(db|sqlite)$">
  Require all denied
</FilesMatch>
```

```nginx
location ~* \.(db|sqlite)$ { deny all; }
```

## Static mode (no PHP at runtime)

```
php verse-hover.php build-static --db=bible_kjv.db --out=bible-data [--gzip] [--no-plain] [--no-formatting] [--force-license]
node scripts/build-static.mjs   --db=bible_kjv.db --out=bible-data [same flags]
```

Writes `bible-data/index.json`, `bible-data/KJV/manifest.json` and `bible-data/KJV/<book>/<chapter>.json` (plus `.json.gz` with `--gzip`; `--no-plain` needs `--gzip`). `index.json` is merged with an existing one. The PHP and Node generators produce identical JSON files (gzip bytes can differ between zlib builds; the decompressed content is identical). Serve `.json.gz` files with `Content-Encoding: gzip` if you precompress.

## Other CLI commands

```
php verse-hover.php slim --db=bible_kjv.db --out=slim.db [--no-formatting]   # only verse_id, text, formatting + module_info
php verse-hover.php info --db=bible_kjv.db                                   # abbreviation, name, license, verse count
```

CLI commands only run when `PHP_SAPI` is `cli`; over HTTP they are unreachable.

## License guard

`build-static` refuses (exit 2, message on stderr) unless `module_info.license_spdx` looks public domain or open. A case-insensitive whole-token match is made against: `public domain`, `pd`, `cc0`, `cc-by-4.0`, `cc-by-sa`, `gpl`, `lgpl`, `mit`, `apache`, `unlicense`, `cc-by-3.0`. Any `NC` clause (e.g. `CC-BY-NC-4.0`) and an empty or missing license are refused first. `--force-license` overrides it; use it only if you have the right to publish the text. The Node twin uses identical logic.

## Security notes

- The translation to path mapping comes only from config or discovery; request values are validated (`t`: `^[A-Za-z0-9_-]{1,16}$`, numeric `r`/`k`) and used only in prepared statements.
- GET and OPTIONS only; responses carry `X-Content-Type-Options: nosniff`, CORS `*` unless `allowed_origins` is set, ETag (304 supported) and `Cache-Control: public`.
- PHP errors are never echoed; failures return a generic 500 JSON.
- Do not expose the `.db` files or `verse-hover.cache.php` to the web (see snippets above).

## Tests

```
php php/tests/run.php --both          # both sqlite drivers
npx vitest run test/conformance.test.ts
node test/fixtures/make-mini-db.mjs   # rebuild the fixtures from a full bible module
```
