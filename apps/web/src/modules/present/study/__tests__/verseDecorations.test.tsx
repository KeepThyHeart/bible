// @vitest-environment jsdom
/**
 * The Presenter's marks in the Study reader, moved out of VerseRenderer
 * (task 0123): VerseRenderer takes a `decoration` and these tests render it
 * with the pieces `presentVerseDecorator` builds (the follow-along class and
 * highlighted words, the send rail, the tappable words on the active verse).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import type { VerseData } from '../../../../types';
import type { VerseDecoration } from '../../../../host/slots';
import type { HighlightRange } from '../../lib/protocol';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

let mockWordsOfChristInRed = false;

vi.mock('../../../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

vi.mock('../../../../stores/settingsStore', () => ({
  settingsStore: {
    get wordsOfChristInRed() { return mockWordsOfChristInRed; },
    get interlinearLayout() { return 'inline'; },
  },
}));

vi.mock('../../../../stores/searchStore', () => ({ searchStore: { performSearch: vi.fn() } }));
vi.mock('../../../../stores/commentaryStore', () => ({ commentaryStore: { setRightPaneMode: vi.fn() } }));

import { VerseRenderer } from '../../../../components/BiblePane/VerseRenderer';
import {
  FollowHighlightedText, HIGHLIGHT_HOLD_MS, PresenterWords, SendRailButton,
} from '../verseDecorations';
import type { WordHighlightProps } from '../verseDecorations';

function makeVerse(overrides: Partial<VerseData> = {}): VerseData {
  return {
    verse_id: 43003016,
    book_number: 43,
    chapter: 3,
    verse: 16,
    text: 'For God so loved the world',
    text_html: 'For God so loved the world',
    is_paragraph_start: false,
    words_of_christ: false,
    ...overrides,
  };
}

const defaultProps = {
  isHighlighted: false,
  showVerseNumbers: true,
  displayMode: 'standard' as const,
  onVerseClick: vi.fn(),
};

/** What presentVerseDecorator returns for a followed verse: the class, plus the lit words when there are any. */
function follow(verse: VerseData, highlights: HighlightRange[] = []): VerseDecoration {
  return {
    classes: ['verse--follow-live'],
    text: highlights.length > 0
      ? <FollowHighlightedText html={verse.text_html} verseId={verse.verse_id} highlights={highlights} />
      : undefined,
  };
}

/** What it returns for a verse while presenting: the send rail, and the green class on the sent verse. */
function rail(sent: boolean, onSend: () => void, label: string): VerseDecoration {
  return { classes: sent ? ['verse--sent'] : [], rail: <SendRailButton rail={{ sent, onSend, label }} /> };
}

/** ... and, on the active verse only, the tappable words. */
function activeWords(verse: VerseData, wordHighlight: WordHighlightProps): VerseDecoration {
  return { classes: [], text: <PresenterWords html={verse.text_html} verseId={verse.verse_id} wordHighlight={wordHighlight} /> };
}

