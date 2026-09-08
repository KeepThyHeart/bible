/**
 * The floating toolbar's two additions, driven through the real chain:
 *
 *   - "More..." escalating to the full HighlightMenu *carrying the selection*.
 *     Re-reading `window.getSelection()` after the click that opened the menu
 *     would let a collapsed selection silently become "the whole verse". The
 *     handoff here passes the word range explicitly, and this file pins that
 *     down by collapsing the selection before the menu is used.
 *
 *   - The "Recent" row: what gets remembered, in what order, that one click
 *     re-applies it, that the x forgets it, and that it survives a restart
 *     (which here means: it is in localStorage, and a fresh load finds it).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { UserTextMarkup } from '@bible/core';

/** What the renderer handed to the repository. */
const sent: UserTextMarkup[] = [];

vi.mock('../../services/highlightsAPI', () => ({
  IPCHighlightRepository: class {
    async getForVerseRange(): Promise<UserTextMarkup[]> { return []; }
    async getForModule(): Promise<UserTextMarkup[]> { return []; }
    async create(markup: UserTextMarkup): Promise<UserTextMarkup> {
      sent.push(markup);
      return new UserTextMarkup({ ...markup, markupId: sent.length });
    }
    async delete(): Promise<void> {}
  },
}));

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => enT(key, params), locale: 'en', i18n: {} }),
}));

vi.mock('../BibleHeader', () => ({ default: () => <div data-testid="bible-header" /> }));
vi.mock('../study/StudyModeView', () => ({ default: () => <div data-testid="study-mode-view" /> }));
vi.mock('../ParallelBibleView', () => ({ default: () => <div data-testid="parallel-view" /> }));
vi.mock('../SearchResultsPane', () => ({ default: () => <div data-testid="search-results" /> }));

import { useHighlightStore } from '../../stores/useHighlightStore';
import { enString, enT } from '../../testing/enCatalog';
import {
  loadRecentMarkupStyles,
  markupStyleKey,
  RECENT_MARKUP_STYLES_STORAGE_KEY,
  type MarkupStyle,
} from '../../services/recentMarkupStyles';
import {
  Harness,
  PSALM_3_1,
  selectFirstTwoWords,
  selectWords,
  installRangeLayoutStubs,
  installResizeObserverStub,
} from './highlightFlowHarness';

installRangeLayoutStubs();

/*
  `t` is stubbed to echo the key, so the toolbar (which calls `t` directly) is
  queried by key while the full menu - which goes through `tf` - falls back to
  its English source text and is queried by that.
*/
const MORE_BUTTON = enString('ui.floatingAnnotation.moreOptions');
const CLEAR_BUTTON = enString('ui.floatingAnnotation.clearRecent');
const MENU_UNDERLINE_TYPE = 'Underline';
const MENU_YELLOW_SWATCH = 'Highlight in Yellow';
const MENU_WAVY_STYLE = 'Wavy';
const MENU_APPLY_UNDERLINE = 'Apply underline';

/** The Recent row's swatches, in the order they are offered. */
function recentSwatchKeys(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-recent-style]')).map(
    element => element.getAttribute('data-recent-style') ?? '',
  );
}

function key(style: MarkupStyle): string {
  return markupStyleKey(style);
}

