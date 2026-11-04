// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

const flags = vi.hoisted(() => ({ on: false }));
vi.mock('../utils/featureFlags', () => ({ isEnabled: (name: string) => name === 'localUserDb' && flags.on }));

const clientSpy = vi.hoisted(() => ({ evaluated: 0, supported: true }));
vi.mock('../userdb/client', () => {
  clientSpy.evaluated++;
  return { isUserDbSupported: () => clientSpy.supported, getUserDbClient: () => Promise.reject(new Error('no worker in tests')) };
});
const opfsSpy = vi.hoisted(() => ({ evaluated: 0, fail: true }));
vi.mock('../userdb/OpfsUserData', () => {
  opfsSpy.evaluated++;
  return { OpfsUserData: { open: () => (opfsSpy.fail ? Promise.reject(new Error('worker failed')) : Promise.resolve({ marker: 'opfs', close() {} })) } };
});

import { getUserData, resetUserDataForTests, userDataIfReady } from './userData';
import { WebUserData } from './WebUserData';

vi.stubGlobal('indexedDB', new IDBFactory());

afterEach(async () => {
  await resetUserDataForTests();
  flags.on = false;
  clientSpy.supported = true;
  opfsSpy.fail = true;
  vi.restoreAllMocks();
});

describe('getUserData provider choice', () => {
  it('flag off: WebUserData, and neither userdb module is ever evaluated', async () => {
    const store = await getUserData();
    expect(store).toBeInstanceOf(WebUserData);
    expect(userDataIfReady()).toBe(store);
    expect(clientSpy.evaluated).toBe(0);
    expect(opfsSpy.evaluated).toBe(0);
    expect(await getUserData()).toBe(store); // singleton
  });

  it('flag on and supported: the OPFS provider', async () => {
    flags.on = true;
    opfsSpy.fail = false;
    expect(await getUserData()).toMatchObject({ marker: 'opfs' });
  });

  it('flag on but unsupported: console.warn and WebUserData, without loading the OPFS provider', async () => {
    flags.on = true;
    clientSpy.supported = false;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const evaluatedBefore = opfsSpy.evaluated;
    expect(await getUserData()).toBeInstanceOf(WebUserData);
    expect(opfsSpy.evaluated).toBe(evaluatedBefore);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('flag on but the open fails or times out: console.warn and WebUserData', async () => {
    flags.on = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await getUserData()).toBeInstanceOf(WebUserData);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0].join(' '))).toContain('worker failed');
  });
});
