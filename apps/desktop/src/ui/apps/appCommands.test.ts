import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appRegistry } from './appHost';
import { installAppCommands } from './appCommands';
import { usePreferencesStore } from '../stores/usePreferencesStore';

function fakeRegistry() {
  const cmds = new Map<string, { id: string; title: string; shortcut?: { key: string; mac?: string }; handler: () => void }>();
  return {
    cmds,
    register: vi.fn((c: any) => { cmds.set(c.id, c); return { dispose: () => { cmds.delete(c.id); } }; }),
  };
}
const i18n = {
  t: (key: string) => `[${key}]`,
  currentLocale: 'en',
  onDidChangeLocale: () => ({ dispose: vi.fn() }),
  resolve: (v: unknown) => String(v),
};

const desc = (id: string, order: number) => ({
  id, title: { key: `apps.${id}.title`, fallback: id.toUpperCase() }, icon: { kind: 'builtin' as const, name: 'app' },
  order, lifecycle: { keepAlive: 'always' as const, restore: 'reopen' as const },
});

describe('installAppCommands', () => {
  beforeEach(() => {
    for (const d of [...appRegistry.list()]) appRegistry.unregister(d.id);
    usePreferencesStore.setState({ appOrder: [], appHidden: [] });
  });

  it('registers app.open.<id> with Ctrl+Shift+<slot> by order, plus app.goToStudy on Ctrl+Shift+0', () => {
    appRegistry.register(desc('study', 0), { kind: 'builtin', moduleId: 'study' });
    appRegistry.register(desc('b', 20), { kind: 'builtin', moduleId: 'b' });
    const reg = fakeRegistry();
    installAppCommands({ registry: reg as never, i18n: i18n as never });
    expect(reg.cmds.get('app.open.study')!.shortcut).toEqual({ key: 'Ctrl+Shift+1', mac: 'Cmd+Shift+1' });
    expect(reg.cmds.get('app.open.b')!.shortcut).toEqual({ key: 'Ctrl+Shift+2', mac: 'Cmd+Shift+2' });
    expect(reg.cmds.get('app.goToStudy')!.shortcut).toEqual({ key: 'Ctrl+Shift+0', mac: 'Cmd+Shift+0' });
    expect(reg.cmds.get('app.open.b')!.title).toBe('B');
  });

  it('disposes the command of an unregistered app and follows the user order', () => {
    appRegistry.register(desc('study', 0), { kind: 'builtin', moduleId: 'study' });
    const b = appRegistry.register(desc('b', 20), { kind: 'builtin', moduleId: 'b' });
    const reg = fakeRegistry();
    const handle = installAppCommands({ registry: reg as never, i18n: i18n as never });
    usePreferencesStore.setState({ appOrder: ['b', 'study'] });
    expect(reg.cmds.get('app.open.b')!.shortcut!.key).toBe('Ctrl+Shift+1');
    b.dispose();
    expect(reg.cmds.has('app.open.b')).toBe(false);
    expect(reg.cmds.get('app.open.study')!.shortcut!.key).toBe('Ctrl+Shift+1');
    handle.dispose();
    expect(reg.cmds.size).toBe(0);
  });
});
