/**
 * Component tests for the two interlinear layouts.
 *
 * The bug these layouts were written to fix is a *missing* one: the previous
 * renderer emitted a block per interlinear row and nothing else, so any English
 * word no row claimed vanished from the page — 5.7% of the KJV, including every
 * italicised supplied word, and over half of RWebster. `interlinearCells.ts` is
 * tested for producing a cell per unclaimed run; nothing checked that the
 * layouts then *render* those cells.
 *
 * So the assertions here are mostly about the English text: every word, once,
 * in translation order, with its formatting intact. The Strong's wiring is the
 * other half — the original-language word is the thing a reader is most likely
 * to click, and it was inert for a while.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import type { InterlinearCell, InterlinearWord } from '../../utils/interlinearCells';
import type { WordInfo } from '../../utils/wordIndexing';
import type { StrongsEntryData } from '../../types';

const mockPerformSearch = vi.fn();
const mockSetRightPaneMode = vi.fn();

vi.mock('../../stores/searchStore', () => ({
  searchStore: { performSearch: (q: string) => mockPerformSearch(q) },
}));
vi.mock('../../stores/commentaryStore', () => ({
  commentaryStore: { setRightPaneMode: (m: string) => mockSetRightPaneMode(m) },
}));

const { StackedInterlinear, InlineInterlinear } = await import('./InterlinearLayouts');

// ---- Fixtures ------------------------------------------------------------

function word(displayText: string, flags: Partial<WordInfo> = {}): WordInfo {
  return {
    text: displayText.replace(/[^\w']/g, ''),
    displayText,
    isChristWords: false,
    isDivineName: false,
    hasTrailingSpace: true,
    ...flags,
  };
}

function source(overrides: Partial<InterlinearWord> = {}): InterlinearWord {
  return {
    wordPositionStart: 0,
    wordPositionEnd: 0,
    originalWord: 'ἀγάπη',
    transliteration: 'agape',
    strongsNumber: 'G26',
    gloss: 'love',
    ...overrides,
  };
}

/** A cell over one English word, backed by a row. */
function cell(
  wordStart: number,
  words: WordInfo[],
  src: InterlinearWord | null = source({ wordPositionStart: wordStart, wordPositionEnd: wordStart + words.length - 1 }),
  extraSources: InterlinearWord[] = [],
): InterlinearCell {
  return { wordStart, wordEnd: wordStart + words.length - 1, englishWords: words, source: src, extraSources };
}

