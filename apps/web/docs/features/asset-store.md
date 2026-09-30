# Asset store hosting

Large optional downloads (speech runtime and voices, data files) are served read-only from `/assets/v1`.
No feature flag: an empty or missing directory just answers 404.

## Where files go

Directory: `<data dir>/assets` (override with `assets.dir` in `site.json`, relative to the data directory).

```
v1/index.json                                  generated catalogue
v1/<kind>/<id>/<version>/asset.json            {title, description, license, licenseUrl, languages, meta}
v1/<kind>/<id>/<version>/<path...>             the files
v1/<kind>/<id>/<version>/<path...>.sha256      generated digest sidecar
```

`license` in `asset.json` is required; an asset without one is not published.

## Publish

```
node scripts/build-asset-index.mjs            # writes sidecars and v1/index.json
node scripts/build-asset-index.mjs --check    # writes nothing; exit 1 when stale (CI)
node scripts/build-asset-index.mjs --dir=/srv/bible/data/assets
```

Only the newest version of each id is listed. Files are immutable once published: add a new version
directory instead of changing one.

## Piper (speech)

Piper files stay under `<data dir>/audio/tts/piper`. `scripts/fetch-piper-assets.mjs` now also writes
sidecars and `tts/piper/index.json` (same schema, urls relative to that file).
`--index-only` rebuilds them from the files on disk without any download.

## Serving notes

Range, ETag and `Cache-Control: immutable` come from `express.static`; responses are `no-transform` so the
gzip middleware leaves them alone. Only `/assets/v1/...` is claimed: the client build's own bundles also
live under `/assets/` and fall through to the normal static handler. The Content-Security-Policy is unchanged
(same origin). Like `/audio`, the route sits behind the password gate.

## Known limits

- The web store keys files by URL, so a same-URL upgrade overwrites the bytes at file commit, before the
  registry is saved. An upgrade interrupted exactly then could leave v1 metadata over v2 bytes; the next
  install re-verifies the file by hash and repairs it.
- The service worker rule `asset-store` may store full 200 responses from plain fetches that the manager never
  registered. The browser quota counts them, the registry does not. Remove of an asset deletes its URLs anyway.
- Web installs and adopted Piper files are pinned, so automatic eviction mainly matters for unpinned consumers
  (0070/0074) and for desktop.
