import { describe, it, expect, vi } from 'vitest';
import { KeywordIndexRegistry } from './KeywordIndexRegistry';
import { IKeywordIndexProvider, RuntimeEnvironment } from './IKeywordIndexProvider';
import {
  IndexTarget,
  IKeywordIndex,
  KeywordQuery,
  KeywordSearchOptions,
  KeywordSearchResponse,
} from './KeywordTypes';
import { KeywordCapability } from './Capabilities';

const ENV: RuntimeEnvironment = {
  runtime: 'node-server',
  sqlite: { fts5: true, writableModules: true },
  codecs: new Set(['none']),
  indexDir: null,
};

const QUERY: KeywordQuery = { kind: 'terms', terms: ['love'], all: true };

function target(moduleUuid: string): IndexTarget {
  return { moduleUuid, moduleType: 'bible', contentSha256: `sha-${moduleUuid}` };
}

/** A fake `IKeywordIndex` that returns one hit per target it was given. */
function makeFakeIndex(
  providerId: string,
  opts: { throwOnSearch?: boolean; truncated?: boolean } = {}
): IKeywordIndex & { closed: boolean } {
  const fake = {
    providerId,
    capability: { state: 'ready', providerId, supports: {
      phrase: true, prefix: true, near: true, booleanOps: true, rank: true, snippetFromIndex: false,
    } } as KeywordCapability,
    closed: false,
    async search(_q: KeywordQuery, o: KeywordSearchOptions): Promise<KeywordSearchResponse> {
      if (opts.throwOnSearch) {
        throw new Error(`${providerId} search failed`);
      }
      return {
        hits: o.targets.map((t, i) => ({ target: t, rowId: i, rank: 1 })),
        skipped: [],
        truncated: opts.truncated ?? false,
      };
    },
    close(): void {
      fake.closed = true;
    },
  };
  return fake;
}

/** A minimal, in-memory fake provider for tests. Never touches FTS5. */
function makeFakeProvider(
  id: string,
  opts: {
    supportsFn?: (t: IndexTarget) => boolean;
    throwOnOpen?: boolean;
    throwOnSearch?: boolean;
    truncated?: boolean;
  } = {}
): IKeywordIndexProvider & { openCalls: IndexTarget[][]; lastIndex: ReturnType<typeof makeFakeIndex> | null } {
  const provider = {
    id,
    openCalls: [] as IndexTarget[][],
    lastIndex: null as ReturnType<typeof makeFakeIndex> | null,
    supports(t: IndexTarget): boolean {
      return opts.supportsFn ? opts.supportsFn(t) : true;
    },
    async status(_t: IndexTarget): Promise<KeywordCapability> {
      return { state: 'ready', providerId: id, supports: {
        phrase: true, prefix: true, near: true, booleanOps: true, rank: true, snippetFromIndex: false,
      } };
    },
    async open(targets: IndexTarget[]): Promise<IKeywordIndex> {
      provider.openCalls.push(targets);
      if (opts.throwOnOpen) {
        throw new Error(`${id} open failed`);
      }
      const index = makeFakeIndex(id, { throwOnSearch: opts.throwOnSearch, truncated: opts.truncated });
      provider.lastIndex = index;
      return index;
    },
    async build(): Promise<void> {
      // not exercised in these tests
    },
    async prune(): Promise<void> {},
    async pruneExcept(): Promise<void> {},
  };
  return provider;
}

