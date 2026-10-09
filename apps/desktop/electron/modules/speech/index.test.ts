import { describe, it, expect, vi, afterEach } from 'vitest';
import { createModuleIpc } from '../moduleIpc';
import mainModule from './index';
import { getMainSpeech } from './hub';
import { speechMainManifest } from './manifest';
import { MAIN_MODULES } from '../mainModules';

afterEach(() => vi.restoreAllMocks());

describe('speech main module', () => {
  it('is registered behind the recite flag', () => {
    expect(speechMainManifest.flag).toBe('recite');
    expect(MAIN_MODULES.some((m) => m.manifest.id === 'speech')).toBe(true);
  });

  it('bridges ISpeechApi calls over module channels and unpublishes on dispose', async () => {
    const handlers = new Map<string, (e: unknown, ...a: any[]) => unknown>();
    const ipcMain = { handle: (c: string, f: any) => void handlers.set(c, f), removeHandler: (c: string) => void handlers.delete(c) };
    const sent: Array<[string, unknown]> = [];
    const win = { isDestroyed: () => false, webContents: { send: (c: string, a: unknown) => void sent.push([c, a]) } };
    const deps = { userDataPath: '', getWindows: () => [win], log: { info() {}, warn() {}, error() {} } };
    const ipc = createModuleIpc('speech', ipcMain, deps);
    const d = mainModule.registerIpc(ipc, deps) as { dispose(): void };
    expect([...handlers.keys()].sort()).toEqual(['module:speech:ready', 'module:speech:reply']);

    await handlers.get('module:speech:ready')!({});
    const p = getMainSpeech()!.status();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]![0]).toBe('module:speech:event:call');
    const call = sent[0]![1] as { callId: number; method: string };
    expect(call.method).toBe('status');
    await handlers.get('module:speech:reply')!({}, call.callId, { ok: true, value: { listen: 'ready' } });
    expect(await p).toMatchObject({ listen: 'ready' });

    d.dispose();
    expect(getMainSpeech()).toBeNull();
  });
});
