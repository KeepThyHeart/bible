import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InterlinearDisplay, { toDisplayHtml } from './InterlinearDisplay';
import type { InterlinearWord } from './interlinearCells';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import { dictionaryAPI } from '../../services/electronAPI';
import { useHighlightStore } from '../../stores/useHighlightStore';
import { useSearchStore } from '../../stores/useSearchStore';
import { UserTextMarkup } from '@bible/core';

// Mock the dictionaryAPI
vi.mock('../../services/electronAPI', () => ({
  dictionaryAPI: {
    getEntryByKey: vi.fn().mockResolvedValue(null),
  },
}));

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string) => key,
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

const VERSE_ID = 43003016;
const MODULE_ID = 7;

interface RenderOptions {
  interlinearWords: InterlinearWord[];
  englishText: string;
  layout: 'stacked' | 'inline';
  onStrongsClick?: (strongsNumber: string) => void;
  verseId?: number;
  moduleId?: number;
}

function renderInterlinear(options: RenderOptions) {
  const { verseId = VERSE_ID, moduleId = MODULE_ID, ...rest } = options;
  return render(
    <ContextProvider services={createMockServices()}>
      <div data-verse-id={verseId}>
        <InterlinearDisplay {...rest} verseId={verseId} moduleId={moduleId} />
      </div>
    </ContextProvider>
  );
}

/** The `data-word-index` values actually rendered, in document order. */
function renderedWordIndices(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('.word[data-word-index]')).map(el =>
    Number(el.getAttribute('data-word-index'))
  );
}

// Positions are 0-based inclusive indices into the English word sequence.
const mockWords: InterlinearWord[] = [
  {
    wordPositionStart: 0,
    wordPositionEnd: 0,
    originalWord: 'Οὕτως',
    transliteration: 'Houtōs',
    strongsNumber: 'G3779',
    morphology: 'ADV',
    gloss: 'So',
  },
  {
    wordPositionStart: 1,
    wordPositionEnd: 1,
    originalWord: 'γὰρ',
    transliteration: 'gar',
    strongsNumber: 'G1063',
    morphology: 'CONJ',
    gloss: 'for',
  },
];

