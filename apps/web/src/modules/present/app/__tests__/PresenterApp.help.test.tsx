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

// The app bar's Help button opens the help dialog.
describe('PresenterApp help button', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens the help dialog', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    await act(async () => { render(<PresenterApp />, root); });
    expect(root.querySelector('#help')).toBeNull();
    const button = root.querySelector<HTMLButtonElement>('button[aria-label="present.help"]')!;
    await act(async () => { fireEvent.click(button); });
    expect(root.querySelector('#help')).not.toBeNull();
  });
});
