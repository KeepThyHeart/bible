import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ar' } }),
}));

import { ContextMenuPopup } from './ContextMenuPopup';

describe('ContextMenuPopup in an RTL UI', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('dir');
  });

  it('opens away from the pointer in the reading direction (leftward in RTL)', () => {
    document.documentElement.dir = 'rtl';
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    const { container } = render(<ContextMenuPopup x={400} y={50} menuRef={{ current: null }} onAction={vi.fn()} />);
    const menu = container.querySelector('.verse-context-menu') as HTMLElement;
    // Pointer is 600px from the right edge; the menu starts there and unfolds leftward.
    expect(menu.style.insetInlineStart).toBe('600px');
    expect(menu.style.left).toBe('');
  });

  it('renders registry actions in an RTL UI without physical properties', () => {
    document.documentElement.dir = 'rtl';
    const { container } = render(
      <ContextMenuPopup
        x={400} y={50} menuRef={{ current: null }} onAction={vi.fn()}
        actions={[{ id: 'present.showVerse', label: 'Present', iconClass: 'fa-solid fa-tv' }]}
        onVerseAction={vi.fn()}
      />,
    );
    const last = Array.from(container.querySelectorAll('.verse-context-menu__item')).pop() as HTMLElement;
    expect(last.textContent).toContain('Present');
    expect(last.style.left).toBe('');
  });
});