describe('InterlinearDisplay', () => {
  const onStrongsClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useHighlightStore.setState({ highlightsByModule: new Map() });
  });

  it('renders the English text when no interlinear words', () => {
    const { container } = renderInterlinear({
      interlinearWords: [],
      englishText: 'For God so loved the world',
      layout: 'stacked',
    });
    expect(container.textContent).toContain('For God so loved the world');
    // Still fully highlightable: one addressable span per English word.
    expect(renderedWordIndices(container)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('renders original words in stacked layout', () => {
    renderInterlinear({ interlinearWords: mockWords, englishText: 'So for', layout: 'stacked' });
    expect(screen.getByText('Οὕτως')).toBeInTheDocument();
    expect(screen.getByText('γὰρ')).toBeInTheDocument();
  });

  it('renders the English tokens in stacked layout', () => {
    renderInterlinear({ interlinearWords: mockWords, englishText: 'So for', layout: 'stacked' });
    expect(screen.getByText('So')).toBeInTheDocument();
    expect(screen.getByText('for')).toBeInTheDocument();
  });

  it("renders Strong's numbers as clickable buttons", () => {
    renderInterlinear({
      interlinearWords: mockWords,
      englishText: 'So for',
      layout: 'stacked',
      onStrongsClick,
    });
    expect(screen.getAllByTestId('strongs-number').length).toBe(2);
  });

  it("calls onStrongsClick when Strong's number is clicked", async () => {
    const user = userEvent.setup();
    renderInterlinear({
      interlinearWords: mockWords,
      englishText: 'So for',
      layout: 'stacked',
      onStrongsClick,
    });
    await user.click(screen.getAllByTestId('strongs-number')[0]);
    expect(onStrongsClick).toHaveBeenCalledWith('G3779');
  });

  it('renders in inline layout', () => {
    renderInterlinear({
      interlinearWords: mockWords,
      englishText: 'So for',
      layout: 'inline',
      onStrongsClick,
    });
    expect(screen.getByText('Οὕτως')).toBeInTheDocument();
  });

  it('renders transliterations in stacked layout', () => {
    renderInterlinear({ interlinearWords: mockWords, englishText: 'So for', layout: 'stacked' });
    expect(screen.getByText('Houtōs')).toBeInTheDocument();
    expect(screen.getByText('gar')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // Word-index emission: the contract highlighting, underlining and
  // find-in-page all key off. Assertions are exact - a `> 0` count here
  // would pass while silently dropping half the verse.
  // ---------------------------------------------------------------------
  describe('word index emission', () => {
    // Genesis 1:9 (KJV): 25 English words, but the interlinear rows cover only
    // 0..18 and 20 - index 19 ("land") is a supplied word and 21..24 ("and it
    // was so.") has no interlinear data at all.
    const GEN_1_9 =
      'And God said, Let the waters under the heaven be gathered together unto one ' +
      'place, and let the dry land appear: and it was so.';
    const GEN_1_9_ROWS: InterlinearWord[] = [
      { wordPositionStart: 0, wordPositionEnd: 1, originalWord: '', strongsNumber: 'H0430', gloss: 'And God' },
      { wordPositionStart: 2, wordPositionEnd: 2, originalWord: '', strongsNumber: 'H0559', gloss: 'said,' },
      { wordPositionStart: 3, wordPositionEnd: 5, originalWord: '', strongsNumber: 'H04325', gloss: 'Let the waters' },
      { wordPositionStart: 6, wordPositionEnd: 8, originalWord: '', strongsNumber: 'H08064', gloss: 'under the heaven' },
      { wordPositionStart: 9, wordPositionEnd: 11, originalWord: '', strongsNumber: 'H06960', gloss: 'be gathered together' },
      { wordPositionStart: 12, wordPositionEnd: 12, originalWord: '', strongsNumber: 'H0413', gloss: 'unto' },
      { wordPositionStart: 13, wordPositionEnd: 13, originalWord: '', strongsNumber: 'H0259', gloss: 'one' },
      { wordPositionStart: 14, wordPositionEnd: 14, originalWord: '', strongsNumber: 'H04725', gloss: 'place,' },
      { wordPositionStart: 15, wordPositionEnd: 18, originalWord: '', strongsNumber: 'H03004', gloss: 'and let the dry' },
      { wordPositionStart: 20, wordPositionEnd: 20, originalWord: '', strongsNumber: 'H07200', gloss: 'appear:' },
    ];

    for (const layout of ['stacked', 'inline'] as const) {
      it(`emits every English index exactly once in ${layout} layout`, () => {
        const { container } = renderInterlinear({
          interlinearWords: GEN_1_9_ROWS,
          englishText: GEN_1_9,
          layout,
        });
        expect(renderedWordIndices(container)).toEqual(Array.from({ length: 25 }, (_, i) => i));
      });

      it(`renders words no interlinear row claims in ${layout} layout`, () => {
        const { container } = renderInterlinear({
          interlinearWords: GEN_1_9_ROWS,
          englishText: GEN_1_9,
          layout,
        });
        // A renderer that emits one block per interlinear row and nothing else
        // would silently delete these words from the display.
        const text = container.textContent ?? '';
        expect(text).toContain('land');
        expect(text).toContain('and it was so.');
      });
    }

    it('does not put data-word-index on original-language, transliteration or Strong\'s lines', () => {
      const { container } = renderInterlinear({
        interlinearWords: mockWords,
        englishText: 'So for',
        layout: 'stacked',
      });
      expect(container.querySelector('[data-testid="interlinear-original"][data-word-index]')).toBeNull();
      expect(container.querySelector('[data-testid="interlinear-transliteration"][data-word-index]')).toBeNull();
      expect(container.querySelector('[data-testid="strongs-number"][data-word-index]')).toBeNull();
      // ...and only English tokens carry `.word`, which is what the selection
      // code queries, so dragging over Greek text can't map onto English indices.
      expect(container.querySelectorAll('.word').length).toBe(2);
    });

    it('shows a null-gloss row as an extra Strong\'s chip without duplicating the English', () => {
      // John 3:16's three rows at [0,0]: two carry no gloss.
      const { container } = renderInterlinear({
        interlinearWords: [
          { wordPositionStart: 0, wordPositionEnd: 0, originalWord: 'ο', strongsNumber: 'G3588' },
          { wordPositionStart: 0, wordPositionEnd: 0, originalWord: 'τον', strongsNumber: 'G3588' },
          { wordPositionStart: 0, wordPositionEnd: 0, originalWord: 'γαρ', strongsNumber: 'G1063', gloss: 'For' },
          { wordPositionStart: 1, wordPositionEnd: 1, originalWord: 'ο', strongsNumber: 'G3588', gloss: 'God' },
        ],
        englishText: 'For God',
        layout: 'stacked',
      });

      expect(renderedWordIndices(container)).toEqual([0, 1]);
      expect(screen.getAllByText('For').length).toBe(1);
      // G1063 + the two demoted G3588s on cell 0, plus G3588 on cell 1.
      expect(screen.getAllByTestId('strongs-number').map(b => b.textContent)).toEqual([
        'G1063', 'G3588', 'G3588', 'G3588',
      ]);
    });
  });

  // ---------------------------------------------------------------------
  // Highlight and underline painting - the whole point of the rewrite.
  // ---------------------------------------------------------------------
  describe('highlight and underline rendering', () => {
    function seedMarkup(markup: UserTextMarkup) {
      useHighlightStore.setState({ highlightsByModule: new Map([[MODULE_ID, [markup]]]) });
    }

    for (const layout of ['stacked', 'inline'] as const) {
      it(`paints a stored highlight on exactly the covered words in ${layout} layout`, () => {
        seedMarkup(new UserTextMarkup({
          markupId: 1,
          moduleId: MODULE_ID,
          verseIdStart: VERSE_ID,
          textStart: 1,
          textEnd: 2,
          color: '#FFF3A3',
          metadata: { markupType: 'highlight', version: 1 },
        }));

        const { container } = renderInterlinear({
          interlinearWords: [
            { wordPositionStart: 0, wordPositionEnd: 1, originalWord: '', strongsNumber: 'H1', gloss: 'And God' },
            { wordPositionStart: 2, wordPositionEnd: 3, originalWord: '', strongsNumber: 'H2', gloss: 'said, Let' },
          ],
          englishText: 'And God said, Let',
          layout,
        });

        const highlighted = Array.from(container.querySelectorAll('.word.highlighted')).map(el =>
          Number(el.getAttribute('data-word-index'))
        );
        // Exactly 1 and 2 - crucially spanning the cell boundary between
        // [0,1] and [2,3], which is only possible with per-word granularity.
        expect(highlighted).toEqual([1, 2]);
        expect(container.querySelector('.word[data-word-index="1"]')?.className).toContain('highlight-yellow');
        expect(container.querySelector('.word[data-word-index="0"]')?.className).not.toContain('highlighted');
      });

      it(`paints a stored underline on exactly the covered words in ${layout} layout`, () => {
        seedMarkup(new UserTextMarkup({
          markupId: 2,
          moduleId: MODULE_ID,
          verseIdStart: VERSE_ID,
          textStart: 0,
          textEnd: 0,
          color: '#FFF3A3',
          metadata: {
            markupType: 'underline',
            underlineStyle: 'wavy',
            underlineColor: 'blue',
            version: 1,
          },
        }));

        const { container } = renderInterlinear({
          interlinearWords: [
            { wordPositionStart: 0, wordPositionEnd: 1, originalWord: '', strongsNumber: 'H1', gloss: 'And God' },
          ],
          englishText: 'And God',
          layout,
        });

        const first = container.querySelector('.word[data-word-index="0"]');
        expect(first?.className).toContain('underline-wavy');
        expect(first?.className).toContain('underline-color-blue');
        expect(container.querySelector('.word[data-word-index="1"]')?.className).not.toContain('underline');
      });
    }

    it('carries data-markup-id so remove-formatting can find the markup', () => {
      seedMarkup(new UserTextMarkup({
        markupId: 42,
        moduleId: MODULE_ID,
        verseIdStart: VERSE_ID,
        textStart: 0,
        textEnd: 0,
        color: '#FFF3A3',
        metadata: { markupType: 'highlight', version: 1 },
      }));

      const { container } = renderInterlinear({
        interlinearWords: [
          { wordPositionStart: 0, wordPositionEnd: 0, originalWord: '', strongsNumber: 'H1', gloss: 'And' },
        ],
        englishText: 'And God',
        layout: 'stacked',
      });

      expect(container.querySelector('.word[data-word-index="0"]')?.getAttribute('data-markup-id')).toBe('42');
      expect(container.querySelector('.word[data-word-index="1"]')?.hasAttribute('data-markup-id')).toBe(false);
    });

    it('paints a non-palette colour inline, since no stylesheet rule can key off it', () => {
      seedMarkup(new UserTextMarkup({
        markupId: 3,
        moduleId: MODULE_ID,
        verseIdStart: VERSE_ID,
        textStart: 0,
        textEnd: 0,
        color: '#123456',
        metadata: { markupType: 'highlight', version: 1 },
      }));

      const { container } = renderInterlinear({
        interlinearWords: [
          { wordPositionStart: 0, wordPositionEnd: 0, originalWord: '', strongsNumber: 'H1', gloss: 'And' },
        ],
        englishText: 'And God',
        layout: 'stacked',
      });

      const word = container.querySelector<HTMLElement>('.word[data-word-index="0"]');
      expect(word?.style.backgroundColor).toBe('rgb(18, 52, 86)');
    });

    it('ignores markup belonging to a different module', () => {
      useHighlightStore.setState({
        highlightsByModule: new Map([[
          MODULE_ID + 1,
          [new UserTextMarkup({
            markupId: 9,
            moduleId: MODULE_ID + 1,
            verseIdStart: VERSE_ID,
            textStart: 0,
            textEnd: 5,
            color: '#FFF3A3',
            metadata: { markupType: 'highlight', version: 1 },
          })],
        ]]),
      });

      const { container } = renderInterlinear({
        interlinearWords: [
          { wordPositionStart: 0, wordPositionEnd: 0, originalWord: '', strongsNumber: 'H1', gloss: 'And' },
        ],
        englishText: 'And God',
        layout: 'stacked',
      });

      expect(container.querySelectorAll('.word.highlighted').length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------
  // OSIS/SWORD markup must never reach the DOM as literal text; <divineName>
  // specifically renders as a styled span rather than being stripped
  // ---------------------------------------------------------------------
  describe('OSIS/SWORD markup sanitization', () => {
    it('renders divineName content in a styled span on the word token', () => {
      const { container } = renderInterlinear({
        interlinearWords: [
          { wordPositionStart: 0, wordPositionEnd: 2, originalWord: '', strongsNumber: 'H03068', gloss: 'which the Lord' },
        ],
        englishText: 'which the <divineName>Lord</divineName> God had made',
        layout: 'stacked',
      });

      // Asserted per token, not on the whole textContent: in the stacked
      // layout the Strong's chips sit between the English columns.
      expect(
        Array.from(container.querySelectorAll('.word[data-word-index]')).map(el => el.textContent)
      ).toEqual(['which', 'the', 'Lord', 'God', 'had', 'made']);
      const word = container.querySelector('.word[data-word-index="2"]');
      expect(word?.className).toContain('divine-name');
      expect(word?.textContent).toBe('Lord');
      expect(container.innerHTML).not.toContain('divineName');
    });

    it('renders divineName in the styled span when there is no interlinear data', () => {
      const { container } = renderInterlinear({
        interlinearWords: [],
        englishText: 'which the <divineName>Lord</divineName> God had made',
        layout: 'stacked',
      });
      expect(container.textContent).toContain('which the Lord God had made');
      expect(container.querySelector('.word.divine-name')).toHaveTextContent('Lord');
      expect(container.innerHTML).not.toContain('divineName');
    });

    it('accepts pre-formatted text_html without double-processing it', () => {
      // What StudyModeView actually passes: formatVerseText() output.
      const { container } = renderInterlinear({
        interlinearWords: [],
        englishText: 'which the <span class="divine-name">Lord</span> God had made',
        layout: 'stacked',
      });
      expect(container.textContent).toContain('which the Lord God had made');
      expect(renderedWordIndices(container)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(container.querySelector('.word.divine-name')).toHaveTextContent('Lord');
    });

    it('still strips non-divineName OSIS tags to plain text', () => {
      const { container } = renderInterlinear({
        interlinearWords: [
          { wordPositionStart: 0, wordPositionEnd: 0, originalWord: '', strongsNumber: 'G26', gloss: 'love' },
        ],
        englishText: '<transChange type="added">love</transChange>',
        layout: 'stacked',
      });
      expect(container.textContent).toContain('love');
      expect(container.querySelector('.divine-name')).toBeNull();
      expect(container.innerHTML).not.toContain('transChange');
    });

    it('carries the christ-words class through onto the word tokens', () => {
      const { container } = renderInterlinear({
        interlinearWords: [
          { wordPositionStart: 0, wordPositionEnd: 1, originalWord: '', strongsNumber: 'G1473', gloss: 'I am' },
        ],
        englishText: '<span class="christ-words">I am</span> he',
        layout: 'stacked',
      });
      expect(container.querySelector('.word[data-word-index="0"]')?.className).toContain('christ-words');
      expect(container.querySelector('.word[data-word-index="2"]')?.className).not.toContain('christ-words');
    });
  });

  // ---------------------------------------------------------------------
  // Strong's hover tooltip must work in stacked layout even when
  // original_word is NULL (every shipped KJV-family module)
  // ---------------------------------------------------------------------
  describe("Strong's hover tooltip reachability", () => {
    const wordWithoutOriginal: InterlinearWord = {
      wordPositionStart: 0,
      wordPositionEnd: 0,
      originalWord: '',
      strongsNumber: 'G3779',
      gloss: 'So',
    };

    it('shows the tooltip on hover in stacked layout when originalWord is empty', async () => {
      renderInterlinear({
        interlinearWords: [wordWithoutOriginal],
        englishText: 'So',
        layout: 'stacked',
      });
      // Sanity check: the conditionally-rendered original-word line is absent,
      // the one case a handler placed on that line could never reach.
      expect(screen.queryByTestId('interlinear-original')).not.toBeInTheDocument();

      fireEvent.mouseEnter(screen.getByTestId('interlinear-word'));

      await waitFor(() => {
        expect(screen.getByText(/No Strong's entry found for G3779/)).toBeInTheDocument();
      });
    });

    /**
     * Genesis 1:1's "created" is H01254 plus the accusative marker H0853, both
     * pinned to one cell. The hover handler on the cell can only ever name one
     * of them, and React synthesises `mouseenter` up its own tree - so pointing
     * at the *second* chip would fire the cell's handler and preview the
     * first number instead - indistinguishable from a tooltip bug rather than
     * a wiring one. Clicking is always right, because each chip closes over
     * its own number.
     */
    describe.each(['stacked', 'inline'] as const)('two Strongs numbers on one cell (%s)', layout => {
      const created: InterlinearWord[] = [
        {
          wordPositionStart: 0,
          wordPositionEnd: 0,
          originalWord: 'בָּרָא',
          strongsNumber: 'H01254',
          gloss: 'created',
        },
        {
          wordPositionStart: 0,
          wordPositionEnd: 0,
          originalWord: 'אֵת',
          strongsNumber: 'H0853',
          gloss: '',
        },
      ];

      it('previews the number of the chip actually hovered', async () => {
        renderInterlinear({ interlinearWords: created, englishText: 'created', layout });

        const chips = screen.getAllByTestId('strongs-number');
        expect(chips.map(c => c.textContent)).toEqual(['H01254', 'H0853']);

        fireEvent.mouseEnter(chips[1]!);

        await waitFor(() => {
          expect(screen.getByText(/No Strong's entry found for H0853/)).toBeInTheDocument();
        });
        expect(screen.queryByText(/No Strong's entry found for H01254/)).not.toBeInTheDocument();
      });
    });

    it('shows the tooltip on hover in inline layout when originalWord is empty', async () => {
      renderInterlinear({
        interlinearWords: [wordWithoutOriginal],
        englishText: 'So',
        layout: 'inline',
      });
      const strongsButton = screen.getByTestId('strongs-number');
      fireEvent.mouseEnter(strongsButton.parentElement!);

      await waitFor(() => {
        expect(screen.getByText(/No Strong's entry found for G3779/)).toBeInTheDocument();
      });
    });
  });

  // ---------------------------------------------------------------------
  // Strong's tooltip content: structured fields, full glosses,
  // boilerplate stripped before truncation
  // ---------------------------------------------------------------------
  describe("Strong's tooltip content", () => {
    // Distinct Strong's numbers per test: the preview cache is module-level
    // and keyed by strongsNumber, so reusing one across tests would make the
    // second test see the first test's cached (mocked) entry.
    function wordFor(strongsNumber: string): InterlinearWord {
      return {
        wordPositionStart: 0,
        wordPositionEnd: 0,
        originalWord: 'ἀγάπη',
        strongsNumber,
        gloss: 'love',
      };
    }

    async function hoverAndWaitForContent(word: InterlinearWord) {
      renderInterlinear({ interlinearWords: [word], englishText: 'love', layout: 'stacked' });
      fireEvent.mouseEnter(screen.getByTestId('interlinear-word'));
      await waitFor(() => {
        expect(screen.getByTestId('strongs-tooltip-content')).toBeInTheDocument();
      });
    }

    it('strips the boilerplate header from the description and shows glosses in full', async () => {
      vi.mocked(dictionaryAPI.getEntryByKey).mockResolvedValueOnce({
        word: 'agape',
        // Real StrongsGreek-style blob: "NUMBER GREEK translit pron {pron}" header,
        // then description, then ":--" glosses.
        definition:
          '0025 ἀγάπη agape ag-ah\'-pay {ag-ah\'-pay} from 25; love, i.e. affection or benevolence; specially (plural) a love-feast:--(feast of) charity(-ably), dear, love.',
      });

      await hoverAndWaitForContent(wordFor('G0025'));

      const description = screen.getByTestId('strongs-tooltip-def').textContent ?? '';
      expect(description).not.toMatch(/^0025/);
      expect(description).not.toContain('ag-ah');

      const glosses = screen.getByTestId('strongs-tooltip-glosses');
      // The full gloss list survives untruncated; a 200-char budget spent on
      // the whole raw blob (boilerplate included) would cut it short instead.
      expect(glosses.textContent).toContain('charity(-ably), dear, love');
    });

    it('shows transliteration and part of speech when the IPC entry provides them', async () => {
      vi.mocked(dictionaryAPI.getEntryByKey).mockResolvedValueOnce({
        word: 'agape',
        transliteration: 'agape',
        pronunciation: "ag-ah'-pay",
        part_of_speech: 'noun feminine',
        definition: 'from 25; love, affection:--charity, dear, love.',
      });

      await hoverAndWaitForContent(wordFor('G0026'));

      expect(screen.getByTestId('strongs-tooltip-translit')).toHaveTextContent('agape');
      expect(screen.getByTestId('strongs-tooltip-pos')).toHaveTextContent('noun feminine');
    });
  });

  // ---------------------------------------------------------------------
  // "Search all occurrences": the tooltip's route from a word to every
  // place it is used. Before this existed the only way to run a Strong's
  // search on desktop was to know the syntax and retype the number into the
  // search bar - clicking the chip opens the dictionary, not a search.
  // ---------------------------------------------------------------------
  describe("Strong's search-all-occurrences action", () => {
    function wordFor(strongsNumber: string): InterlinearWord {
      return {
        wordPositionStart: 0,
        wordPositionEnd: 0,
        originalWord: 'ἀγάπη',
        strongsNumber,
        gloss: 'love',
      };
    }

    async function hoverAndWaitForButton(strongsNumber: string) {
      renderInterlinear({
        interlinearWords: [wordFor(strongsNumber)],
        englishText: 'love',
        layout: 'stacked',
      });
      fireEvent.mouseEnter(screen.getByTestId('interlinear-word'));
      await waitFor(() => {
        expect(screen.getByTestId('strongs-search-occurrences')).toBeInTheDocument();
      });
    }

    it("runs a Strong's search for the hovered number and closes the tooltip", async () => {
      const searchStrongsNumber = vi.fn().mockResolvedValue(undefined);
      useSearchStore.setState({ searchStrongsNumber });

      await hoverAndWaitForButton('G26');
      fireEvent.click(screen.getByTestId('strongs-search-occurrences'));

      expect(searchStrongsNumber).toHaveBeenCalledWith('G26');
      await waitFor(() => {
        expect(screen.queryByTestId('strongs-search-occurrences')).not.toBeInTheDocument();
      });
    });

    it('offers the action even when the dictionary has no entry', async () => {
      // A Strong's search reads the interlinear index, not the dictionary, so
      // a missing lexicon entry must not remove the only way to run one.
      const searchStrongsNumber = vi.fn().mockResolvedValue(undefined);
      useSearchStore.setState({ searchStrongsNumber });
      vi.mocked(dictionaryAPI.getEntryByKey).mockResolvedValueOnce(null);

      await hoverAndWaitForButton('G27');
      fireEvent.click(screen.getByTestId('strongs-search-occurrences'));

      expect(searchStrongsNumber).toHaveBeenCalledWith('G27');
    });

    it('is absent while the lookup is still in flight', () => {
      useSearchStore.setState({ searchStrongsNumber: vi.fn() });
      vi.mocked(dictionaryAPI.getEntryByKey).mockReturnValueOnce(new Promise(() => {}) as never);

      renderInterlinear({
        interlinearWords: [wordFor('G28')],
        englishText: 'love',
        layout: 'stacked',
      });
      fireEvent.mouseEnter(screen.getByTestId('interlinear-word'));

      expect(screen.queryByTestId('strongs-search-occurrences')).not.toBeInTheDocument();
    });
  });
});


// ==========================================================================
// toDisplayHtml() - pure helper, tested directly without mounting the
// component. It defines the token sequence highlights are indexed against, so
// it must produce the same HTML shape formatVerseText() does regardless of
// whether it was handed raw `text` or already-formatted `text_html`.
// ==========================================================================
describe('toDisplayHtml', () => {
  it('returns plain text unchanged when there is no markup', () => {
    expect(toDisplayHtml('For God so loved the world')).toBe('For God so loved the world');
  });

  it('turns divineName into a styled span', () => {
    expect(toDisplayHtml('the <divineName>LORD</divineName> reigns')).toBe(
      'the <span class="divine-name">LORD</span> reigns'
    );
  });

  it('strips other OSIS tags while preserving divineName', () => {
    expect(
      toDisplayHtml('<transChange type="added">the</transChange> <divineName>LORD</divineName> our God')
    ).toBe('the <span class="divine-name">LORD</span> our God');
  });

  it('converts every occurrence, not just the first', () => {
    expect(
      toDisplayHtml('<divineName>LORD</divineName> said unto my <divineName>Lord</divineName>')
    ).toBe(
      '<span class="divine-name">LORD</span> said unto my <span class="divine-name">Lord</span>'
    );
  });

  it('strips OSIS tags nested inside a divineName', () => {
    expect(toDisplayHtml('the <divineName><hi type="bold">LORD</hi></divineName> reigns')).toBe(
      'the <span class="divine-name">LORD</span> reigns'
    );
  });

  it('is idempotent on already-formatted text_html', () => {
    const formatted = 'the <span class="divine-name">Lord</span> reigns';
    expect(toDisplayHtml(formatted)).toBe(formatted);
  });

  it('returns an empty string for empty input', () => {
    expect(toDisplayHtml('')).toBe('');
  });
});
