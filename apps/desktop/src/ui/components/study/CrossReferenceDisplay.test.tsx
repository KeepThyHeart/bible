/**
 * The inline Study-mode cross-reference row.
 *
 * Behavior pinned here:
 *
 *  1. Cross-references come from what the cross-reference MODULES return,
 *     rendered as `TSK: Yea. Rom 5:8; ...`. Reading instead from
 *     `bible_verse.formatting.crossReferences` would render nothing, since no
 *     shipped Bible module populates that field.
 *  2. Book names come from `collapseReferencesStructured` in @bible/core. A
 *     hand-written table would know only 11 of the 66 books, rendering
 *     everything else as "Book 45 5:8".
 *  3. TSK's PHRASE GROUPS render inline, keyword in bold, with the "+N more"
 *     budget applied per group. Flattening every group's targets into one
 *     undifferentiated run instead would leave a reader unable to tell which
 *     words of the verse a reference belongs to.
 *  4. Hovering a reference shows a verse preview, matching every other place
 *     scripture references appear in the app - Study mode's cross-reference
 *     row is not an exception.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CrossReferenceDisplay, { ReferenceRun, type ModuleCrossReferences } from './CrossReferenceDisplay';
import { enT } from '../../testing/enCatalog';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => enT(key, params), locale: 'en', i18n: {} }),
}));

// The real tooltip fetches verse text over IPC and portals itself; only its
// presence and the verse it was asked for matter here.
vi.mock('../VersePreviewTooltip', () => ({
  default: ({ verseId, endVerseId }: { verseId: number; endVerseId?: number }) => (
    <div data-testid="verse-preview-tooltip" data-verse-id={verseId} data-end-verse-id={endVerseId ?? ''} />
  ),
}));

const TSK: ModuleCrossReferences = {
  abbreviation: 'TSKxref',
  moduleName: 'Treasury of Scripture Knowledge',
  groups: [
    {
      groupId: 1,
      phrase: 'Yea.',
      // Rom 5:8, Rom 8:32, 1 John 4:9-10 - the range pre-expanded by the caller.
      verseIds: [45005008, 45008032, 62004009, 62004010],
    },
  ],
};

describe('CrossReferenceDisplay', () => {
  it('renders nothing when there are no module refs and no user refs', () => {
    const { container } = render(<CrossReferenceDisplay moduleRefs={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one compact row per module, labelled and formatted with real book names', () => {
    render(<CrossReferenceDisplay moduleRefs={[TSK]} />);

    const row = screen.getByTestId('cross-reference-row-TSKxref');
    // `TSKxref` is the registry abbreviation; the row reads "TSK:".
    expect(row.textContent).toContain('TSK:');
    // Real names, collapsed the way TSK itself prints them - and emphatically
    // not "Book 45 5:8".
    expect(row.textContent).toContain('Rom 5:8');
    expect(row.textContent).toContain('8:32');
    expect(row.textContent).toContain('1 John 4:9-10');
    expect(row.textContent).not.toContain('Book 45');
  });

  it('navigates to the verse behind a clicked reference', async () => {
    const onNavigateToVerse = vi.fn();
    render(<CrossReferenceDisplay moduleRefs={[TSK]} onNavigateToVerse={onNavigateToVerse} />);

    await userEvent.click(screen.getByRole('button', { name: 'Rom 5:8' }));
    // The range end rides along so a caller that previews a passage gets the
    // whole range, not just its first verse. Undefined for a single verse.
    expect(onNavigateToVerse).toHaveBeenCalledWith(45005008, undefined);
  });

  it('keeps a dense group short, behind a "+N more" toggle', async () => {
    // 20 references in one group: well past the 12 a group shows collapsed.
    const dense: ModuleCrossReferences = {
      abbreviation: 'TSKxref',
      moduleName: 'Treasury of Scripture Knowledge',
      groups: [
        { groupId: 1, verseIds: Array.from({ length: 20 }, (_, i) => 19119001 + i * 2) },
      ],
    };
    render(<CrossReferenceDisplay moduleRefs={[dense]} />);

    const row = screen.getByTestId('cross-reference-row-TSKxref');
    const collapsedRefs = row.querySelectorAll('button').length - 1; // minus the toggle
    expect(collapsedRefs).toBe(12);

    await userEvent.click(screen.getByRole('button', { name: '+8 more' }));
    expect(row.querySelectorAll('button').length - 1).toBe(20);
  });

  describe('phrase groups', () => {
    const MULTI: ModuleCrossReferences = {
      abbreviation: 'TSKxref',
      moduleName: 'Treasury of Scripture Knowledge',
      groups: [
        { groupId: 7, verseIds: [45005008] },
        { groupId: 8, phrase: 'Yea.', verseIds: [45008032] },
        { groupId: 9, phrase: 'hath God said.', verseIds: [62004009] },
      ],
    };

    it('renders each phrase inline, in bold, ahead of its own references', () => {
      render(<CrossReferenceDisplay moduleRefs={[MULTI]} />);
      const phrases = screen.getAllByTestId('cross-reference-phrase').map(el => el.textContent);
      expect(phrases).toEqual(['Overall.', 'Yea.', 'hath God said.']);
    });

    it('labels the phrase-less group rather than dropping its heading', () => {
      render(<CrossReferenceDisplay moduleRefs={[MULTI]} />);
      // The whole-verse group has no phrase; it still gets a label so its
      // references are not mistaken for the next phrase's.
      expect(screen.getAllByTestId('cross-reference-phrase')[0].textContent).toBe('Overall.');
    });

    it('gives each group its own "+N more" budget', async () => {
      const twoDense: ModuleCrossReferences = {
        abbreviation: 'TSKxref',
        moduleName: 'TSK',
        groups: [
          { groupId: 1, phrase: 'first.', verseIds: Array.from({ length: 15 }, (_, i) => 19119001 + i * 2) },
          { groupId: 2, phrase: 'second.', verseIds: Array.from({ length: 15 }, (_, i) => 20001001 + i * 2) },
        ],
      };
      render(<CrossReferenceDisplay moduleRefs={[twoDense]} />);
      // Two toggles, not one: truncating the module as a whole would have hidden
      // the entire second phrase behind the first phrase's counter.
      expect(screen.getAllByRole('button', { name: '+3 more' })).toHaveLength(2);
    });

    it('shows the TSK keyword, never the aside run together with it', () => {
      const withAside: ModuleCrossReferences = {
        abbreviation: 'TSKxref',
        moduleName: 'TSK',
        groups: [
          {
            groupId: 1,
            phrase: 'locusts.The word {arbeh,} Locust, is derived from {ravah,} to multiply.',
            verseIds: [45005008],
          },
        ],
      };
      render(<CrossReferenceDisplay moduleRefs={[withAside]} />);

      const phrase = screen.getByTestId('cross-reference-phrase');
      expect(phrase.textContent).toBe('locusts.');
      // The aside is kept, just out of the reading flow.
      expect(phrase.getAttribute('title')).toContain('The word {arbeh,}');
    });
  });

  describe('verse previews', () => {
    it('shows a preview for the hovered reference, and hides it on leave', async () => {
      render(<CrossReferenceDisplay moduleRefs={[TSK]} />);
      expect(screen.queryByTestId('verse-preview-tooltip')).toBeNull();

      await userEvent.hover(screen.getByRole('button', { name: 'Rom 5:8' }));
      const tooltip = screen.getByTestId('verse-preview-tooltip');
      expect(tooltip.getAttribute('data-verse-id')).toBe('45005008');

      await userEvent.unhover(screen.getByRole('button', { name: 'Rom 5:8' }));
      // Hiding is deferred ~100ms so the pointer can travel into the popup.
      await vi.waitFor(() => expect(screen.queryByTestId('verse-preview-tooltip')).toBeNull());
    });

    it('passes the range end so a collapsed range previews the whole passage', async () => {
      render(<CrossReferenceDisplay moduleRefs={[TSK]} />);
      const row = screen.getByTestId('cross-reference-row-TSKxref');
      // 1 John 4:9-10 was collapsed from two ids, so the segment carries an end.
      await userEvent.hover(within(row).getByRole('button', { name: '1 John 4:9-10' }));
      const tooltip = screen.getByTestId('verse-preview-tooltip');
      expect(tooltip.getAttribute('data-verse-id')).toBe('62004009');
      expect(tooltip.getAttribute('data-end-verse-id')).toBe('62004010');
    });
  });
});

/**
 * The "+N more" budget is a property of the CALLER, not of the run. The inline
 * row above keeps it; the dockview Study pane passes `maxRefs={null}` because a
 * reader who opened a cross-reference pane wants the references, not a counter.
 */
describe('ReferenceRun', () => {
  // 20 non-adjacent verses in Ps 119, so nothing collapses into a range and the
  // rendered button count is exactly the reference count.
  const DENSE = Array.from({ length: 20 }, (_, i) => 19119001 + i * 2);

  it('truncates at the default budget and offers a toggle', () => {
    render(<ReferenceRun verseIds={DENSE} />);
    // 12 references plus the toggle.
    expect(screen.getAllByRole('button')).toHaveLength(13);
    expect(screen.getByRole('button', { name: '+8 more' })).toBeInTheDocument();
  });

  it('renders every reference and no toggle when maxRefs is null', () => {
    render(<ReferenceRun verseIds={DENSE} maxRefs={null} />);
    expect(screen.getAllByRole('button')).toHaveLength(20);
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull();
    // The 20th reference - the one the default budget dropped - is present.
    const labels = screen.getAllByRole('button').map(b => b.textContent);
    expect(labels[0]).toBe('Psa 119:1');
    expect(labels[19]).toBe('39');
  });

  it('still renders nothing at all for an empty run', () => {
    const { container } = render(<ReferenceRun verseIds={[]} maxRefs={null} />);
    expect(container.firstChild).toBeNull();
  });
});
