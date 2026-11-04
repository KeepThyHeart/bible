/** B-042: dockview tabs expose tab semantics and respond to the keyboard. */
import { describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../stores/useLayoutStore', () => ({ useLayoutStore: vi.fn().mockReturnValue(undefined) }));
vi.mock('../contexts/useI18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock('../utils/paneNames', () => ({ localizePaneLabel: (_t: unknown, _c: unknown, l: string) => l }));
vi.mock('../hooks/useOverlayDismissal', () => ({ useOverlayDismissal: vi.fn() }));

import DockviewTabRenderer from './DockviewTabRenderer';

function props(setActive: () => void, isActive: boolean) {
  return {
    api: {
      id: 'p1', title: 'Study', isActive, setActive,
      group: { id: 'g', panels: [{ id: 'p1' }, { id: 'p2' }] },
      onDidTitleChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidGroupChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidActiveChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      close: vi.fn(),
    },
    containerApi: {
      panels: [{ id: 'p1' }, { id: 'p2' }],
      onDidLayoutChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    params: { contentType: 'study' },
  } as any;
}

describe('dockview tab a11y (B-042)', () => {
  it('sets tab roles and handles Enter/Space/arrows', async () => {
    const setActive = vi.fn();
    const { container } = render(
      <div className="dv-tabs-container">
        <div className="dv-tab" tabIndex={0}><DockviewTabRenderer {...props(setActive, true)} /></div>
        <div className="dv-tab" tabIndex={0}>other</div>
      </div>,
    );
    const strip = container.querySelector('.dv-tabs-container') as HTMLElement;
    const [a, b] = Array.from(container.querySelectorAll<HTMLElement>('.dv-tab'));
    expect(strip.getAttribute('role')).toBe('tablist');
    expect(a.getAttribute('role')).toBe('tab');
    expect(a.getAttribute('aria-selected')).toBe('true');
    const user = userEvent.setup();
    a.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(setActive).toHaveBeenCalledTimes(2);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(b);
    cleanup();
  });
});
