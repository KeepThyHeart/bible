import { describe, it, expect, vi, beforeEach } from 'vitest';

const reload = vi.hoisted(() => vi.fn(() => true));
vi.mock('../../utils/bootGuard', () => ({ reloadForUpdateOnce: reload }));

import { appRegistry, addAppBinding, activateWithRecovery, appFailures, isChunkLoadError, isReloadingForUpdate } from '../appHost';

let n = 0;
function register(error: Error): string {
  const id = `app${n++}`;
  appRegistry.register(
    { id, title: { key: id, fallback: id }, icon: { kind: 'builtin', name: 'x' }, order: 5, lifecycle: { keepAlive: 'always', restore: 'default' } },
    { kind: 'builtin', moduleId: id },
  );
  addAppBinding({ id, load: async () => { throw error; } });
  return id;
}

describe('activation recovery', () => {
  beforeEach(() => reload.mockClear());

  it('recognises chunk-load errors', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/PresenterApp-x.css'))).toBe(true);
    expect(isChunkLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it('reloads once for a chunk-load failure', async () => {
    const id = register(new TypeError('Failed to fetch dynamically imported module: /a.js'));
    await activateWithRecovery(id);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(isReloadingForUpdate()).toBe(true);
  });

  it('shows the error without reloading for any other activation failure', async () => {
    const id = register(new Error('bootStudy blew up'));
    await activateWithRecovery(id);
    expect(reload).not.toHaveBeenCalled();
    expect(appFailures.getSnapshot()?.id).toBe(id);
  });
});
