/** TimelineItemCard: details of one timeline item (dates in every chronology, basis, summary, passages). */
import { chronologyChain, formatInstant, formatSpan, resolveItem } from '@bible/core/browser';
import type { TimelineChronologyDto, TimelineDateDto, TimelineItemDto } from '@bible/core/browser';
import { DEFAULT_TIMELINE_ITEM_CARD_LABELS, kindLabel } from './labels';
import type { TimelineItemCardLabels } from './labels';

export interface TimelineItemCardProps {
  item: TimelineItemDto;
  chronologies: readonly TimelineChronologyDto[];
  activeChronologyId: string;
  labels?: Partial<TimelineItemCardLabels>;
  formatReference: (startVerseId: number, endVerseId: number) => string;
  /** Without it the passages are listed as plain text. */
  onOpenPassage?: (startVerseId: number, endVerseId: number) => void;
  onClose?: () => void;
}

function rangeText(template: string, min: number | undefined, max: number | undefined, d: TimelineDateDto): string | null {
  if (min === undefined && max === undefined) return null;
  const f = (t: number) => formatInstant(t, d.precision);
  return template.replace('{min}', f(min ?? (max as number))).replace('{max}', f(max ?? (min as number)));
}

export function TimelineItemCard({
  item,
  chronologies,
  activeChronologyId,
  labels: labelOverrides,
  formatReference,
  onOpenPassage,
  onClose,
}: TimelineItemCardProps) {
  const labels = { ...DEFAULT_TIMELINE_ITEM_CARD_LABELS, ...labelOverrides };
  const chain = chronologyChain({ chronologies: [...chronologies] }, activeChronologyId);
  const resolved = resolveItem(chain, item);
  const date = resolved?.date;
  const fallbackName = resolved?.viaFallback ? chronologies.find((c) => c.id === resolved.chronologyId)?.name : undefined;
  const details = date
    ? [
        date.circa ? labels.circa : null,
        rangeText(labels.startRange, date.startMin, date.startMax, date),
        rangeText(labels.endRange, date.endMin, date.endMax, date),
        fallbackName ? labels.viaFallback.replace('{chronology}', fallbackName) : null,
      ].filter((s): s is string => !!s)
    : [];
  const primary = item.passages.find((p) => p.primary) ?? item.passages[0];
  const dated = chronologies.filter((c) => item.dates[c.id]);

  return (
    <section className="kth-card kth-timeline-card" aria-label={item.title}>
      <div className="kth-timeline-card__header">
        <div>
          <h3 className="kth-timeline-card__title">{item.title}</h3>
          <p className="kth-timeline-card__meta">
            {kindLabel(labels.kinds, item.kind)}
            {date ? ` - ${formatSpan(date.start, date.end, date.precision, date.circa)}` : ''}
          </p>
        </div>
        {onClose && (
          <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm" onClick={onClose}>
            {labels.close}
          </button>
        )}
      </div>
      {details.map((d) => (
        <p key={d} className="kth-timeline-card__meta">{d}</p>
      ))}
      {date?.basis && (
        <p className="kth-timeline-card__section">
          <strong>{labels.basis}:</strong> {date.basis}
        </p>
      )}
      {item.summary && <p className="kth-timeline-card__section">{item.summary}</p>}
      {dated.length > 0 && (
        <div>
          <span className="kth-timeline-card__meta">{labels.dates}</span>
          <ul className="kth-timeline-card__dates">
            {dated.map((c) => {
              const d = item.dates[c.id];
              return (
                <li key={c.id} aria-current={c.id === resolved?.chronologyId ? 'true' : undefined}>
                  <span>{c.name}:</span>
                  <span>{formatSpan(d.start, d.end, d.precision, d.circa)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {item.passages.length > 0 && (
        <div>
          <span className="kth-timeline-card__meta">{labels.passages}</span>
          <ul className="kth-timeline-card__passages">
            {item.passages.map((p) => {
              const text = formatReference(p.start, p.end);
              return (
                <li key={`${p.start}-${p.end}`}>
                  {onOpenPassage ? (
                    <button
                      type="button"
                      className={p === primary ? 'kth-btn kth-btn--primary kth-btn--sm' : 'kth-btn kth-btn--sm'}
                      onClick={() => onOpenPassage(p.start, p.end)}
                    >
                      {p === primary ? `${labels.read} ${text}` : text}
                    </button>
                  ) : (
                    <span>{text}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <span className={item.reviewed ? 'kth-timeline-card__review kth-timeline-card__review--reviewed' : 'kth-timeline-card__review'}>
        {item.reviewed ? labels.reviewed : labels.unreviewed}
      </span>
    </section>
  );
}
