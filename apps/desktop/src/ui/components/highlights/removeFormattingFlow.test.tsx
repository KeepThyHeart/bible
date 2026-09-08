/**
 * The delete half of the highlight flow, plus what happens when markups
 * overlap.
 *
 * `floatingAnnotationFlow.test.tsx` covers creation. Removal was untested, and
 * it is the path that destroys user data: `handleFloatingRemoveFormatting`
 * reads `data-markup-id` off every word the selection touches, splits it on
 * commas, and deletes each id. A word can carry more than one id because
 * `UserTextMarkupRepository.create` deliberately does *not* resolve overlaps -
 * "Multiple highlights on the same verse/text are allowed" - so the
 * comma-splitting is load-bearing rather than defensive.
 *
 * The same overlap decision is why the rendering cases are here: two markups on
 * one word is a supported state, not an edge case to be tidied away.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { UserTextMarkup, normalizeMarkupColor } from '@bible/core';

/** Markups the repository was asked to create. */
const sent: UserTextMarkup[] = [];
/** Markup ids the repository was asked to delete, in order. */
const deleted: number[] = [];

vi.mock('../../services/highlightsAPI', () => ({
  IPCHighlightRepository: class {
    async getForVerseRange(): Promise<UserTextMarkup[]> { return []; }
    async getForModule(): Promise<UserTextMarkup[]> { return []; }
    async create(markup: UserTextMarkup): Promise<UserTextMarkup> {
      sent.push(markup);
      const echo = new UserTextMarkup({
        ...markup,
        color: normalizeMarkupColor(markup.color),
        markupId: sent.length,
      });
      return echo;
    }
    async delete(markupId: number): Promise<void> {
      deleted.push(markupId);
    }
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
  ACTIVE_TAB,
  MODULE_ID,
  selectWords,
  installRangeLayoutStubs,
  installResizeObserverStub,
} from './highlightFlowHarness';

installRangeLayoutStubs();

const HIGHLIGHT = enString('ui.floatingAnnotation.highlightYellow');
const UNDERLINE = enString('ui.floatingAnnotation.toggleUnderline');
const REMOVE = enString('ui.floatingAnnotation.removeFormatting');

/** Words in the harness verse: "Lord how are they increased that trouble me". */
const words = () => document.querySelectorAll<HTMLElement>('.word');

const markupIdsOn = (index: number): string[] =>
  words()[index].getAttribute('data-markup-id')?.split(',') ?? [];

async function click(label: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByLabelText(label));
  });
}

beforeEach(() => {
  sent.length = 0;
  deleted.length = 0;
  useHighlightStore.setState({ highlightsByModule: new Map(), lastUsedColor: 'yellow' });
  vi.useFakeTimers();
  installResizeObserverStub();
});

afterEach(() => {
  vi.useRealTimers();
  window.getSelection()?.removeAllRanges();
});

