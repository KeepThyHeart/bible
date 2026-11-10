import { describe, it, expect, vi } from 'vitest';
import { missingModuleError, dedupeMissingModuleLogs, type DiagnosableLoader } from '../moduleErrors';

vi.mock('electron-log', () => ({ default: { warn: vi.fn(), error: vi.fn() } }));

const loaderWith = (status: 'ok' | 'no_metadata' | 'file_missing', databasePath?: string): DiagnosableLoader => ({
  diagnose: () => ({ status, databasePath }),
});

describe('missingModuleError', () => {
  it('metadata row present + file absent -> module_missing naming the module and path', () => {
    const e = missingModuleError(loaderWith('file_missing', '/m/wes.db'), 'WES', 'Commentary not found: WES');
    expect(e.code).toBe('module_missing');
    expect(e.message).toContain('WES');
    expect(e.message).toContain('/m/wes.db');
  });

  it('no metadata row -> not_found with the caller message', () => {
    const e = missingModuleError(loaderWith('no_metadata'), 'WES', 'Commentary not found: WES');
    expect(e.code).toBe('not_found');
    expect(e.message).toBe('Commentary not found: WES');
  });

  it('file present but load failed (ok) stays not_found', () => {
    expect(missingModuleError(loaderWith('ok', '/m/x.db'), 'X', 'nf').code).toBe('not_found');
  });
});

describe('dedupeMissingModuleLogs', () => {
  it('logs "Database not found" once per distinct message, passes others through', () => {
    const error = vi.fn();
    const l = dedupeMissingModuleLogs({ error });
    for (let i = 0; i < 40; i++) l.error('[ModuleLoader:commentary] Database not found: /m/wes.db');
    l.error('[ModuleLoader:commentary] Database not found: /m/other.db');
    l.error('[ModuleLoader:commentary] Failed to load X:', new Error('corrupt'));
    l.error('[ModuleLoader:commentary] Failed to load X:', new Error('corrupt'));
    expect(error).toHaveBeenCalledTimes(4);
  });
});
