/**
 * End-to-end (in jsdom) reproduction of "select Bible text -> highlight/underline".
 *
 * The user-visible bug was that the gesture did nothing at all, so this test
 * drives the whole real chain rather than any one link of it:
 *
 *   drag-select over two `.word` spans
 *     -> mouseup on the Bible text container (useBibleSelection)
 *     -> 50ms later showFloatingToolbar -> buildSelectionFromDOM (useBibleHighlights)
 *     -> FloatingAnnotationToolbar renders
 *     -> click a swatch / the underline button
 *     -> useHighlightStore.createHighlight -> repository.create
 *
 * The one thing that is *not* real here is the repository, which stands in for
 * the IPC round trip to the main process.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { UserTextMarkup, HIGHLIGHT_COLOR_HEX, normalizeMarkupColor } from '@bible/core';

/** What the renderer handed to the repository. */
const sent: UserTextMarkup[] = [];
/** What came back, i.e. what lands in the highlight store and gets rendered. */
const stored: UserTextMarkup[] = [];

vi.mock('../../services/highlightsAPI', () => ({
  IPCHighlightRepository: class {
    async getForVerseRange(): Promise<UserTextMarkup[]> { return []; }
    async getForModule(): Promise<UserTextMarkup[]> { return []; }
    async create(markup: UserTextMarkup): Promise<UserTextMarkup> {
      sent.push(markup);
      /*
        Faithful to the real round trip, and the reason this test exists:
        electron/ipc/highlightHandlers.ts runs the colour through
        validateMarkupColor and UserTextMarkupRepository.create writes
        normalizeMarkupColor(...), so what comes *back* is always canonical hex
- never the palette name the renderer sent.
      */
      const echo = new UserTextMarkup({
        ...markup,
        color: normalizeMarkupColor(markup.color),
        markupId: stored.length + 1,
      });
      stored.push(echo);
      return echo;
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
  Harness,
  MODULE_ID,
  PSALM_3_1,
  selectFirstTwoWords,
  installRangeLayoutStubs,
  installResizeObserverStub,
} from './highlightFlowHarness';

installRangeLayoutStubs();

describe('Bible text selection -> floating annotation toolbar', () => {
  beforeEach(() => {
    sent.length = 0;
    stored.length = 0;
    useHighlightStore.setState({ highlightsByModule: new Map(), lastUsedColor: 'yellow' });
    vi.useFakeTimers();
    installResizeObserverStub();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.getSelection()?.removeAllRanges();
  });

  it('shows the toolbar after a drag-select finishes', async () => {
    render(<Harness />);

    await selectFirstTwoWords(true);

    expect(screen.getByLabelText(enString('ui.floatingAnnotation.highlightYellow'))).toBeInTheDocument();
  });

  it('creates a highlight covering the selected words when a swatch is clicked', async () => {
    render(<Harness />);
    await selectFirstTwoWords(true);

    await act(async () => {
      fireEvent.click(screen.getByLabelText(enString('ui.floatingAnnotation.highlightGreen')));
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].moduleId).toBe(MODULE_ID);
    expect(sent[0].verseIdStart).toBe(PSALM_3_1);
    // Single-verse selection: no explicit end verse.
    expect(sent[0].verseIdEnd).toBeUndefined();
    expect(sent[0].textStart).toBe(0);
    expect(sent[0].textEnd).toBe(1);
    expect(sent[0].color).toBe('green');
    expect(sent[0].metadata?.markupType).toBe('highlight');
  });

  it('creates an underline when the underline button is clicked', async () => {
    render(<Harness />);
    await selectFirstTwoWords(true);

    await act(async () => {
      fireEvent.click(screen.getByLabelText(enString('ui.floatingAnnotation.toggleUnderline')));
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].verseIdStart).toBe(PSALM_3_1);
    expect(sent[0].textStart).toBe(0);
    expect(sent[0].textEnd).toBe(1);
    expect(sent[0].metadata?.markupType).toBe('underline');
    expect(sent[0].metadata?.underlineStyle).toBe('solid');
  });

  /*
    The bug the user reported as "highlighting does nothing". The markup was
    created and saved fine; it just rendered invisibly, because the stylesheet
    is keyed by palette name (`.highlight-yellow`) while the stored colour is
    canonical hex - producing the class `highlight-#FFF3A3`, which matches no
    rule. On dark themes it was worse than nothing: the substring selector
    `[class*="highlight-"]` still matched and darkened the text to near-black
    against a dark page with no wash behind it.
  */
  it('renders a palette highlight with its NAME class, not the stored hex', async () => {
    render(<Harness />);
    await selectFirstTwoWords(true);

    await act(async () => {
      fireEvent.click(screen.getByLabelText(enString('ui.floatingAnnotation.highlightYellow')));
    });

    expect(stored[0].color).toBe(HIGHLIGHT_COLOR_HEX.yellow.toUpperCase());

    const words = document.querySelectorAll<HTMLElement>('.word');
    expect(words[0].className).toContain('highlight-yellow');
    expect(words[1].className).toContain('highlight-yellow');
    expect(words[0].className).not.toContain(HIGHLIGHT_COLOR_HEX.yellow);
    expect(words[2].className).not.toContain('highlight-');
  });

  it('renders an underline with its palette colour class', async () => {
    render(<Harness />);
    await selectFirstTwoWords(true);

    await act(async () => {
      fireEvent.click(screen.getByLabelText(enString('ui.floatingAnnotation.toggleUnderline')));
    });

    const words = document.querySelectorAll<HTMLElement>('.word');
    expect(words[0].className).toContain('underline-solid');
    expect(words[0].className).toContain('underline-color-yellow');
  });

  /*
    A colour outside the six-swatch palette has no stylesheet rule at all, so it
    has to be painted inline rather than dropped on the floor.
  */
  it('paints a custom (non-palette) colour inline', async () => {
    render(<Harness />);
    await selectFirstTwoWords(true);

    await act(async () => {
      await useHighlightStore.getState().createHighlight(
        new UserTextMarkup({
          moduleId: MODULE_ID,
          verseIdStart: PSALM_3_1,
          textStart: 0,
          textEnd: 0,
          color: '#123456',
          metadata: { markupType: 'highlight', version: 1 },
        }),
        // The harness's repository instance is the mocked one.
        new (await import('../../services/highlightsAPI')).IPCHighlightRepository(),
      );
    });

    const words = document.querySelectorAll<HTMLElement>('.word');
    expect(words[0].getAttribute('style')).toContain('#123456');
  });
});
