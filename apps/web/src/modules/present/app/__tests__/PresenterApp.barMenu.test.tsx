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
  useTranslation: () => ({ t: (k: string) => k }),
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

import { fireEvent } from '@testing-library/preact';
import { PresenterApp } from '../PresenterApp';

// 0209 R2 W7 item 3: the app bar's "More" menu has a name, closes on Escape and on an outside press,
// and yields to any other menu that opens.
describe('PresenterApp app bar menu', () => {
  beforeEach(() => vi.clearAllMocks());

  const mount = async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    await act(async () => { render(<PresenterApp />, root); });
    const button = root.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
    await act(async () => { fireEvent.click(button); });
    return { root, button };
  };

  it('names the menu and moves focus into it', async () => {
    const { root } = await mount();
    const menu = root.querySelector('[role="menu"]')!;
    expect(menu.getAttribute('aria-label')).toBe('present.app.moreTooltip');
    expect(document.activeElement).toBe(menu.querySelector('[role="menuitem"]'));
  });

  it('Escape closes it and returns focus to the button', async () => {
    const { root, button } = await mount();
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); });
    expect(root.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('closes on a press outside it', async () => {
    const { root } = await mount();
    await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(root.querySelector('[role="menu"]')).toBeNull();
  });

  it('closes when another menu opens', async () => {
    const { root } = await mount();
    await act(async () => { window.dispatchEvent(new CustomEvent('present-menu-opened', { detail: 'service-menu' })); });
    expect(root.querySelector('[role="menu"]')).toBeNull();
  });
});
