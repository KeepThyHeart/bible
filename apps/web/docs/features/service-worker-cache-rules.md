# Adding a service-worker cache rule

**Last verified:** 0085-sw-pwa (2026-09-29)

The service worker (`src/sw.ts`) has no route list of its own. What it caches at run time comes from one registry, `src/sw/rules/`. A feature that wants a response cached (or wants to make sure one is never cached) adds a **rule**; it does not edit `sw.ts`. See [pwa-offline.md](pwa-offline.md) for the rest of the PWA.

## Files

| File | Role |
|---|---|
| `src/sw/cacheRules.ts` | `CacheRule` type, `cacheRuleFor()` (the one decision point), `validateRules()`, cache-name and reset helpers. Pure, no workbox, used by the worker, the page and the tests |
| `src/sw/rules/index.ts` | `CACHE_RULES`, the ordered list. First match wins |
| `src/sw/rules/network.ts` | Explicit `network-only` rules (`/api/sync`, auth). Listed first so they cannot be overridden |
| `src/sw/rules/content.ts`, `data.ts` | The built-in rules (chapter content under `/api/`, models and indexes under `/data/`) |
| `src/sw/rules/timeline.ts` | `/api/timeline` (the installed timeline module as one JSON document), cache-first, 7 days |
| `src/sw/cacheRules.test.ts` | Validates the whole registry; add your rule's cases here |

## Add a rule

1. Create `src/sw/rules/<feature>.ts` exporting a `CacheRule[]`, and spread it into `CACHE_RULES` in `rules/index.ts`.
2. Write the rule:

```ts
import type { CacheRule } from '../cacheRules';

export const AUDIO_RULES: CacheRule[] = [
  {
    id: 'audio-v1',                  // unique, kebab-case
    owner: 'audio',                  // documentation only
    strategy: 'cache-first-range',   // see below
    pattern: /^\/audio\/v1\//,       // tested against pathname + search
    cacheName: 'audio',              // stored as `audio-v1`, see "Versions"
    version: 1,
    statuses: [200],
    maxEntries: 500,
    keepOnReset: true,               // big and immutable: "Reset app cache" keeps it
  },
];
```

3. Add a case to `cacheRules.test.ts`. `validateRules(CACHE_RULES)` runs in that test and rejects the mistakes below, so a bad rule fails CI rather than shipping.

## Strategies

| Strategy | Behaviour |
|---|---|
| `network-only` | Never stored, never served from cache. Use it to carve an exception out of a broader rule |
| `cache-first` | Cache hit wins; a miss fetches, stores (only `statuses`) and returns |
| `cache-first-range` | As `cache-first`, and a `Range` request is answered by slicing a cached full (200) response, so audio and video can seek offline. A miss goes to the network and is **not** stored: the network answers a range with a 206, which the Cache API refuses. Populate the cache with a full fetch (an explicit pack download does `cache.put`), not by playback |

Only same-origin `GET` requests reach a rule. Anything with no rule goes straight to the network.

## Safety rules (enforced, not just documented)

- **API routes are never cached by default.** A pattern that can match `/api/` must set `allowApi: true`, and at run time `cacheRuleFor` refuses to cache an `/api/` request for a rule without it. The list of cached API routes is therefore an explicit allow-list you can grep for.
- **`/api/sync` and auth routes are never cached**, by any rule. `NEVER_CACHE_PATHS` is checked both at validation (a pattern matching one fails) and at run time.
- Never list `401` or `403` in `statuses`.
- Patterns are matched against `pathname + search`, so end a pattern with `(\?|$)`, not a bare `$`, or it silently misses requests with a query string (validation flags this). No `g` or `y` flag.
- One cache name per rule.

## Versions and cleanup

The cache used is `<cacheName>-v<version>`. Bump `version` to abandon everything stored under the old name (a changed response format, say). On activation the worker deletes **every** cache that is not: one of the current rules' caches, the precache, or `transformers-cache` (written by the search worker, not ours). So a renamed, removed or re-versioned rule cleans itself up on the next worker update; nothing accumulates.

## "Reset app cache" and `keepOnReset`

Settings > About > **Reset app cache** unregisters the worker, deletes Cache Storage entries and reloads (`resetAppCache()` in `src/utils/appUpdate.ts`). It does not touch OPFS module downloads, settings or user data. Caches of rules with `keepOnReset: true` survive it, as does `transformers-cache`, because re-downloading a ~130 MB model to fix a stale shell is worse than the stale shell. Use `keepOnReset` only for large, immutable content whose staleness is handled by `version`. A hidden `resetAppCache({ includeLarge: true })` exists for a full wipe.

`public/sw-kill.js` keeps the same list in a plain-JS `KEEP_CACHES` array (it cannot import). A unit test fails if the two drift; when you add a `keepOnReset` rule, update that array.

## Checklist for a new feature

- Is the response the same for every reader? If not, do not cache it (or `network-only` it).
- Is the route under `/api/`? Then `allowApi: true`, and think about logout: a cached 200 outlives the session.
- Does it need range support? `cache-first-range`, and plan how the cache gets filled.
- Is it large? `keepOnReset`, and a `maxEntries`.
