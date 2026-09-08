/**
 * Regression test for NoteViewer's note-body font-size.
 *
 * Reads --study-font-size and --global-font-scale, matching NoteEditor.tsx's
 * editable surface, so it tracks the Typography section's "Study text" /
 * "Global Font Scale" sliders the way every other content pane does (which
 * goes through `.pane-content-*` in globals.css) - a bare hardcoded `16px`
 * would ignore them entirely.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import NoteViewer from './NoteViewer';

vi.mock('../../../stores/useBibleStore', () => ({
  useBibleStore: (selector: (state: { navigateToVerseInPrimary: () => void }) => unknown) =>
    selector({ navigateToVerseInPrimary: vi.fn() }),
}));

vi.mock('../../VersePreviewTooltip', () => ({ default: () => null }));

vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en', i18n: {} }),
}));

vi.mock('../../../utils/commentaryLinkProcessor', () => ({
  reprocessCommentaryLinks: (html: string) => html,
}));

describe('NoteViewer', () => {
  it('renders the sanitized note content', () => {
    render(<NoteViewer content="<p>Hello world</p>" />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('wires the content area font-size to --study-font-size and --global-font-scale, not a bare px literal', () => {
    const { container } = render(<NoteViewer content="<p>Hello world</p>" />);
    const contentArea = container.querySelector('.prose') as HTMLElement;

    expect(contentArea).toBeTruthy();
    expect(contentArea.style.fontSize).toContain('var(--study-font-size');
    expect(contentArea.style.fontSize).toContain('var(--global-font-scale');
    expect(contentArea.style.fontSize).not.toBe('16px');
  });
});
