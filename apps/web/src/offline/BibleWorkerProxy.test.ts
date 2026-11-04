import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BibleWorkerProxy } from './BibleWorkerProxy';

/** A stand-in Worker the test drives by hand. */
class FakeWorker extends EventTarget {
  static last: FakeWorker;
  sent: Record<string, unknown>[] = [];
  constructor() { super(); FakeWorker.last = this; }
  postMessage(msg: Record<string, unknown>) { this.sent.push(msg); }
  reply(data: Record<string, unknown>) { this.dispatchEvent(new MessageEvent('message', { data })); }
}

beforeEach(() => {
  vi.stubGlobal('Worker', FakeWorker);
});

describe('BibleWorkerProxy', () => {
  it('forgets a module the worker reports closed', async () => {
    const proxy = new BibleWorkerProxy();
    const open = proxy.openDb('KJV');
    FakeWorker.last.reply({ type: 'dbReady', module: 'KJV' });
    await open;
    expect(proxy.isModuleOpen('KJV')).toBe(true);

    FakeWorker.last.reply({ type: 'dbClosed', module: 'KJV' });
    expect(proxy.isModuleOpen('KJV')).toBe(false);
  });

  it('rejects only the open the error names', async () => {
    const proxy = new BibleWorkerProxy();
    const kjv = proxy.openDb('KJV');
    const asv = proxy.openDb('ASV');
    FakeWorker.last.reply({ type: 'error', requestId: -1, module: 'KJV', message: 'wrong file' });
    FakeWorker.last.reply({ type: 'dbReady', module: 'ASV' });

    await expect(kjv).rejects.toThrow('wrong file');
    await expect(asv).resolves.toBeUndefined();
    expect(proxy.isModuleOpen('ASV')).toBe(true);
  });
});
