/**
 * Regression test for Markdown-formatted commentary entries.
 *
 * The bundled `SYNTHESIS` commentary module declares `content_format:
 * "markdown"` in its module metadata, but the commentary IPC surface does
 * not carry that field through to the renderer. `CommentaryEntryView` used
 * to feed the raw Markdown straight into `reprocessCommentaryLinks` /
 * `sanitizeHtml`, so entries reached the reader as literal `====` rules and
 * `**asterisks**` instead of formatted HTML. It now sniffs the format with
 * the same `looksLikeMarkdown` detector the Study pane's `StudyRichText`
 * uses, and converts before linking/sanitizing.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CommentaryEntryView from './CommentaryEntryView';
import type { CommentaryEntry } from '../../stores/useCommentaryStore';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en', i18n: {} }),
}));

vi.mock('../../stores/useBibleStore', () => ({
  useBibleStore: Object.assign(
    vi.fn().mockReturnValue(undefined),
    { getState: vi.fn().mockReturnValue({ navigateToVerseInPrimary: vi.fn(), panels: new Map() }) },
  ),
  DEFAULT_PANEL_ID: 'default',
}));

vi.mock('../VersePreviewTooltip', () => ({
  default: () => null,
}));

const MARKDOWN_ENTRY: CommentaryEntry = {
  entry_id: 1,
  verse_id_start: 43003016,
  entry_level: 'verse',
  content: [
    'John 3:16 Commentary Synthesis',
    '==============================',
    '',
    'Overall Verse Notes',
    '-------------------',
    '  * Luther describes John 3:16 as "the Bible in miniature".',
    '  * Burkitt observes that God’s love is *demonstrated* by giving His Son.',
  ].join('\n'),
};

const HTML_ENTRY: CommentaryEntry = {
  entry_id: 2,
  verse_id_start: 43003016,
  entry_level: 'verse',
  content: '<p>For God so loved <strong>the world</strong>.</p>',
};

function renderEntry(entry: CommentaryEntry) {
  return render(<CommentaryEntryView entry={entry} showDivider={false} contextBookNumber={43} />);
}

describe('CommentaryEntryView — Markdown detection', () => {
  it('renders Markdown commentary content as formatted HTML, not raw marks', () => {
    renderEntry(MARKDOWN_ENTRY);
    const content = screen.getByTestId('commentary-entry-content');
    // The leading H1 is stripped (duplicates the header already shown above
    // the entry), so the H2 heading is the first visible block.
    expect(content.querySelector('h2')?.textContent).toBe('Overall Verse Notes');
    expect(content.querySelectorAll('li').length).toBe(2);
    expect(content.querySelector('em')?.textContent).toBe('demonstrated');
    // No leaked Markdown syntax anywhere in the rendered text.
    expect(content.innerHTML).not.toMatch(/={3,}/);
    expect(content.innerHTML).not.toMatch(/\*\*/);
    expect(content.textContent).not.toMatch(/^\s*\*/m);
  });

  it('leaves HTML commentary content unaffected', () => {
    renderEntry(HTML_ENTRY);
    const content = screen.getByTestId('commentary-entry-content');
    expect(content.querySelector('strong')?.textContent).toBe('the world');
    expect(content.textContent).toContain('For God so loved');
  });
});