describe('floating toolbar: More… and the Recent row', () => {
  beforeEach(() => {
    sent.length = 0;
    localStorage.clear();
    useHighlightStore.setState({
      highlightsByModule: new Map(),
      lastUsedColor: 'yellow',
      recentMarkupStyles: [],
    });
    vi.useFakeTimers();
    installResizeObserverStub();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.getSelection()?.removeAllRanges();
  });

  describe('More…', () => {
    it('replaces the toolbar with the full menu', async () => {
      render(<Harness />);
      await selectFirstTwoWords(true);

      await act(async () => {
        fireEvent.click(screen.getByLabelText(MORE_BUTTON));
      });

      expect(screen.queryByLabelText(MORE_BUTTON)).not.toBeInTheDocument();
      // The full menu's markup-type radios: the options the toolbar cannot offer.
      expect(screen.getByText(MENU_UNDERLINE_TYPE)).toBeInTheDocument();
    });

    /*
      The regression this file exists for. The click that opens the menu
      collapses the browser selection, so the two selected words have to have
      been carried across as data - otherwise the markup covers the whole verse.
    */
    it('annotates the same words even after the selection collapses', async () => {
      render(<Harness />);
      await selectWords(0, 1, true);

      await act(async () => {
        fireEvent.click(screen.getByLabelText(MORE_BUTTON));
      });

      // Exactly what a mousedown inside the menu does in the browser.
      await act(async () => {
        window.getSelection()!.removeAllRanges();
      });
      expect(window.getSelection()!.isCollapsed).toBe(true);

      await act(async () => {
        fireEvent.click(screen.getByLabelText(MENU_YELLOW_SWATCH));
      });

      expect(sent).toHaveLength(1);
      expect(sent[0].verseIdStart).toBe(PSALM_3_1);
      expect(sent[0].textStart).toBe(0);
      expect(sent[0].textEnd).toBe(1);
    });
  });

  describe('the Recent row', () => {
    it('is absent until something has been applied', async () => {
      render(<Harness />);
      await selectFirstTwoWords(true);

      expect(recentSwatchKeys()).toEqual([]);
      expect(screen.queryByLabelText(CLEAR_BUTTON)).not.toBeInTheDocument();
    });

    it('offers a highlight and an underline as separate entries, newest first', async () => {
      render(<Harness />);

      await selectFirstTwoWords(true);
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Highlight Green'));
      });

      await selectFirstTwoWords(true);
      await act(async () => {
        fireEvent.click(screen.getByLabelText(enString('ui.floatingAnnotation.toggleUnderline')));
      });

      await selectFirstTwoWords(true);
      expect(recentSwatchKeys()).toEqual([
        // The underline is remembered as a solid underline in the last-used
        // colour, not merely as "green".
        key({ markupType: 'underline', color: 'green', underlineStyle: 'solid', underlineColor: 'green' }),
        key({ markupType: 'highlight', color: 'green' }),
      ]);
    });

    it('re-applies a remembered style to the current selection in one click', async () => {
      render(<Harness />);

      await selectFirstTwoWords(true);
      await act(async () => {
        fireEvent.click(screen.getByLabelText(enString('ui.floatingAnnotation.toggleUnderline')));
      });
      sent.length = 0;

      // A different, longer selection: the recent swatch must annotate THIS one.
      await selectWords(2, 4, true);
      const swatch = document.querySelector<HTMLElement>('[data-recent-style]')!;
      await act(async () => {
        fireEvent.click(swatch);
      });

      expect(sent).toHaveLength(1);
      expect(sent[0].textStart).toBe(2);
      expect(sent[0].textEnd).toBe(4);
      expect(sent[0].metadata?.markupType).toBe('underline');
      expect(sent[0].metadata?.underlineStyle).toBe('solid');
    });

    it('previews the mark rather than just its colour', async () => {
      render(<Harness />);
      await selectFirstTwoWords(true);
      await act(async () => {
        fireEvent.click(screen.getByLabelText(enString('ui.floatingAnnotation.toggleUnderline')));
      });

      await selectFirstTwoWords(true);
      const preview = document.querySelector<HTMLElement>('[data-recent-style] span')!;
      expect(preview.className).toContain('underline-solid');
      expect(preview.className).toContain('underline-color-yellow');
      expect(preview.className).not.toContain('highlight-');
    });

    it('keeps at most three, dropping the oldest', async () => {
      render(<Harness />);

      for (const color of ['Yellow', 'Blue', 'Green', 'Pink']) {
        await selectFirstTwoWords(true);
        await act(async () => {
          fireEvent.click(screen.getByLabelText(`Highlight ${color}`));
        });
      }

      await selectFirstTwoWords(true);
      expect(recentSwatchKeys()).toEqual([
        key({ markupType: 'highlight', color: 'red' }),
        key({ markupType: 'highlight', color: 'green' }),
        key({ markupType: 'highlight', color: 'blue' }),
      ]);
    });

    it('promotes a re-used style instead of listing it twice', async () => {
      render(<Harness />);

      for (const color of ['Yellow', 'Blue', 'Yellow']) {
        await selectFirstTwoWords(true);
        await act(async () => {
          fireEvent.click(screen.getByLabelText(`Highlight ${color}`));
        });
      }

      await selectFirstTwoWords(true);
      expect(recentSwatchKeys()).toEqual([
        key({ markupType: 'highlight', color: 'yellow' }),
        key({ markupType: 'highlight', color: 'blue' }),
      ]);
    });

    it('forgets everything when the x is clicked', async () => {
      render(<Harness />);
      await selectFirstTwoWords(true);
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Highlight Blue'));
      });

      await selectFirstTwoWords(true);
      expect(recentSwatchKeys()).toHaveLength(1);

      await act(async () => {
        fireEvent.click(screen.getByLabelText(CLEAR_BUTTON));
      });

      expect(recentSwatchKeys()).toEqual([]);
      expect(useHighlightStore.getState().recentMarkupStyles).toEqual([]);
      // And it stays forgotten across a restart.
      expect(loadRecentMarkupStyles()).toEqual([]);
      expect(localStorage.getItem(RECENT_MARKUP_STYLES_STORAGE_KEY)).toBeNull();
    });

    /*
      The whole point of the feature: someone with a favourite underline should
      find it there tomorrow. A restart is modelled as "what a fresh
      loadRecentMarkupStyles() sees", which is exactly what the store reads at
      creation.
    */
    it('survives a restart', async () => {
      render(<Harness />);
      await selectFirstTwoWords(true);
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Highlight Green'));
      });

      expect(loadRecentMarkupStyles()).toEqual([{ markupType: 'highlight', color: 'green' }]);
    });

    it('ignores a corrupt store rather than breaking the toolbar', async () => {
      localStorage.setItem(RECENT_MARKUP_STYLES_STORAGE_KEY, 'not json at all');
      useHighlightStore.setState({ recentMarkupStyles: loadRecentMarkupStyles() });

      render(<Harness />);
      await selectFirstTwoWords(true);

      expect(screen.getByLabelText(MORE_BUTTON)).toBeInTheDocument();
      expect(recentSwatchKeys()).toEqual([]);
    });
  });

  /*
    The underline-colour grid is how a colour is chosen, so the colour has to
    be the loudest thing in each swatch. A capital "A" wearing the underline
    classes would fill the button with only the two-pixel rule beneath it in
    colour, making red and orange indistinguishable at a glance. Each swatch
    is a bold line instead, drawn in that swatch's colour and in the style
    selected above.
  */
  it('previews each underline colour as a bold line in the chosen style', async () => {
    render(<Harness />);
    await selectFirstTwoWords(true);

    await act(async () => {
      fireEvent.click(screen.getByLabelText(MORE_BUTTON));
    });
    await act(async () => {
      fireEvent.click(screen.getByText(MENU_UNDERLINE_TYPE));
    });
    await act(async () => {
      fireEvent.click(screen.getByText(MENU_WAVY_STYLE));
    });

    const swatches = screen.getAllByTestId('underline-swatch');
    // One per palette colour, each drawn in the style just chosen.
    expect(swatches).toHaveLength(6);
    expect(swatches.map(s => s.getAttribute('data-underline-color'))).toEqual([
      'yellow', 'green', 'blue', 'red', 'purple', 'orange',
    ]);
    for (const swatch of swatches) {
      expect(swatch.getAttribute('data-underline-style')).toBe('wavy');
      // No sample glyph - the line is the whole preview.
      expect(swatch.textContent).toBe('');
    }
  });

  /*
    The full menu is the other apply path, and it is the only one that can name
    an underline style. What it applies has to be remembered too, or the row
    can never offer anything but solid.
  */
  it('remembers a style applied from the full menu', async () => {
    render(<Harness />);
    await selectFirstTwoWords(true);

    await act(async () => {
      fireEvent.click(screen.getByLabelText(MORE_BUTTON));
    });
    await act(async () => {
      fireEvent.click(screen.getByText(MENU_UNDERLINE_TYPE));
    });
    await act(async () => {
      fireEvent.click(screen.getByText(MENU_WAVY_STYLE));
    });
    await act(async () => {
      fireEvent.click(screen.getByText(MENU_APPLY_UNDERLINE));
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].metadata?.underlineStyle).toBe('wavy');
    expect(useHighlightStore.getState().recentMarkupStyles).toEqual([
      { markupType: 'underline', color: 'yellow', underlineStyle: 'wavy', underlineColor: 'yellow' },
    ]);
  });
});
