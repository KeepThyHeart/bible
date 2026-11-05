import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent as rtlFireEvent, act } from '@testing-library/preact';

// Test code passes plain Elements; the library types want HTMLElement.
const fireEvent = rtlFireEvent as unknown as {
  click(el: Element): void;
  keyDown(el: Element, init?: Record<string, unknown>): void;
};

const h = vi.hoisted(() => ({ view: { presenting: false, busy: false, connection: 'live', wall: true, viewers: 2 } as Record<string, unknown>, goLive: vi.fn(), end: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: { defaultValue?: string }) => (o && typeof o === 'object' && o.defaultValue) || key }),
}));
vi.mock('../../../../hooks/useStore', () => ({ useStore: (_s: unknown, sel: () => unknown) => sel() }));
vi.mock('../../../../stores/offlineStore', () => ({ offlineStore: { isOnline: true } }));
vi.mock('../../study/usePresenter', () => ({ usePresenter: () => h.view }));
vi.mock('../presenterSink', () => ({ goLive: h.goLive }));
vi.mock('../../stores/presentStore', () => ({ presentStore: { session: { joinCode: 'ABCD' }, end: h.end } }));

import { StatusRow } from './StatusRow';

const byText = (root: Element, text: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

// 0209 R2 W7 items 4 and 12: focus follows the Go live / End / End it swap, and the viewer count is labelled.
describe('StatusRow', () => {
  beforeEach(() => { h.view.presenting = false; });

  it('Go live: focus moves to End once the session is live', async () => {
    const { container, rerender } = render(<StatusRow menuOpen={false} onToggleMenu={() => {}} />);
    const go = byText(container, 'present.control.goLive');
    go.focus();
    await act(async () => { fireEvent.click(go); });
    h.view.presenting = true;
    await act(async () => { rerender(<StatusRow menuOpen={false} onToggleMenu={() => {}} />); });
    expect(document.activeElement).toBe(byText(container, 'present.control.endLive'));
  });

  it('End asks first with focus on Cancel; Cancel returns focus to End; End it returns it to Go live', async () => {
    h.view.presenting = true;
    const { container, rerender } = render(<StatusRow menuOpen={false} onToggleMenu={() => {}} />);
    await act(async () => { fireEvent.click(byText(container, 'present.control.endLive')); });
    expect(document.activeElement).toBe(byText(container, 'common.cancel'));
    await act(async () => { fireEvent.click(byText(container, 'common.cancel')); });
    expect(document.activeElement).toBe(byText(container, 'present.control.endLive'));

    await act(async () => { fireEvent.click(byText(container, 'present.control.endLive')); });
    await act(async () => { fireEvent.click(byText(container, 'present.endYes')); });
    expect(h.end).toHaveBeenCalled();
    h.view.presenting = false;
    await act(async () => { rerender(<StatusRow menuOpen={false} onToggleMenu={() => {}} />); });
    expect(document.activeElement).toBe(byText(container, 'present.control.goLive'));
  });

  it('Escape in the End confirm cancels it and returns focus to End', async () => {
    h.view.presenting = true;
    h.end.mockClear();
    const { container } = render(<StatusRow menuOpen={false} onToggleMenu={() => {}} />);
    await act(async () => { fireEvent.click(byText(container, 'present.control.endLive')); });
    expect(byText(container, 'present.endYes')).toBeTruthy();
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); });
    expect(byText(container, 'present.endYes')).toBeUndefined();
    expect(h.end).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(byText(container, 'present.control.endLive'));
  });

  it('labels the viewer count', () => {
    h.view.presenting = true;
    const { container } = render(<StatusRow menuOpen={false} onToggleMenu={() => {}} />);
    expect(container.querySelector('.pz-status__viewers')!.textContent).toContain('Viewers: 2');
  });
});
