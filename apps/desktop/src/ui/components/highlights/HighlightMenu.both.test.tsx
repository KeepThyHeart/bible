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
});
