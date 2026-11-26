import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import NoteViewer from './NoteViewer';

vi.mock('../../VersePreviewTooltip', () => ({ default: () => null }));
vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en', i18n: {} }),
}));
vi.mock('../../../utils/commentaryLinkProcessor', () => ({ reprocessCommentaryLinks: (html: string) => html }));

const html = '<h2>Title</h2><blockquote><p>quoted</p></blockquote><table><tbody><tr><td colspan="2">cell</td></tr></tbody></table><p>plain</p>';

describe('NoteViewer rich', () => {
  it('keeps headings, blockquotes and tables when rich', () => {
    const { container } = render(<NoteViewer content={html} rich />);
    expect(container.querySelector('h2')).not.toBeNull();
    expect(container.querySelector('blockquote')).not.toBeNull();
    expect(container.querySelector('td')?.getAttribute('colspan')).toBe('2');
  });

  it('strips them by default but keeps the text', () => {
    const { container } = render(<NoteViewer content={html} />);
    expect(container.querySelector('h2')).toBeNull();
    expect(container.querySelector('blockquote')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).toContain('quoted');
  });

  it('allows data: images only', () => {
    const { container } = render(
      <NoteViewer rich content={'<img src="data:image/png;base64,AAAA"><img src="https://example.com/x.png">'} />,
    );
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toMatch(/^data:image\/png/);
  });
});
