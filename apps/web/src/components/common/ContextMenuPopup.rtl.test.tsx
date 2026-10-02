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
});