const ENTRIES: Record<string, StrongsEntryData> = {
  G26: {
    strongsNumber: 'G26', word: 'ἀγάπη', transliteration: 'agape',
    definition: 'love, benevolence', partOfSpeech: 'n-f', briefMeaning: 'love, goodwill',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- Shared behaviour ----------------------------------------------------

for (const [name, Layout] of [
  ['StackedInterlinear', StackedInterlinear],
  ['InlineInterlinear', InlineInterlinear],
] as const) {
  describe(`${name} — English text`, () => {
    it('renders a cell that no interlinear row claims', () => {
      // The whole reason cells exist. A supplied word carries `source: null`,
      // and the old renderer dropped it entirely.
      const cells = [
        cell(0, [word('For')]),
        cell(1, [word('God')], null),
        cell(2, [word('loved')]),
      ];

      const { container } = render(<Layout cells={cells} />);

      expect(container.textContent).toContain('God');
    });

    it('keeps the words in translation order, not row order', () => {
      // Interlinear rows come back in original-language order, which for Greek
      // is not English order. Rendering the cells' English is what fixes that.
      const cells = [
        cell(0, [word('God')]),
        cell(1, [word('so')], null),
        cell(2, [word('loved')]),
        cell(3, [word('the'), word('world')], null),
      ];

      const { container } = render(<Layout cells={cells} />);

      const text = container.textContent ?? '';
      expect(text.indexOf('God')).toBeLessThan(text.indexOf('so'));
      expect(text.indexOf('so')).toBeLessThan(text.indexOf('loved'));
      expect(text.indexOf('loved')).toBeLessThan(text.indexOf('the world'));
    });

    it('renders each English word exactly once', () => {
      // A row's gloss repeats the English it covers; rendering both the gloss
      // and the tokens would double every tagged word.
      const cells = [cell(0, [word('love')], source({ gloss: 'love' }))];

      const { container } = render(<Layout cells={cells} />);

      expect((container.textContent ?? '').match(/love/g)).toHaveLength(1);
    });

    it('spaces multiple words inside one cell', () => {
      // One row can cover several English words ("shall not perish").
      const cells = [cell(0, [word('shall'), word('not'), word('perish')], source({ wordPositionEnd: 2 }))];

      const { container } = render(<Layout cells={cells} />);

      expect(container.textContent).toContain('shall not perish');
    });

    it('does not leave a trailing space inside a cell', () => {
      const cells = [cell(0, [word('God'), word('so')], null)];

      const { container } = render(<Layout cells={cells} />);

      expect(container.textContent).toBe('God so');
    });

    it('carries the words-of-Christ formatting through', () => {
      // The tokens are re-emitted rather than the source HTML, so these flags
      // are the only thing keeping red-letter text red in the interlinear.
      const cells = [cell(0, [word('Verily', { isChristWords: true })], null)];

      const { container } = render(<Layout cells={cells} />);

      expect(container.querySelector('.christ-words')?.textContent).toBe('Verily');
    });

    it('carries the divine-name formatting through', () => {
      const cells = [cell(0, [word('LORD', { isDivineName: true })], null)];

      const { container } = render(<Layout cells={cells} />);

      expect(container.querySelector('.divine-name')?.textContent).toBe('LORD');
    });

    it('applies both flags to a word that carries both', () => {
      const cells = [cell(0, [word('LORD', { isChristWords: true, isDivineName: true })], null)];

      const { container } = render(<Layout cells={cells} />);

      const span = container.querySelector('.christ-words');
      expect(span?.classList.contains('divine-name')).toBe(true);
    });

    it('leaves an unformatted word without a class', () => {
      const cells = [cell(0, [word('God')], null)];

      const { container } = render(<Layout cells={cells} />);

      expect(container.querySelector('.christ-words')).toBeNull();
      expect(container.querySelector('.divine-name')).toBeNull();
    });

    it('renders nothing but the container for an empty cell list', () => {
      const { container } = render(<Layout cells={[]} />);

      expect(container.textContent).toBe('');
    });
  });

  describe(`${name} — Strong's chips`, () => {
    it('renders a chip per Strong\'s number on the cell', () => {
      // Extra sources are rows pinned to a cell that already has one — John
      // 3:16 hangs two more Greek articles off index 0. They add a chip, never
      // another copy of the English.
      const cells = [cell(0, [word('God')], source({ strongsNumber: 'G26' }), [source({ strongsNumber: 'G3588', gloss: '' })])];

      render(<Layout cells={cells} />);

      expect(screen.getByText('G26')).toBeTruthy();
      expect(screen.getByText('G3588')).toBeTruthy();
    });

    it('titles a chip with the dictionary\'s brief meaning', () => {
      const cells = [cell(0, [word('love')])];

      render(<Layout cells={cells} strongsEntries={ENTRIES} />);

      expect(screen.getByText('G26').getAttribute('title')).toBe('love, goodwill');
    });

    it('falls back to the number when there is no entry', () => {
      const cells = [cell(0, [word('love')])];

      render(<Layout cells={cells} />);

      expect(screen.getByText('G26').getAttribute('title')).toBe('G26');
    });

    it('opens the dictionary on click', () => {
      const onStrongsClick = vi.fn();
      const cells = [cell(0, [word('love')])];

      render(<Layout cells={cells} onStrongsClick={onStrongsClick} />);
      fireEvent.click(screen.getByText('G26'));

      expect(onStrongsClick).toHaveBeenCalledWith('G26');
    });

    it('does not let the click reach the verse underneath', () => {
      // The verse is a click target too — without stopPropagation, looking up
      // a word also selects the verse and moves every linked pane.
      const onVerseClick = vi.fn();
      const cells = [cell(0, [word('love')])];

      render(<div onClick={onVerseClick}><Layout cells={cells} onStrongsClick={vi.fn()} /></div>);
      fireEvent.click(screen.getByText('G26'));

      expect(onVerseClick).not.toHaveBeenCalled();
    });

    it('reports the chip\'s position on hover so the popup can be placed', () => {
      const onStrongsHover = vi.fn();
      const cells = [cell(0, [word('love')])];

      render(<Layout cells={cells} onStrongsHover={onStrongsHover} />);
      fireEvent.mouseEnter(screen.getByText('G26'));

      expect(onStrongsHover).toHaveBeenCalledWith('G26', expect.objectContaining({ top: expect.any(Number) }));
    });

    it('reports the pointer leaving', () => {
      const onStrongsLeave = vi.fn();
      const cells = [cell(0, [word('love')])];

      render(<Layout cells={cells} onStrongsLeave={onStrongsLeave} />);
      fireEvent.mouseLeave(screen.getByText('G26'));

      expect(onStrongsLeave).toHaveBeenCalled();
    });

    it('renders no chip for a cell with no row', () => {
      const cells = [cell(0, [word('God')], null)];

      const { container } = render(<Layout cells={cells} />);

      expect(container.querySelector('.verse__strongs-link')).toBeNull();
    });

    it('survives every handler being omitted', () => {
      // The Study pane's interlinear section renders read-only.
      const cells = [cell(0, [word('love')])];

      render(<Layout cells={cells} />);

      expect(() => fireEvent.click(screen.getByText('G26'))).not.toThrow();
      expect(() => fireEvent.mouseEnter(screen.getByText('G26'))).not.toThrow();
      expect(() => fireEvent.mouseLeave(screen.getByText('G26'))).not.toThrow();
    });
  });

  describe(`${name} — original language`, () => {
    it('shows the original word and its transliteration', () => {
      const cells = [cell(0, [word('love')])];

      render(<Layout cells={cells} />);

      expect(screen.getByText('ἀγάπη')).toBeTruthy();
      expect(screen.getByText('agape')).toBeTruthy();
    });

    it('looks the word up on click, like the chip does', () => {
      // Inert here would make the Greek word — the most obvious thing to
      // click in an interlinear — do nothing.
      const onStrongsClick = vi.fn();
      const cells = [cell(0, [word('love')])];

      render(<Layout cells={cells} onStrongsClick={onStrongsClick} />);
      fireEvent.click(screen.getByText('ἀγάπη'));

      expect(onStrongsClick).toHaveBeenCalledWith('G26');
    });

    it('looks up from the transliteration too', () => {
      const onStrongsClick = vi.fn();
      const cells = [cell(0, [word('love')])];

      render(<Layout cells={cells} onStrongsClick={onStrongsClick} />);
      fireEvent.click(screen.getByText('agape'));

      expect(onStrongsClick).toHaveBeenCalledWith('G26');
    });

    it('marks the word clickable only when there is something to look up', () => {
      const withStrongs = render(<Layout cells={[cell(0, [word('love')])]} />);
      expect(withStrongs.container.querySelector('.verse__interlinear-original--clickable')).toBeTruthy();
      withStrongs.unmount();

      const withoutStrongs = render(
        <Layout cells={[cell(0, [word('love')], source({ strongsNumber: undefined }))]} />,
      );
      expect(withoutStrongs.container.querySelector('.verse__interlinear-original--clickable')).toBeNull();
      // Still rendered, just not interactive.
      expect(withoutStrongs.container.querySelector('.verse__interlinear-original')).toBeTruthy();
    });

    it('omits the transliteration when the row has none', () => {
      const cells = [cell(0, [word('love')], source({ transliteration: '' }))];

      const { container } = render(<Layout cells={cells} />);

      expect(container.querySelector('.verse__interlinear-translit')).toBeNull();
    });

    it('renders nothing original-language for an unclaimed cell', () => {
      const cells = [cell(0, [word('God')], null)];

      const { container } = render(<Layout cells={cells} />);

      expect(container.querySelector('.verse__interlinear-original')).toBeNull();
    });
  });
}

// ---- Stacked-only --------------------------------------------------------

describe('StackedInterlinear', () => {
  it('gives each cell its own column', () => {
    const cells = [cell(0, [word('For')], null), cell(1, [word('God')], null)];

    const { container } = render(<StackedInterlinear cells={cells} />);

    expect(container.querySelectorAll('.verse__interlinear-word')).toHaveLength(2);
  });

  it('searches the Strong\'s number when the English gloss is clicked', () => {
    // Clicking the English searches; clicking the Greek defines. Two different
    // questions a reader asks about the same word.
    const cells = [cell(0, [word('love')])];

    render(<StackedInterlinear cells={cells} />);
    fireEvent.click(screen.getByText('love'));

    expect(mockPerformSearch).toHaveBeenCalledWith('G26');
    expect(mockSetRightPaneMode).toHaveBeenCalledWith('search');
  });

  it('says what the gloss click will do', () => {
    const { container } = render(<StackedInterlinear cells={[cell(0, [word('love')])]} />);

    expect(container.querySelector('.verse__interlinear-gloss')?.getAttribute('title')).toBe('Search G26');
  });

  it('leaves the English inert when there is no number to search', () => {
    const cells = [cell(0, [word('God')], null)];

    const { container } = render(<StackedInterlinear cells={cells} />);
    const gloss = container.querySelector('.verse__interlinear-gloss')!;
    fireEvent.click(gloss);

    expect(gloss.classList.contains('verse__interlinear-gloss--clickable')).toBe(false);
    expect(gloss.getAttribute('title')).toBeNull();
    expect(mockPerformSearch).not.toHaveBeenCalled();
  });

  it('does not select the verse when the gloss is clicked', () => {
    const onVerseClick = vi.fn();

    render(<div onClick={onVerseClick}><StackedInterlinear cells={[cell(0, [word('love')])]} /></div>);
    fireEvent.click(screen.getByText('love'));

    expect(onVerseClick).not.toHaveBeenCalled();
  });
});

// ---- Inline-only ---------------------------------------------------------

describe('InlineInterlinear', () => {
  it('reads as prose, with the annotation in parentheses', () => {
    const cells = [cell(0, [word('God')], null), cell(1, [word('loved')])];

    const { container } = render(<InlineInterlinear cells={cells} />);

    expect(container.textContent).toBe('God loved(ἀγάπηagapeG26)');
  });

  it('separates cells with a space', () => {
    const cells = [cell(0, [word('For')], null), cell(1, [word('God')], null)];

    const { container } = render(<InlineInterlinear cells={cells} />);

    expect(container.textContent).toBe('For God');
  });

  it('does not open with a leading space', () => {
    const { container } = render(<InlineInterlinear cells={[cell(0, [word('For')], null)]} />);

    expect(container.textContent).toBe('For');
  });

  it('leaves out the parentheses when a cell has nothing to annotate', () => {
    // An empty "()" after every supplied word would be noise on 5% of the text.
    const cells = [cell(0, [word('God')], null)];

    const { container } = render(<InlineInterlinear cells={cells} />);

    expect(container.querySelector('.verse__interlinear-annotation')).toBeNull();
  });

  it('still annotates a row that has an original word but no Strong\'s number', () => {
    const cells = [cell(0, [word('love')], source({ strongsNumber: undefined }))];

    const { container } = render(<InlineInterlinear cells={cells} />);

    expect(container.querySelector('.verse__interlinear-annotation')).toBeTruthy();
    expect(container.textContent).toContain('ἀγάπη');
  });

  it('annotates a row that has a Strong\'s number but no original word', () => {
    const cells = [cell(0, [word('love')], source({ originalWord: '', transliteration: '' }))];

    const { container } = render(<InlineInterlinear cells={cells} />);

    expect(container.textContent).toBe('love(G26)');
  });
});
