/**
 * The gesture gate's renderer half (task 0080 M3): only a user-started run of an extension command may
 * report `userGesture: true`; a worker's `commands.execute` (the 'execute' op) never does, even while the
 * browser's transient activation is live.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { attachExtensionRendererBridge } from './extensionRendererBridge';
import { CommandRegistry } from '../services/CommandRegistry';
import { WhenContextService } from '../services/WhenContextService';
import { I18nService } from '../services/I18nService';

type Handler = (payload: unknown) => void;

function setup() {
  const handlers = new Map<string, Handler>();
  const invoke = vi.fn(async () => undefined);
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const api = {
    on: (channel: string, h: Handler) => {
      handlers.set(channel, h);
      return () => undefined;
    },
    send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
    invoke,
  };
  const i18n = new I18nService();
  const registry = new CommandRegistry({ i18n, whenContext: new WhenContextService() });
  const detach = attachExtensionRendererBridge({ registry, whenContext: new WhenContextService(), i18n } as never, api as never);
  const fire = (op: string, args: unknown[], requestId = 1) => handlers.get('ext-bridge:command')!({ requestId, op, args });
  return { registry, invoke, fire, sent, detach };
}

const ID = 'ext.a.b.open';

describe('extension command userGesture origin', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function registerCommand(h: ReturnType<typeof setup>): Promise<void> {
    h.fire('register', [{ registrationId: 'r1', spec: { id: ID, ownerExtensionId: 'ext.a.b', title: 'Open' } }]);
    await vi.waitFor(() => expect(h.registry.get(ID)).toBeDefined());
  }

  it('reports a gesture for a user-started run while activation is live', async () => {
    vi.stubGlobal('navigator', { userActivation: { isActive: true }, platform: 'Linux' });
    const h = setup();
    await registerCommand(h);
    await h.registry.execute(ID);
    expect(h.invoke).toHaveBeenCalledWith('ext-bridge:command:invoke', expect.objectContaining({ userGesture: true }));
    h.detach();
  });

  it('never reports a gesture for a worker-initiated execute, even with live activation', async () => {
    vi.stubGlobal('navigator', { userActivation: { isActive: true }, platform: 'Linux' });
    const h = setup();
    await registerCommand(h);
    h.fire('execute', [ID, undefined], 2);
    await vi.waitFor(() => expect(h.invoke).toHaveBeenCalled());
    expect(h.invoke).toHaveBeenCalledWith('ext-bridge:command:invoke', expect.objectContaining({ userGesture: false }));
    h.detach();
  });
});
