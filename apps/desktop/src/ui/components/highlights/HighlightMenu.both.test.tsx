/** B-007: in "Both" mode a swatch only selects; nothing is applied until Apply. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, p?: { color?: string }) => (p?.color ? `${key}:${p.color}` : key),
    locale: 'en',
    i18n: {},
  }),
}));

import { HighlightMenu } from './HighlightMenu';

describe('HighlightMenu both mode', () => {
  it('applies only on Apply, with the chosen colour and underline style', () => {
    const onSelect = vi.fn();
    render(<HighlightMenu position={{ x: 10, y: 10 }} onSelectHighlight={onSelect} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'highlightMenu.markupBoth' }));
    fireEvent.click(screen.getByRole('radio', { name: 'highlightMenu.style.wavy' }));
    fireEvent.click(screen.getByRole('button', { name: 'highlightMenu.applyHighlightColor:highlightMenu.color.green' }));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'highlightMenu.apply' }));
    expect(onSelect).toHaveBeenCalledWith('green', 'both', 'wavy', 'yellow');
  });

  it('highlight-only still applies on a single swatch click', () => {
    const onSelect = vi.fn();
    render(<HighlightMenu position={{ x: 10, y: 10 }} onSelectHighlight={onSelect} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'highlightMenu.applyHighlightColor:highlightMenu.color.blue' }));
    expect(onSelect).toHaveBeenCalledWith('blue', 'highlight', undefined, undefined);
  });

  it('markup type is one Tab stop and the arrow keys move between the choices', () => {
    render(<HighlightMenu position={{ x: 10, y: 10 }} onSelectHighlight={vi.fn()} onCancel={vi.fn()} />);
    const group = screen.getByRole('radiogroup', { name: 'highlightMenu.markupTypeHeading' });
    const radios = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: 'ArrowRight' });
    expect(radios[1]).toHaveFocus();
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    expect(radios[1].tabIndex).toBe(0);
    expect(radios[0].tabIndex).toBe(-1);
  });

  it('underline style and colour groups are arrow-navigable too', () => {
    render(<HighlightMenu position={{ x: 10, y: 10 }} onSelectHighlight={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'highlightMenu.markupBoth' }));
    for (const heading of ['highlightMenu.underlineStyleHeading', 'highlightMenu.underlineColorHeading']) {
      const group = screen.getByRole('radiogroup', { name: heading });
      const radios = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
      expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
      radios[0].focus();
      fireEvent.keyDown(radios[0], { key: 'ArrowDown' });
      expect(radios[1]).toHaveFocus();
      expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    }
  });
});
