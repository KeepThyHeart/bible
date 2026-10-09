import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  panels: new Map<string, { openTabs: { tabId: string }[]; activeTabIndex: number }>(),
  layout: { lastActiveBiblePanelId: null as string | null },
  toggleTab: vi.fn(),
}));

vi.mock('../../stores/useBibleStore', () => ({ useBibleStore: { getState: () => ({ panels: h.panels }) } }));
vi.mock('../../stores/useLayoutStore', () => ({ useLayoutStore: { getState: () => h.layout } }));
vi.mock('./useKeywordMarkStore', () => ({ useKeywordMarkStore: { getState: () => ({ toggleTab: h.toggleTab }) } }));

import { registerKeywordCommands, activeBibleTabId } from './keywordCommands';
import type { CommandRegistration } from '../../types/Command';

function register(): CommandRegistration {
  const regs: CommandRegistration[] = [];
  registerKeywordCommands({ register: (c: CommandRegistration) => { regs.push(c); return { dispose: vi.fn() }; } } as never);
  return regs.find((c) => c.id === 'bible.toggleKeywordMarks')!;
}

describe('bible.toggleKeywordMarks', () => {
  beforeEach(() => {
    h.toggleTab.mockReset();
    h.panels = new Map([
      ['p1', { openTabs: [{ tabId: 't1' }], activeTabIndex: 0 }],
      ['p2', { openTabs: [{ tabId: 't2' }], activeTabIndex: 0 }],
    ]);
    h.layout.lastActiveBiblePanelId = null;
  });

  it('is bound to Ctrl+Shift+K (Cmd on macOS)', () => {
    expect(register().shortcut).toEqual({ key: 'Ctrl+Shift+K', mac: 'Cmd+Shift+K' });
  });

  it('toggles the tab of the last active Bible pane, else the primary one', async () => {
    const cmd = register();
    await cmd.handler({} as never);
    expect(h.toggleTab).toHaveBeenLastCalledWith('t1');
    h.layout.lastActiveBiblePanelId = 'p2';
    await cmd.handler({} as never);
    expect(h.toggleTab).toHaveBeenLastCalledWith('t2');
  });

  it('does nothing without a Bible pane', async () => {
    h.panels = new Map();
    expect(activeBibleTabId()).toBeUndefined();
    await register().handler({} as never);
    expect(h.toggleTab).not.toHaveBeenCalled();
  });
});
