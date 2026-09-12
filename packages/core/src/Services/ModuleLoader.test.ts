import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { ModuleLoader } from './ModuleLoader';
import type { ISql } from '../Data/Core/ISql';
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

  const build = (overrides: { fileExists?: (p: string) => boolean } = {}) =>
    new ModuleLoader<{ id: string }>({
      moduleType: 'commentary',
      metadataRepo: { getByAbbreviation } as unknown as IModuleMetadataRepository,
      pathResolver: { resolveModulePath: (p: string) => p },
      sqlFactory: { create: () => ({ close: () => {} }) as unknown as ISql },
      createRepo: () => ({ id: 'repo' }),
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
});