describe('Presenter verse decorations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWordsOfChristInRed = false;
  });

  // ------------------------------------------------------------------
  // Following along (the follow decoration: class + highlighted words)
  // ------------------------------------------------------------------
  describe('following along', () => {
    it('marks the followed verse without changing how it renders', () => {
      const verse = makeVerse({ text_html: 'For God so loved the world' });
      const { container } = render(<VerseRenderer verse={verse} {...defaultProps} decoration={follow(verse)} />);
      expect(container.querySelector('.verse--follow-live')).toBeTruthy();
      expect(container.innerHTML).toContain('For God so loved the world');
    });

    it('does not mark a verse the presenter is not on', () => {
      const verse = makeVerse();
      const { container } = render(<VerseRenderer verse={verse} {...defaultProps} />);
      expect(container.querySelector('.verse--follow-live')).toBeNull();
    });

    it('renders the presenter\'s highlighted words on the followed verse', () => {
      const verse = makeVerse({ verse_id: 43003016, text_html: 'For God so loved the world' });
      const { container } = render(
        <VerseRenderer verse={verse} {...defaultProps} decoration={follow(verse, [{ verseIdStart: 43003016, textStart: 1, textEnd: 2 }])} />,
      );
      const words = container.querySelectorAll('.verse__follow-word');
      expect(words.length).toBe(6); // "For God so loved the world"
      expect(words[1].className).toContain('verse__follow-word--hl');
      expect(words[2].className).toContain('verse__follow-word--hl');
      expect(words[0].className).not.toContain('verse__follow-word--hl');
      expect(container.textContent).toContain('For God so loved the world');
    });

    it('lights more than one highlighted phrase in the same verse', () => {
      const verse = makeVerse({ verse_id: 43003016, text_html: 'For God so loved the world' });
      const { container } = render(
        <VerseRenderer verse={verse} {...defaultProps} decoration={follow(verse, [ { verseIdStart: 43003016, textStart: 0, textEnd: 0 }, { verseIdStart: 43003016, textStart: 4, textEnd: 5 }, ])} />,
      );
      const words = container.querySelectorAll('.verse__follow-word');
      expect(words[0].className).toContain('verse__follow-word--hl');
      expect(words[4].className).toContain('verse__follow-word--hl');
      expect(words[5].className).toContain('verse__follow-word--hl');
      expect(words[2].className).not.toContain('verse__follow-word--hl');
    });

    it('falls back to the plain render when there is no highlight, even while followed', () => {
      const verse = makeVerse({ text_html: 'For God so loved the world' });
      const { container } = render(
        <VerseRenderer verse={verse} {...defaultProps} decoration={follow(verse, [])} />,
      );
      expect(container.querySelector('.verse__follow-word')).toBeNull();
      expect(container.innerHTML).toContain('For God so loved the world');
    });

    it('respects the red-letter setting for the followed verse the same as everywhere else', () => {
      mockWordsOfChristInRed = true;
      const verse = makeVerse({
        verse_id: 43003016,
        text_html: '<span class="christ-words">It is finished</span>',
      });
      const { container } = render(
        <VerseRenderer verse={verse} {...defaultProps} decoration={follow(verse, [{ verseIdStart: 43003016, textStart: 0, textEnd: 0 }])} />,
      );
      expect(container.querySelector('.verse__follow-word--christ')).toBeTruthy();
    });
  });

  // ------------------------------------------------------------------
  // Present mode: the send rail and the word highlight
  // ------------------------------------------------------------------
  describe('presenting', () => {
    it('draws no send button outside a session', () => {
      const { container } = render(<VerseRenderer verse={makeVerse()} {...defaultProps} />);
      expect(container.querySelector('.verse__send')).toBeNull();
    });

    it('sends the verse from the left-rail button without selecting it', () => {
      const onSend = vi.fn();
      const { container } = render(
        <VerseRenderer verse={makeVerse()} {...defaultProps}
          decoration={rail(false, onSend, 'Send verse 16')} />,
      );
      fireEvent.click(container.querySelector('.verse__send')!);
      expect(onSend).toHaveBeenCalledTimes(1);
      expect(defaultProps.onVerseClick).not.toHaveBeenCalled();
    });

    it('marks the sent verse, and its button no longer sends', () => {
      const onSend = vi.fn();
      const { container } = render(
        <VerseRenderer verse={makeVerse()} {...defaultProps} isHighlighted
          decoration={rail(true, onSend, 'Verse 16 is on screen')} />,
      );
      // Sent and selected at once: both classes present, and the stylesheet
      // makes the sent one win.
      const row = container.querySelector('.verse')!;
      expect(row.className).toContain('verse--sent');
      expect(row.className).toContain('verse--study');
      const button = container.querySelector('.verse__send--sent') as HTMLElement;
      expect(button.getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(button);
      expect(onSend).not.toHaveBeenCalled();
    });

    describe('word highlight', () => {
      beforeEach(() => { vi.useFakeTimers(); });
      afterEach(() => { vi.useRealTimers(); });

      const words = (container: Element) => container.querySelectorAll<HTMLElement>('[data-w]');

      function setup(draft: { verseId: number; start: number; end: number } | null, isHighlighted = true) {
        const onHold = vi.fn();
        const onTap = vi.fn();
        const utils = render(
          <VerseRenderer verse={makeVerse()} {...defaultProps} isHighlighted={isHighlighted}
            decoration={isHighlighted ? activeWords(makeVerse(), { draft, sent: false, onHold, onTap }) : undefined} />,
        );
        return { ...utils, onHold, onTap };
      }

      it('makes words addressable only in the active verse', () => {
        expect(words(setup(null, true).container).length).toBe(6);
      });

      it('leaves other verses exactly as they were', () => {
        const { container } = setup(null, false);
        expect(words(container).length).toBe(0);
        expect(container.innerHTML).toContain('For God so loved the world');
      });

      it('starts a highlight on a press-and-hold, not on a plain tap', () => {
        const { container, onHold } = setup(null);
        const word = words(container)[2];
        fireEvent.pointerDown(word, { button: 0, isPrimary: true, clientX: 5, clientY: 5 });
        fireEvent.pointerUp(word);
        vi.advanceTimersByTime(1000);
        expect(onHold).not.toHaveBeenCalled();

        fireEvent.pointerDown(word, { button: 0, isPrimary: true, clientX: 5, clientY: 5 });
        vi.advanceTimersByTime(HIGHLIGHT_HOLD_MS + 10);
        expect(onHold).toHaveBeenCalledWith(2);
      });

      it('does not start a highlight when the pointer drifts (a scroll)', () => {
        const { container, onHold } = setup(null);
        const word = words(container)[2];
        fireEvent.pointerDown(word, { button: 0, isPrimary: true, clientX: 5, clientY: 5 });
        fireEvent.pointerMove(word, { clientX: 5, clientY: 60 });
        vi.advanceTimersByTime(1000);
        expect(onHold).not.toHaveBeenCalled();
      });

      it('swallows the click that ends a hold so the verse is not deselected', () => {
        const { container } = setup(null);
        const word = words(container)[2];
        fireEvent.pointerDown(word, { button: 0, isPrimary: true, clientX: 5, clientY: 5 });
        vi.advanceTimersByTime(HIGHLIGHT_HOLD_MS + 10);
        fireEvent.pointerUp(word);
        fireEvent.click(word);
        expect(defaultProps.onVerseClick).not.toHaveBeenCalled();
      });

      it('lets an ordinary tap select the verse as usual while no highlight exists', () => {
        const { container, onTap } = setup(null);
        fireEvent.click(words(container)[2]);
        expect(defaultProps.onVerseClick).toHaveBeenCalledTimes(1);
        expect(onTap).not.toHaveBeenCalled();
      });

      it('routes a tap to the highlight once one exists, and shows the lit words', () => {
        const { container, onTap } = setup({ verseId: 43003016, start: 1, end: 2 });
        const lit = container.querySelectorAll('.verse__pword--draft');
        expect(lit.length).toBe(2);
        fireEvent.click(words(container)[4]);
        expect(onTap).toHaveBeenCalledWith(4);
        expect(defaultProps.onVerseClick).not.toHaveBeenCalled();
      });
    });
  });
});
