import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));

import { appHost, appRegistry, addAppBinding, consumeAppPop } from '../appHost';
import { activateApp, backFromApp, appIdForHash } from '../webRoute';
import { studyOwnsHash, setStudyOwnsHash, noteStudyHash } from '../hashGate';

const View = () => null;
let presentGate: Promise<void> | null = null;
let registered = false;

beforeEach(async () => {
  if (!registered) {
    registered = true;
    appRegistry.register({ id: 'study', title: { key: 'a', fallback: 'Study' }, icon: { kind: 'builtin', name: 'x' }, order: 0, lifecycle: { keepAlive: 'always', restore: 'reopen' } }, { kind: 'builtin', moduleId: 'study' });
    appRegistry.register({ id: 'present', title: { key: 'b', fallback: 'P' }, icon: { kind: 'builtin', name: 'x' }, order: 10, lifecycle: { keepAlive: 'while-busy', restore: 'while-busy' } }, { kind: 'builtin', moduleId: 'present' });
    addAppBinding({ id: 'study', load: async () => ({ View }) });
    addAppBinding({ id: 'present', load: async () => ({ View, activate: async () => { await presentGate; } }) });
  }
  presentGate = null;
  history.replaceState(null, '', '/#/KJV/43/3');
  setStudyOwnsHash(true);
  await appHost.activate('study');
});

describe('webRoute', () => {
  it('maps hashes to apps', () => {
    expect(appIdForHash('#/@present')).toBe('present');
    expect(appIdForHash('#/@nope')).toBe('study');
    expect(appIdForHash('#/KJV/1/1')).toBe('study');
  });

  it('opens an app: pushes #/@id, Study stops owning the hash', async () => {
    await activateApp('present');
    expect(location.hash).toBe('#/@present');
    expect(appHost.getSnapshot().activeId).toBe('present');
    expect(studyOwnsHash()).toBe(false);
  });

  it('backFromApp restores the remembered reader hash and Study ownership', async () => {
    await activateApp('present');
    noteStudyHash('#/KJV/1/1');
    await backFromApp();
    expect(location.hash).toBe('#/KJV/1/1');
    expect(appHost.getSnapshot().activeId).toBe('study');
    expect(studyOwnsHash()).toBe(true);
  });

  it('backFromApp falls back to the reader hash seen at open time', async () => {
    await activateApp('present');
    await backFromApp();
    expect(location.hash).toBe('#/KJV/43/3');
  });

  it('popstate onto an app hash activates it and flags the pop once', async () => {
    history.replaceState(null, '', '/#/@present');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(appHost.getSnapshot().activeId).toBe('present'));
    expect(consumeAppPop()).toBe(true);
    expect(consumeAppPop()).toBe(false);
  });

  it('popstate within Study does not flag a pop', () => {
    history.replaceState(null, '', '/#/KJV/1/2');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(consumeAppPop()).toBe(false);
  });

  it('Back while the Presenter is still starting wins: reader URL restored, Study owns the hash', async () => {
    let release!: () => void;
    presentGate = new Promise<void>((r) => { release = r; });
    const opening = activateApp('present');
    expect(location.hash).toBe('#/@present');
    await backFromApp();
    release();
    await opening;
    expect(appHost.getSnapshot().activeId).toBe('study');
    expect(location.hash).toBe('#/KJV/43/3');
    expect(studyOwnsHash()).toBe(true);
  });

  it('Back then reopening the Presenter leaves #/@present and Study not owning the hash', async () => {
    await activateApp('present');
    await backFromApp();
    await activateApp('present');
    expect(location.hash).toBe('#/@present');
    expect(appHost.getSnapshot().activeId).toBe('present');
    expect(studyOwnsHash()).toBe(false);
  });
});
