import { describe, it, expect } from 'vitest';
import { buildMenuSpec } from './buildMenuSpec';
import type { MenuSpec, MenuSpecItem } from '../../../electron/menu/menuSpec';

const i18n = { t: (k: string) => `[${k}]`, resolve: (v: unknown) => String(v) };
const deps = (apps?: { commandId: string; label: string }[]) => ({
  registry: { get: (id: string) => ({ id }), list: () => [] } as never,
  i18n: i18n as never,
  keybindings: { getBindingsForCommand: (id: string) => (id === 'app.open.b' ? [{ command: id, key: 'Ctrl+Shift+2', mac: 'Cmd+Shift+2', source: 'builtin' }] : []) } as never,
  isMac: false,
  ...(apps ? { apps } : {}),
});
const view = (spec: MenuSpec): MenuSpecItem[] => {
  const v = spec.find((i) => i.type === 'submenu' && i.id === 'view');
  return v && v.type === 'submenu' ? v.submenu : [];
};

describe('View > Apps', () => {
  it('is absent with no apps or a single app (today\'s menu)', () => {
    const base = JSON.stringify(buildMenuSpec(deps()));
    expect(JSON.stringify(buildMenuSpec(deps([])))).toBe(base);
    expect(JSON.stringify(buildMenuSpec(deps([{ commandId: 'app.open.study', label: 'Study' }])))).toBe(base);
  });

  it('is a submenu of app commands, with accelerators, once there are two', () => {
    const items = view(buildMenuSpec(deps([
      { commandId: 'app.open.study', label: 'Study' },
      { commandId: 'app.open.b', label: 'B' },
    ])));
    const apps = items.find((i) => i.type === 'submenu' && i.id === 'view-apps');
    expect(apps && apps.type === 'submenu' && apps.label).toBe('[menu.view.apps]');
    expect(apps && apps.type === 'submenu' && apps.submenu).toEqual([
      { type: 'command', commandId: 'app.open.study', label: 'Study' },
      { type: 'command', commandId: 'app.open.b', label: 'B', accelerator: 'Ctrl+Shift+2' },
    ]);
  });
});