describe('KeywordIndexRegistry', () => {
  describe('providerFor / registration order', () => {
    it('picks the first-registered provider among several that support a target', () => {
      const registry = new KeywordIndexRegistry(ENV);
      const first = makeFakeProvider('first');
      const second = makeFakeProvider('second');
      registry.register(first);
      registry.register(second);

      expect(registry.providerFor(target('m1'))).toBe(first);
    });

    it("register()'s unregister function removes exactly that provider", () => {
      const registry = new KeywordIndexRegistry(ENV);
      const onlyThisOne = makeFakeProvider('only', {
        supportsFn: (t) => t.moduleUuid === 'special',
      });
      const unregister = registry.register(onlyThisOne);

      expect(registry.providerFor(target('special'))).toBe(onlyThisOne);
      unregister();
      expect(registry.providerFor(target('special'))).toBeNull();
    });
  });

  describe('search() grouping', () => {
    it('opens each provider exactly once, with its whole group of targets', async () => {
      const registry = new KeywordIndexRegistry(ENV);
      const providerA = makeFakeProvider('a', {
        supportsFn: (t) => t.moduleUuid.startsWith('a'),
      });
      const providerB = makeFakeProvider('b', {
        supportsFn: (t) => t.moduleUuid.startsWith('b'),
      });
      registry.register(providerA);
      registry.register(providerB);

      const targets = [target('a1'), target('a2'), target('b1')];
      const response = await registry.search(QUERY, { targets });

      expect(providerA.openCalls).toHaveLength(1);
      expect(providerA.openCalls[0]).toEqual([target('a1'), target('a2')]);
      expect(providerB.openCalls).toHaveLength(1);
      expect(providerB.openCalls[0]).toEqual([target('b1')]);
      expect(response.hits).toHaveLength(3);
      expect(response.skipped).toHaveLength(0);
    });

    it('closes each opened index once its search is done', async () => {
      const registry = new KeywordIndexRegistry(ENV);
      const provider = makeFakeProvider('a');
      registry.register(provider);

      await registry.search(QUERY, { targets: [target('a1')] });

      expect(provider.lastIndex?.closed).toBe(true);
    });
  });

  describe('skip collection', () => {
    it('skips a target with no matching provider, but still returns hits for the rest', async () => {
      const registry = new KeywordIndexRegistry(ENV);
      const provider = makeFakeProvider('a', {
        supportsFn: (t) => t.moduleUuid === 'has-provider',
      });
      registry.register(provider);

      const targets = [target('has-provider'), target('no-provider')];
      const response = await registry.search(QUERY, { targets });

      expect(response.hits).toHaveLength(1);
      expect(response.hits[0].target).toEqual(target('has-provider'));
      expect(response.skipped).toEqual([
        { target: target('no-provider'), reason: { state: 'unavailable', reason: 'no-provider' } },
      ]);
    });
  });

  describe('empty-target fan-out', () => {
    it('returns empty results without throwing and without calling any provider', async () => {
      const registry = new KeywordIndexRegistry(ENV);
      const provider = makeFakeProvider('a');
      const openSpy = vi.spyOn(provider, 'open');
      registry.register(provider);

      const response = await registry.search(QUERY, { targets: [] });

      expect(response).toEqual({ hits: [], skipped: [], truncated: false });
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  describe('a provider that throws', () => {
    it('open() throwing: its targets are skipped, other providers still return hits', async () => {
      const registry = new KeywordIndexRegistry(ENV);
      const throwing = makeFakeProvider('throws', {
        supportsFn: (t) => t.moduleUuid === 'bad',
        throwOnOpen: true,
      });
      const good = makeFakeProvider('good', {
        supportsFn: (t) => t.moduleUuid === 'good',
      });
      registry.register(throwing);
      registry.register(good);

      const targets = [target('bad'), target('good')];
      const response = await registry.search(QUERY, { targets });

      expect(response.hits).toHaveLength(1);
      expect(response.hits[0].target).toEqual(target('good'));
      expect(response.skipped).toEqual([
        { target: target('bad'), reason: { state: 'unavailable', reason: 'no-provider' } },
      ]);
    });

    it('search() throwing: its targets are skipped, other providers still return hits', async () => {
      const registry = new KeywordIndexRegistry(ENV);
      const throwing = makeFakeProvider('throws', {
        supportsFn: (t) => t.moduleUuid === 'bad',
        throwOnSearch: true,
      });
      const good = makeFakeProvider('good', {
        supportsFn: (t) => t.moduleUuid === 'good',
      });
      registry.register(throwing);
      registry.register(good);

      const targets = [target('bad'), target('good')];
      const response = await registry.search(QUERY, { targets });

      expect(response.hits).toHaveLength(1);
      expect(response.hits[0].target).toEqual(target('good'));
      expect(response.skipped).toEqual([
        { target: target('bad'), reason: { state: 'unavailable', reason: 'no-provider' } },
      ]);
    });
  });

  describe('status()', () => {
    it('returns one entry per target, keyed correctly, with no-provider targets reported unavailable', async () => {
      const registry = new KeywordIndexRegistry(ENV);
      const provider = makeFakeProvider('a', {
        supportsFn: (t) => t.moduleUuid === 'has-provider',
      });
      registry.register(provider);

      const t1 = target('has-provider');
      const t2 = target('no-provider');
      const result = await registry.status([t1, t2]);

      expect(result.size).toBe(2);
      expect(result.get(`${t1.moduleUuid}:${t1.contentSha256}`)).toEqual({
        state: 'ready', providerId: 'a', supports: {
          phrase: true, prefix: true, near: true, booleanOps: true, rank: true, snippetFromIndex: false,
        },
      });
      expect(result.get(`${t2.moduleUuid}:${t2.contentSha256}`)).toEqual({
        state: 'unavailable', reason: 'no-provider',
      });
    });
  });
});
