import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IpcResultError } from './ipcResult';
import { isModuleUnavailableError, logModuleErrorOnce, resetModuleErrorLog } from './moduleErrorLog';

describe('moduleErrorLog', () => {
  beforeEach(() => resetModuleErrorLog());
  afterEach(() => vi.restoreAllMocks());

  it('only module_missing is "module unavailable"', () => {
    expect(isModuleUnavailableError(new IpcResultError('module_missing', 'x'))).toBe(true);
    expect(isModuleUnavailableError(new IpcResultError('not_found', 'verse 9:9 not in WES'))).toBe(false);
  });

  it('a generic not_found is left for the caller to log as an error', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(logModuleErrorOnce('commentary', 'WES', 'verse', new IpcResultError('not_found', 'boom'))).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('module_missing warns once per module', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const e = new IpcResultError('module_missing', 'gone');
    expect(logModuleErrorOnce('book', 'X', 'store', e)).toBe(true);
    expect(logModuleErrorOnce('book', 'X', 'store', e)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
