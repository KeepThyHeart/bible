import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/preact';

const watch = vi.fn();
vi.mock('./instance', () => ({ annotationStore: { watch: (...a: unknown[]) => watch(...a) } }));

import { AnnotationPaint, chapterRange } from './AnnotationPaint';
import type { ReaderPaintProps } from '../../host/slots';

const verses = (ids: number[]) => ids.map((verse_id) => ({ verse_id })) as unknown as ReaderPaintProps['verses'];
const props = (over: Partial<ReaderPaintProps> = {}): ReaderPaintProps => ({
  tabId: 't1', moduleAbbr: 'KJV', moduleId: 7, language: 'en', book: 43, chapter: 3,
  verses: verses([43003002, 43003001, 43003003]), surface: 'standard', uiLocale: 'en', container: null, ...over,
});

beforeEach(() => watch.mockReset());

describe('AnnotationPaint', () => {
  it('computes the chapter range from the verses', () => {
    expect(chapterRange(verses([43003002, 43003001, 43003003]))).toEqual({ start: 43003001, end: 43003003 });
    expect(chapterRange(verses([]))).toBeNull();
  });

  it('watches the tab chapter with its module id and releases on unmount', () => {
    const dispose = vi.fn();
    watch.mockReturnValue(dispose);
    const { unmount } = render(<AnnotationPaint {...props()} />);
    expect(watch).toHaveBeenCalledWith('t1', 7, 43003001, 43003003);
    unmount();
    expect(dispose).toHaveBeenCalled();
  });

  it('watches nothing without a module id or verses', () => {
    render(<AnnotationPaint {...props({ moduleId: undefined })} />);
    render(<AnnotationPaint {...props({ verses: verses([]) })} />);
    expect(watch).not.toHaveBeenCalled();
  });
});
