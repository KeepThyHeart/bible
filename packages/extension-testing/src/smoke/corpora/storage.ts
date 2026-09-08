/**
 * Default storage corpus for smoke testing.
 *
 * These fixtures describe KV states the harness can project into a mock
 * `api.storage` before invoking a hook. They are not themselves inputs to
 * hooks — item 3 will use them as harness *mode* configurations. The corpus
 * is exposed here so `getDefaultCorpus('storage')` returns a non-empty
 * array (the doc requires storage coverage) and so user corpora can add
 * custom states via the same merge path.
 */

export interface StorageStateFixture {
  id: string;
  description: string;
  /** Pre-populated KV entries. Keys and string-serialized values. */
  entries: ReadonlyArray<readonly [key: string, value: string]>;
  /** Harness-enforced quota in bytes. `undefined` means no quota. */
  quotaBytes?: number;
  /** An oversized pending value the hook may attempt to write. */
  oversizedWrite?: { key: string; value: string };
}

const repeat = (ch: string, n: number): string => {
  let s = '';
  for (let i = 0; i < n; i++) s += ch;
  return s;
};

export const DEFAULT_STORAGE_CORPUS: readonly StorageStateFixture[] = Object.freeze([
  {
    id: 'empty',
    description: 'No prior state — fresh install.',
    entries: [],
  },
  {
    id: 'small-populated',
    description: 'A handful of typical user-settings values.',
    entries: [
      ['settings.theme', '"sepia"'],
      ['settings.fontSize', '18'],
      ['lastVerse', '43003016'],
      ['ui.sidebarOpen', 'true'],
    ],
  },
  {
    id: 'near-quota',
    description: 'Storage is 95% full — next write should pressure quota logic.',
    entries: [
      ['bulk.history', JSON.stringify({ entries: Array.from({ length: 200 }, (_, i) => `v${i}`) })],
      ['bulk.cache', repeat('x', 80 * 1024)],
    ],
    quotaBytes: 100 * 1024,
  },
  {
    id: 'oversized-write',
    description: 'Hook attempts to write a single value exceeding the quota.',
    entries: [],
    quotaBytes: 64 * 1024,
    oversizedWrite: {
      key: 'bulk.payload',
      value: repeat('A', 128 * 1024),
    },
  },
  {
    id: 'unicode-keys',
    description: 'KV with non-ASCII keys and values.',
    entries: [
      ['settings.\u4e2d\u6587', '"\u4eba\u751f"'],
      ['emoji.key', '"value"'],
    ],
  },
  {
    id: 'malformed-values',
    description: 'Corrupted JSON / non-JSON string values — hooks must not crash on read.',
    entries: [
      ['settings.theme', '{not json'],
      ['lastVerse', 'NaN'],
      ['ui.flags', ''],
    ],
  },
]);
