import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { ModuleLoader, type ModuleConnectionFactory } from './ModuleLoader';
import type { IModuleConnection, IModuleStore, ModuleLocator } from '../Data/Access/ModuleStore';
import type { IModuleMetadataRepository } from '../Data/Repositories/IModuleMetadataRepository';

/**
 * A missing module used to cost a metadata lookup, a `fileExists` stat and a
 * log line on *every* call. Callers ask per rendered item, so one uninstalled
 * commentary filled the log faster than it could be read. These cover the memo
 * that stops that, and the two ways out of it.
 */
describe('ModuleLoader failure memoization', () => {
  const dbPath = 'modules/commentary_synthesis.db';

  let getByAbbreviation: Mock;
  let fileExists: Mock;
  let logger: { error: Mock };

  /** A minimal fake IModuleStore: `open()` never actually touches disk. */
  const fakeStore: IModuleStore = {
    id: 'fake',
    extensions: ['.db'],
    canOpen: () => true,
    open: (loc: ModuleLocator): IModuleConnection => ({
      locator: loc,
      writable: false,
      close: () => {},
    }),
  };

  const fakeFactory: ModuleConnectionFactory<{ id: string }> = {
    create: () => ({ id: 'repo' }),
  };

  const build = (overrides: { fileExists?: (p: string) => boolean } = {}) =>
    new ModuleLoader<{ id: string }>({
      moduleType: 'commentary',
      metadataRepo: { getByAbbreviation } as unknown as IModuleMetadataRepository,
      pathResolver: { resolveModulePath: (p: string) => p },
      store: fakeStore,
      factory: fakeFactory,
      fileExists: overrides.fileExists ?? (fileExists as unknown as (p: string) => boolean),
      logger,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    getByAbbreviation = vi.fn().mockReturnValue({ moduleType: 'commentary', databasePath: dbPath });
    fileExists = vi.fn().mockReturnValue(false);
    logger = { error: vi.fn() };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs a missing database once no matter how many callers ask', () => {
    const loader = build();

    for (let i = 0; i < 50; i++) {
      expect(loader.get('SYNTHESIS')).toBeNull();
    }

    expect(logger.error).toHaveBeenCalledTimes(1);
    // The lookup and the stat are skipped too, not just the log line.
    expect(getByAbbreviation).toHaveBeenCalledTimes(1);
    expect(fileExists).toHaveBeenCalledTimes(1);
  });

  it('keeps each module distinct', () => {
    const loader = build();

    loader.get('SYNTHESIS');
    loader.get('MHC');

    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('retries once the failure window has passed', () => {
    const loader = build();

    loader.get('SYNTHESIS');
    expect(fileExists).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(29_000);
    loader.get('SYNTHESIS');
    expect(fileExists).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    loader.get('SYNTHESIS');
    expect(fileExists).toHaveBeenCalledTimes(2);
  });

  it('picks the module up on the retry once its file appears', () => {
    let present = false;
    const loader = build({ fileExists: () => present });

    expect(loader.get('SYNTHESIS')).toBeNull();

    present = true;
    vi.advanceTimersByTime(31_000);

    expect(loader.get('SYNTHESIS')).toEqual({ id: 'repo' });
  });

  it('forgets the miss immediately on evict, so a reinstall is not delayed', () => {
    let present = false;
    const loader = build({ fileExists: () => present });

    expect(loader.get('SYNTHESIS')).toBeNull();

    present = true;
    loader.evict('SYNTHESIS');

    expect(loader.get('SYNTHESIS')).toEqual({ id: 'repo' });
  });

  // The same memoization applies to `ensure()` (task 0034) - it shares the
  // same `resolveLoadablePath` check `get()` uses.
  it('also memoizes a missing module through ensure()', async () => {
    const loader = build();

    for (let i = 0; i < 5; i++) {
      expect(await loader.ensure('SYNTHESIS')).toBeNull();
    }

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(getByAbbreviation).toHaveBeenCalledTimes(1);
  });
});

/**
 * Task 0026 (revision 2) subtask M11: ModuleLoader's constructor now takes a
 * store plus a factory instead of a raw SQL-provider factory and a
 * `createRepo` callback, and an explicit `readonly`. These cover the new
 * construction seam itself - the failure-memoization suite above already
 * covers the caching/retry behaviour that seam does not change.
 */
describe('ModuleLoader store/factory wiring (M11)', () => {
  const dbPath = 'modules/commentary_synthesis.db';
  let getByAbbreviation: Mock;

  beforeEach(() => {
    getByAbbreviation = vi.fn().mockReturnValue({ moduleType: 'commentary', databasePath: dbPath });
  });

  const buildWith = (opts: {
    readonly?: boolean;
    openSpy?: Mock;
    closeSpy?: Mock;
    create?: (conn: IModuleConnection) => { id: string } | null;
  }) => {
    const closeSpy = opts.closeSpy ?? vi.fn();
    const openSpy =
      opts.openSpy ??
      vi.fn((loc: ModuleLocator, openOpts: { readonly: boolean }): IModuleConnection => ({
        locator: loc,
        writable: !openOpts.readonly,
        close: closeSpy,
      }));
    const store: IModuleStore = {
      id: 'fake',
      extensions: ['.db'],
      canOpen: () => true,
      open: openSpy as unknown as IModuleStore['open'],
    };
    const factory: ModuleConnectionFactory<{ id: string }> = {
      create: opts.create ?? (() => ({ id: 'repo' })),
    };
    const loader = new ModuleLoader<{ id: string }>({
      moduleType: 'commentary',
      metadataRepo: { getByAbbreviation } as unknown as IModuleMetadataRepository,
      pathResolver: { resolveModulePath: (p: string) => p },
      store,
      factory,
      readonly: opts.readonly,
    });
    return { loader, openSpy, closeSpy };
  };

  it('defaults to opening connections read-only', () => {
    const { loader, openSpy } = buildWith({});
    loader.get('SYNTHESIS');
    expect(openSpy).toHaveBeenCalledWith({ kind: 'file', path: dbPath }, { readonly: true });
  });

  it('opens read-write when `readonly: false` is passed explicitly', () => {
    const { loader, openSpy } = buildWith({ readonly: false });
    loader.get('SYNTHESIS');
    expect(openSpy).toHaveBeenCalledWith({ kind: 'file', path: dbPath }, { readonly: false });
  });

  it('returns the repository the factory builds from the open connection', () => {
    const { loader } = buildWith({});
    expect(loader.get('SYNTHESIS')).toEqual({ id: 'repo' });
  });

  it('closes the connection (not just drops the repo) on evict', () => {
    const { loader, closeSpy } = buildWith({});
    loader.get('SYNTHESIS');
    loader.evict('SYNTHESIS');
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('closes every open connection on closeAll', () => {
    const { loader, closeSpy } = buildWith({});
    loader.get('SYNTHESIS');
    loader.closeAll();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('closes the connection and reports failure when the factory returns null for it', () => {
    const closeSpy = vi.fn();
    const { loader } = buildWith({ closeSpy, create: () => null });
    expect(loader.get('SYNTHESIS')).toBeNull();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * Task 0034 (async-readiness prerequisite, 0029 design doc §04 S3b):
 * `IModuleStore.open()` may now return `IModuleConnection | Promise<IModuleConnection>`.
 *
 * `get()` keeps its original, pre-0034 contract (synchronous, loads on a
 * miss) for every store whose `open()` resolves synchronously - which is
 * every store this codebase ships, so no existing caller had to change.
 * `ensure()` is the one addition: it always works, awaiting when `open()`
 * returns a `Promise` - the one case `get()` cannot service on its own.
 */
describe('ModuleLoader ensure()/get() (task 0034)', () => {
  const dbPath = 'modules/commentary_synthesis.db';
  let getByAbbreviation: Mock;

  beforeEach(() => {
    getByAbbreviation = vi.fn().mockReturnValue({ moduleType: 'commentary', databasePath: dbPath });
  });

  const buildAsyncStore = () => {
    const store: IModuleStore = {
      id: 'fake-async',
      extensions: ['.db'],
      canOpen: () => true,
      open: (loc: ModuleLocator): Promise<IModuleConnection> =>
        Promise.resolve({ locator: loc, writable: false, close: () => {} }),
    };
    const factory: ModuleConnectionFactory<{ id: string }> = {
      create: () => ({ id: 'repo' }),
    };
    return new ModuleLoader<{ id: string }>({
      moduleType: 'commentary',
      metadataRepo: { getByAbbreviation } as unknown as IModuleMetadataRepository,
      pathResolver: { resolveModulePath: (p: string) => p },
      store,
      factory,
    });
  };

  it('get() still loads synchronously on a miss - unchanged pre-0034 behaviour', () => {
    const store: IModuleStore = {
      id: 'fake',
      extensions: ['.db'],
      canOpen: () => true,
      open: (loc: ModuleLocator): IModuleConnection => ({ locator: loc, writable: false, close: () => {} }),
    };
    const factory: ModuleConnectionFactory<{ id: string }> = { create: () => ({ id: 'repo' }) };
    const loader = new ModuleLoader<{ id: string }>({
      moduleType: 'commentary',
      metadataRepo: { getByAbbreviation } as unknown as IModuleMetadataRepository,
      pathResolver: { resolveModulePath: (p: string) => p },
      store,
      factory,
    });

    expect(loader.get('SYNTHESIS')).toEqual({ id: 'repo' });
  });

  it('ensure() awaits a store whose open() returns a Promise', async () => {
    const loader = buildAsyncStore();
    await expect(loader.ensure('SYNTHESIS')).resolves.toEqual({ id: 'repo' });
    // Cached now, so a plain get() sees it without touching the store again.
    expect(loader.get('SYNTHESIS')).toEqual({ id: 'repo' });
  });

  it('get() cannot service an async store on its own - returns null without recording a failure', async () => {
    const loader = buildAsyncStore();

    expect(loader.get('SYNTHESIS')).toBeNull();

    // Not treated as a failure: ensure() against the same abbreviation still succeeds.
    await expect(loader.ensure('SYNTHESIS')).resolves.toEqual({ id: 'repo' });
  });

  it('ensure() on an already-cached module resolves without re-opening', async () => {
    const openSpy = vi.fn((loc: ModuleLocator): IModuleConnection => ({
      locator: loc,
      writable: false,
      close: () => {},
    }));
    const store: IModuleStore = { id: 'fake', extensions: ['.db'], canOpen: () => true, open: openSpy };
    const factory: ModuleConnectionFactory<{ id: string }> = { create: () => ({ id: 'repo' }) };
    const loader = new ModuleLoader<{ id: string }>({
      moduleType: 'commentary',
      metadataRepo: { getByAbbreviation } as unknown as IModuleMetadataRepository,
      pathResolver: { resolveModulePath: (p: string) => p },
      store,
      factory,
    });

    await loader.ensure('SYNTHESIS');
    await loader.ensure('SYNTHESIS');
    expect(openSpy).toHaveBeenCalledTimes(1);
  });
});
