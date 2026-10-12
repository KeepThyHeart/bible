/**
 * The reader decorator (`verseDecorators`): a highlight tints the verse with classes
 * `kth-annot-hl kth-annot-hl--<palette name>`; a note or bookmark adds two small marks to the verse row (its rail).
 * Marks only show in the block layouts (standard and study); highlights show in every layout.
 */
import { markupColorName } from '@bible/core/browser';
import { useTranslation } from 'react-i18next';
import { formatVerseRange } from '../../utils/verseId';
import type { ReaderVerseContext, VerseDecoration, VerseDecorator } from '../../host/slots';
import type { AnnotationStore, VerseAnnotations } from './annotationStore';
import { annotationUi } from './annotationUi';

const cache = new Map<string, VerseDecoration>();

function classesFor(color: string): readonly string[] {
  const name = markupColorName(color) ?? 'custom';
  return ['kth-annot-hl', `kth-annot-hl--${name}`];
}

/** The mark buttons of one verse. Clicking the note mark opens its editor; the verse's own click is not triggered. */
export function AnnotationMarks({ verseId, data }: { verseId: number; data: VerseAnnotations }) {
  const { t } = useTranslation();
  const note = data.notes[0];
  return (
    <span class="kth-annot-marks">
      {note && (
        <button
          type="button"
          class="kth-annot-mark kth-annot-mark--note"
          title={note.title ? t('annotations.mark.editNoteTitled', { title: note.title }) : t('annotations.mark.editNote')}
          aria-label={t('annotations.mark.editNote')}
          onClick={(e) => {
            e.stopPropagation();
            annotationUi.openNote({ start: note.start, end: note.end, reference: formatVerseRange(note.start, note.end), note });
          }}
        >
          <i class="fa-solid fa-note-sticky" aria-hidden="true" />
        </button>
      )}
      {data.bookmark && (
        <span class="kth-annot-mark kth-annot-mark--bookmark" title={t('annotations.mark.bookmarked')} role="img" aria-label={t('annotations.mark.bookmarked')} data-verse-id={verseId}>
          <i class="fa-solid fa-bookmark" aria-hidden="true" />
        </span>
      )}
    </span>
  );
}

export function createHighlightDecorator(store: AnnotationStore): VerseDecorator {
  return (ctx: ReaderVerseContext) => {
    const data = store.forVerse(ctx.tabId, ctx.verseId);
    if (!data) return undefined;
    const hasMarks = data.notes.length > 0 || data.bookmark !== undefined;
    if (!data.highlight && !hasMarks) return undefined;
    // Stable objects per colour when there are no marks (the reader compares nothing, but this avoids garbage).
    if (!hasMarks && data.highlight) {
      const key = data.highlight.color;
      let d = cache.get(key);
      if (!d) cache.set(key, (d = { classes: classesFor(key) }));
      return d;
    }
    return {
      classes: data.highlight ? classesFor(data.highlight.color) : undefined,
      rail: <AnnotationMarks verseId={ctx.verseId} data={data} />,
    };
  };
}