describe('remove formatting', () => {
  it('is offered only once the selection covers existing markup', async () => {
    render(<Harness />);

    await selectWords(0, 1, true);
    expect(screen.queryByLabelText(REMOVE)).toBeNull();

    await click(HIGHLIGHT);
    await selectWords(0, 1, true);

    expect(screen.getByLabelText(REMOVE)).toBeInTheDocument();
  });

  it('deletes the markup under the selection', async () => {
    render(<Harness />);
    await selectWords(0, 1, true);
    await click(HIGHLIGHT);

    await selectWords(0, 1, true);
    await click(REMOVE);

    expect(deleted).toEqual([1]);
  });

  it('deletes every markup on a word that carries more than one', async () => {
    // The comma-split path. Two markups over the same words is a state the
    // repository allows, so removing formatting has to clear both - leaving one
    // behind reads as "the button half-worked".
    render(<Harness />);

    await selectWords(0, 1, true);
    await click(HIGHLIGHT);
    await selectWords(0, 1, true);
    await click(UNDERLINE);

    expect(markupIdsOn(0)).toHaveLength(2);

    await selectWords(0, 1, true);
    await click(REMOVE);

    expect(deleted.sort()).toEqual([1, 2]);
  });

  it('deletes each markup once even when it spans several selected words', async () => {
    // One markup covering both words appears on both, so a naive per-word loop
    // would ask for the same id twice.
    render(<Harness />);
    await selectWords(0, 1, true);
    await click(HIGHLIGHT);

    await selectWords(0, 1, true);
    await click(REMOVE);

    expect(deleted).toEqual([1]);
  });

  it('leaves markup outside the selection alone', async () => {
    render(<Harness />);

    await selectWords(0, 1, true);
    await click(HIGHLIGHT);
    await selectWords(4, 5, true);
    await click(HIGHLIGHT);

    await selectWords(4, 5, true);
    await click(REMOVE);

    expect(deleted).toEqual([2]);
  });

  it('dismisses the toolbar and clears the selection afterwards', async () => {
    render(<Harness />);
    await selectWords(0, 1, true);
    await click(HIGHLIGHT);

    await selectWords(0, 1, true);
    await click(REMOVE);

    expect(screen.queryByLabelText(REMOVE)).toBeNull();
    expect(window.getSelection()?.isCollapsed).not.toBe(false);
  });
});

describe('overlapping markup', () => {
  it('keeps both ids on the shared word', async () => {
    render(<Harness />);

    await selectWords(0, 1, true);
    await click(HIGHLIGHT);
    await selectWords(1, 2, true);
    await click('Highlight Green');

    // Word 1 is in both markups; words 0 and 2 in one each.
    expect(markupIdsOn(0)).toHaveLength(1);
    expect(markupIdsOn(1)).toHaveLength(2);
    expect(markupIdsOn(2)).toHaveLength(1);
  });

  it('does not delete the earlier markup when a later one covers it', async () => {
    // Overlap resolution is deliberately not implemented. If it is ever
    // added, it has to be a deliberate change - not a silent one that starts
    // eating the reader's existing highlights.
    render(<Harness />);

    await selectWords(0, 2, true);
    await click(HIGHLIGHT);
    await selectWords(0, 2, true);
    await click('Highlight Green');

    expect(sent).toHaveLength(2);
    expect(deleted).toEqual([]);
  });

  it('renders a highlight and an underline on the same word together', async () => {
    render(<Harness />);

    await selectWords(0, 1, true);
    await click(HIGHLIGHT);
    await selectWords(0, 1, true);
    await click(UNDERLINE);

    const className = words()[0].className;
    expect(className).toContain('highlight-yellow');
    expect(className).toContain('underline-solid');
  });
});

describe('guards', () => {
  it('creates nothing when the tab has no moduleId', async () => {
    // A tab can be mid-load with no moduleId resolved yet. Creating markup
    // against `undefined` would write rows no chapter view can ever find.
    const { moduleId: _omitted, ...tabWithoutModule } = ACTIVE_TAB;
    render(<Harness activeTab={tabWithoutModule} />);

    await selectWords(0, 1, true);
    await click(HIGHLIGHT);

    expect(sent).toHaveLength(0);
  });

  it('offers nothing to remove when the tab has no moduleId', async () => {
    // Markup is looked up by module, so a tab without one renders no
    // `data-markup-id` at all - and the remove button is gated on that. Asserted
    // from the user's side rather than by reaching for the handler, which is
    // not exposed; the store-level guard is covered by the creation case above.
    const { moduleId: _omitted, ...tabWithoutModule } = ACTIVE_TAB;
    render(<Harness activeTab={tabWithoutModule} />);

    await selectWords(0, 1, true);

    expect(screen.getByLabelText(HIGHLIGHT)).toBeInTheDocument();
    expect(screen.queryByLabelText(REMOVE)).toBeNull();
    expect(deleted).toEqual([]);
  });

  it('scopes what it creates to the active module', async () => {
    render(<Harness />);
    await selectWords(0, 1, true);
    await click(HIGHLIGHT);

    expect(sent[0].moduleId).toBe(MODULE_ID);
  });
});
