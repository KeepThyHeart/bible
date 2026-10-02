/**
 * MeasurePopup: the card body for a weight, measure or money popup (0069). Renders a `MeasurePopupModel`
 * whose strings are already localized; the apps wrap it in a Popover or BottomSheet. The Sources
 * disclosure is the only local state.
 */
import { useState } from 'react';
import type { MeasurePopupModel } from '@bible/core/browser';

export interface MeasurePopupLabels {
  /** "Range", followed by the model's range. */
  range: string;
  rangeHint: string;
  verseNote: string;
  usage: { illustrative: string; figurative: string };
  usageHint: { illustrative: string; figurative: string };
  draft: string;
  sources: string;
  units: string;
}

export const DEFAULT_MEASURE_POPUP_LABELS: MeasurePopupLabels = {
  range: 'Range',
  rangeHint: 'depending on the value used',
  verseNote: 'In this verse',
  usage: { illustrative: 'Illustrative', figurative: 'Figurative' },
  usageHint: {
    illustrative: 'An example amount; the exact figure is not the point',
    figurative: 'Used figuratively; the figure is not meant literally',
  },
  draft: 'Draft – not yet reviewed',
  sources: 'Sources',
  units: 'Units…',
};

export type PartialMeasurePopupLabels = Partial<Omit<MeasurePopupLabels, 'usage' | 'usageHint'>> & {
  usage?: Partial<MeasurePopupLabels['usage']>;
  usageHint?: Partial<MeasurePopupLabels['usageHint']>;
};

export interface MeasurePopupProps {
  model: MeasurePopupModel;
  labels?: PartialMeasurePopupLabels;
  /** Shows a "Units..." button when given. */
  onOpenSettings?: () => void;
  /** Called when the Sources disclosure is opened. */
  onShowSources?: () => void;
  /** Drops the header (the bottom sheet shows the title). */
  compact?: boolean;
  dir?: 'ltr' | 'rtl';
}

export function MeasurePopup({ model, labels, onOpenSettings, onShowSources, compact, dir }: MeasurePopupProps) {
  const L: MeasurePopupLabels = {
    ...DEFAULT_MEASURE_POPUP_LABELS,
    ...labels,
    usage: { ...DEFAULT_MEASURE_POPUP_LABELS.usage, ...labels?.usage },
    usageHint: { ...DEFAULT_MEASURE_POPUP_LABELS.usageHint, ...labels?.usageHint },
  };
  const [open, setOpen] = useState(false);
  const usage = model.usage === 'literal' ? null : model.usage;
  const hasFooter = model.sources.length > 0 || !!onOpenSettings;

  return (
    <div className="kth-measure" dir={dir}>
      {compact ? null : <h3 className="kth-measure__title">{model.title}</h3>}
      {model.subtitle ? <p className="kth-measure__subtitle">{model.subtitle}</p> : null}
      <p className="kth-measure__primary">{model.primary}</p>
      {model.secondary ? <p className="kth-measure__secondary">{model.secondary}</p> : null}
      {model.range ? (
        <p className="kth-measure__range">
          {L.range}: {model.range}
          <span className="kth-measure__hint"> ({L.rangeHint})</span>
        </p>
      ) : null}
      {model.extra.length > 0 ? (
        <ul className="kth-measure__extra">
          {model.extra.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      ) : null}
      {model.relation ? <p className="kth-measure__relation">{model.relation}</p> : null}
      {model.unitNote ? <p className="kth-measure__note">{model.unitNote}</p> : null}
      {model.verseNote ? (
        <p className="kth-measure__verse-note">
          <span className="kth-measure__verse-label">{L.verseNote}</span> {model.verseNote}
        </p>
      ) : null}

      {usage || model.review === 'draft' ? (
        <div className="kth-measure__chips">
          {usage ? (
            <span className="kth-measure__chip" title={L.usageHint[usage]}>
              {L.usage[usage]}
              <span className="kth-visually-hidden">. {L.usageHint[usage]}</span>
            </span>
          ) : null}
          {model.review === 'draft' ? <span className="kth-measure__chip kth-measure__chip--draft">{L.draft}</span> : null}
        </div>
      ) : null}

      {hasFooter ? (
        <div className="kth-measure__footer">
          {model.sources.length > 0 ? (
            <button
              type="button"
              className="kth-btn kth-btn--sm"
              aria-expanded={open}
              onClick={() => {
                if (!open) onShowSources?.();
                setOpen(!open);
              }}
            >
              {L.sources}
            </button>
          ) : null}
          {onOpenSettings ? (
            <button type="button" className="kth-btn kth-btn--sm" onClick={onOpenSettings}>{L.units}</button>
          ) : null}
        </div>
      ) : null}
      {open && model.sources.length > 0 ? (
        <ul className="kth-measure__sources" aria-label={L.sources}>
          {model.sources.map((s) => (
            <li key={s.id}>
              {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
