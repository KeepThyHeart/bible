/**
 * The passage-format picker's contract.
 *
 * There is one dialog, so there is one picker, and the regressions pinned
 * here are:
 *
 *   - every offered format is listed, in catalog order, under its catalog
 *     number - because the number is the shortcut key, and a number that means
 *     something different in a different dialog is worse than no number;
 *   - the number stays out of the accessible name, because "three inline
 *     quote" read aloud is a count, not a format;
 *   - arrowing through the list *selects* as it moves, so the preview beside
 *     it plays each shape (native radio behaviour, asserted so a rewrite
 *     cannot lose it silently);
 *   - Enter is left alone, so it still reaches the dialog and commits.
 *
 * A retired format shows up only when it is the one selected.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => enT(key, params), locale: 'en', i18n: {} }),
}));

import VerseFormatPicker from './VerseFormatPicker';
import { getPassageFormatCatalog } from '../../services/copyFormats';
import { enT } from '../../testing/enCatalog';

function radio(name: string): HTMLInputElement {
  return screen.getByRole('radio', { name: new RegExp(name, 'i') }) as HTMLInputElement;
}

describe('VerseFormatPicker', () => {
  it('offers the five formats, in catalog order', () => {
    const { container } = render(
      <VerseFormatPicker selectedFormatId="blockquote" onSelect={vi.fn()} />,
    );

    expect(
      Array.from(container.querySelectorAll('[data-format-id]')).map(el =>
        el.getAttribute('data-format-id'),
      ),
    ).toEqual([
      'blockquote',
      'blockquote-numbered',
      'inline-quote',
      'heading-per-verse',
      'template',
    ]);
  });

  // The numbers are the shortcut keys, and they come from the catalog - so "2"
  // is a numbered quote wherever it is typed.
  it('shows each format’s catalog number, in catalog order', () => {
    const { container } = render(
      <VerseFormatPicker selectedFormatId="blockquote" onSelect={vi.fn()} />,
    );

    const badges = Array.from(container.querySelectorAll('[data-format-number]'));
    expect(badges.map(b => b.textContent)).toEqual(
      getPassageFormatCatalog().map(f => String(f.number)),
    );
    expect(badges.map(b => b.textContent)).toEqual(['1', '2', '3', '4', '5']);
  });

  // A badge is a keyboard hint, not part of the format's name.
  it('keeps the number out of the accessible name', () => {
    render(<VerseFormatPicker selectedFormatId="blockquote" onSelect={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /^Verse headings/ })).toBeInTheDocument();
  });

  it('marks the selected format, and only it', () => {
    render(<VerseFormatPicker selectedFormatId="inline-quote" onSelect={vi.fn()} />);
    expect(radio('Inline quote').checked).toBe(true);
    expect(radio('Block quote').checked).toBe(false);
  });

  it('selects as the arrow keys move, so the preview follows the focus', () => {
    const onSelect = vi.fn();
    render(<VerseFormatPicker selectedFormatId="blockquote" onSelect={onSelect} />);

    // Native radio-group behaviour: jsdom does not simulate the roving arrow
    // keys, so the click a real arrow press performs is what is asserted.
    fireEvent.click(radio('Numbered quote'));
    expect(onSelect).toHaveBeenLastCalledWith('blockquote-numbered');
  });

  it('leaves Enter alone, so it still reaches the dialog', () => {
    const onSelect = vi.fn();
    render(<VerseFormatPicker selectedFormatId="blockquote" onSelect={onSelect} />);

    const notConsumed = fireEvent.keyDown(radio('Block quote'), { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    expect(notConsumed).toBe(true);
  });

  describe('a retired format', () => {
    it('is not offered', () => {
      render(<VerseFormatPicker selectedFormatId="blockquote" onSelect={vi.fn()} />);
      expect(screen.queryByRole('radio', { name: /Standard/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('radio', { name: /Combined/ })).not.toBeInTheDocument();
    });

    // A note written before the list was cut still carries `standard`. The
    // picker has to show what that passage *is*, or Apply preserves something
    // the user cannot see.
    it('appears when it is the one selected, with no number', () => {
      const { container } = render(
        <VerseFormatPicker selectedFormatId="standard" onSelect={vi.fn()} />,
      );

      const entry = container.querySelector('[data-format-id="standard"]');
      expect(entry).not.toBeNull();
      expect(entry?.hasAttribute('data-format-legacy')).toBe(true);
      expect(entry?.querySelector('[data-format-number]')).toBeNull();
      expect((entry?.querySelector('input') as HTMLInputElement).checked).toBe(true);
      // The five offered formats keep their numbers regardless.
      expect(
        Array.from(container.querySelectorAll('[data-format-number]')).map(b => b.textContent),
      ).toEqual(['1', '2', '3', '4', '5']);
    });
  });
});
