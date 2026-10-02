import { mergeWordStudyLabels } from './wordStudyLabels';
import type { WordStudyLabels } from './wordStudyLabels';

export interface BookDistributionStripProps {
  /** Occurrences per book number (1-66). */
  bookCounts: Record<number, number>;
  selectedBook?: number;
  onSelect: (book: number | undefined) => void;
  /** Localized book name for the tooltip and accessible name. */
  formatBook: (book: number) => string;
  labels?: Partial<WordStudyLabels>;
}

const BOOKS = Array.from({ length: 66 }, (_, i) => i + 1);

export function BookDistributionStrip({ bookCounts, selectedBook, onSelect, formatBook, labels }: BookDistributionStripProps) {
  const l = mergeWordStudyLabels(labels);
  const max = Math.max(1, ...BOOKS.map((b) => bookCounts[b] ?? 0));
  return (
    <section className="kth-ws-strip" aria-label={l.bookDistributionTitle}>
      <h3 className="kth-ws-section-title">{l.bookDistributionTitle}</h3>
      <div className="kth-ws-strip__bars">
        {BOOKS.map((b) => {
          const count = bookCounts[b] ?? 0;
          const selected = b === selectedBook;
          const name = `${formatBook(b)}: ${count}`;
          return (
            <button
              key={b}
              type="button"
              className={
                (b === 40 ? 'kth-ws-strip__cell kth-ws-strip__cell--nt' : 'kth-ws-strip__cell') + (selected ? ' kth-ws-strip__cell--selected' : '')
              }
              title={name}
              aria-label={name}
              aria-pressed={selected}
              disabled={count === 0 && !selected}
              onClick={() => onSelect(selected ? undefined : b)}
            >
              <span className={selected ? 'kth-ws-strip__bar kth-ws-strip__bar--selected' : 'kth-ws-strip__bar'} style={{ blockSize: count ? `${Math.max(8, (count / max) * 100)}%` : '0' }} />
            </button>
          );
        })}
      </div>
    </section>
  );
}
