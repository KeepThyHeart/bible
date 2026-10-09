import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const h = vi.hoisted(() => ({
  send: vi.fn(),
  blank: vi.fn(),
  reveal: vi.fn(),
  clear: vi.fn(),
  focusBox: vi.fn(),
  showPlanItem: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));
vi.mock('../../../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));
vi.mock('../../../../hooks/useStore', () => ({ useStore: (_s: unknown, sel: () => unknown) => sel() }));
vi.mock('../../stores/presentStore', () => ({ presentStore: { session: null, acceptClickerKeys: true } }));
vi.mock('../presenterSink', () => ({
  presenterIsLive: () => false,
  presenterSend: h.send,
  presenterToggleBlank: h.blank,
  usePresenterState: () => ({ live: null }),
}));
vi.mock('../control/HighlightChips', () => ({ revealNextHighlight: h.reveal, clearWallHighlights: h.clear }));
vi.mock('../../study/PresentHelp', () => ({ PresentHelp: (p: { isOpen: boolean }) => (p.isOpen ? <div id="help" /> : null) }));
vi.mock('../../study/PresentPreview', () => ({ PresentPreview: () => null }));
vi.mock('../../study/usePresenter', () => ({
  usePresenter: () => ({ connection: 'offline', viewers: 0 }),
  describeItem: () => '',
}));
vi.mock('../../lib/command', async () => {
  const { useEffect } = await import('preact/hooks');
  return {
    // Mirrors the real hook's contract: `/` focuses the command box only while enabled.
    useCommandHotkey: ({ enabled = true }: { enabled?: boolean } = {}) => {
      useEffect(() => {
        if (!enabled) return;
        const fn = (e: KeyboardEvent) => { if (e.key === '/') h.focusBox(); };
        window.addEventListener('keydown', fn);
        return () => window.removeEventListener('keydown', fn);
      }, [enabled]);
    },
  };
});
vi.mock('../control/ControlPane', () => ({ ControlPane: () => null }));
vi.mock('../notes/NotesPane', () => ({ NotesPane: () => null }));
vi.mock('../notes/services/ServiceMenu', () => ({ ServiceMenu: () => null }));
vi.mock('../PhoneLayout', () => ({ PhoneLayout: () => null }));
vi.mock('../notes/notesStore', () => ({
  notesStore: {
    subscribe: () => () => {}, planItems: [{ id: 'a', item: {} }, { id: 'b', item: {} }], livePlanItemId: null,
    showPlanItem: h.showPlanItem, currentServiceId: null,
  },
}));

import { appHost, appRegistry, addAppBinding, activateWithRecovery } from '../../../../host/appHost';
import { PresenterApp } from '../PresenterApp';

const desc = (id: string) => ({
  id, title: { key: id, fallback: id }, icon: { kind: 'builtin' as const, name: 'x' }, order: 0,
  lifecycle: { keepAlive: 'always' as const, restore: 'default' as const },
});

const press = (key: string, init: KeyboardEventInit = {}) => {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
};

describe('PresenterApp keys while kept alive behind Study', () => {
  beforeEach(() => vi.clearAllMocks());

  it('answers keys only while it is the active app', async () => {
    appRegistry.register(desc('study'), { kind: 'builtin', moduleId: 'study' });
    appRegistry.register(desc('present'), { kind: 'builtin', moduleId: 'present' });
    addAppBinding({ id: 'study', load: async () => ({ View: () => null }) });
    addAppBinding({ id: 'present', load: async () => ({ View: () => null }) });
    const root = document.createElement('div');
    document.body.appendChild(root);
    await act(async () => { render(<PresenterApp />, root); });

    await act(async () => { await activateWithRecovery('study'); });
    for (const k of ['n', 'N', 'h', 'x', '?', '/', 'ArrowRight', '.']) press(k);
    expect(h.showPlanItem).not.toHaveBeenCalled();
    expect(h.reveal).not.toHaveBeenCalled();
    expect(h.clear).not.toHaveBeenCalled();
    expect(h.focusBox).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.blank).not.toHaveBeenCalled();
    expect(root.querySelector('#help')).toBeFalsy();

    await act(async () => { await activateWithRecovery('present'); });
    press('n');
    press('h');
    press('/');
    expect(h.showPlanItem).toHaveBeenCalledWith('a');
    expect(h.reveal).toHaveBeenCalledTimes(1);
    expect(h.focusBox).toHaveBeenCalledTimes(1);
    await act(async () => { press('?'); });
    expect(root.querySelector('#help')).toBeTruthy();

    await act(async () => { await activateWithRecovery('study'); });
    press('n');
    expect(h.showPlanItem).toHaveBeenCalledTimes(1);
  });
});
