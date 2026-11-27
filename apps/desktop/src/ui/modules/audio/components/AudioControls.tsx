/**
 * Controls the quick settings and the Preferences section share. Each is built from what the registered
 * providers report (`capabilities`, `voices`, `usable`), so a new engine appears without a change here.
 */
import React from 'react';
import type { RateRange } from '@bible/core/browser';
import { uiOptions, usableEngines, unusableText } from '@bible/audio';
import type { SourceStatus, UiSource } from '@bible/audio';
import { useI18n } from '../../../contexts/useI18n';
import './audio.css';

export { unusableText };

export interface SourceSegmentedProps {
  sources: SourceStatus[];
  /** `auto`, `recorded`, `generated`, or `default` (with `withDefault`). */
  value: UiSource | 'default';
  onChange(value: UiSource | 'default'): void;
  /** Add "Use default" as the first choice (a per-translation override that can be cleared). */
  withDefault?: boolean;
  label: string;
  moduleAbbr: string;
  language: string;
}

/** Auto / Recorded / Generated as a radio group; an unusable option is disabled and its reason is written under it. */
export const SourceSegmented: React.FC<SourceSegmentedProps> = ({ sources, value, onChange, withDefault, label, moduleAbbr, language }) => {
  const { t } = useI18n();
  const options = uiOptions(sources, moduleAbbr, language, (k, o) => t(k, o));
  const items: Array<{ id: UiSource | 'default'; text: string; disabled: boolean; title?: string }> = [];
  if (withDefault) items.push({ id: 'default', text: t('audio.source.useDefault'), disabled: false });
  for (const o of options) items.push({ id: o.id, text: o.label, disabled: o.disabled, title: o.reason });
  const reasons = options.filter((o) => o.disabled && o.reason);
  return (
    <div className="audio-source">
      <div className="audio-segmented" role="radiogroup" aria-label={label}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={value === item.id}
            disabled={item.disabled}
            title={item.title}
            className={`audio-segmented__btn${value === item.id ? ' audio-segmented__btn--active' : ''}`}
            onClick={() => onChange(item.id)}
          >
            {item.text}
          </button>
        ))}
      </div>
      {reasons.length > 0 && (
        <p className="audio-note audio-source__reasons" data-testid="audio-source-reasons">
          {reasons.map((o) => <span key={o.id} data-source={o.id}>{o.reason}</span>)}
        </p>
      )}
    </div>
  );
};

/** A `<select>` of the usable engines (only worth showing with two or more); writes `tts:<id>`. */
export const EngineSelect: React.FC<{ sources: SourceStatus[]; value: string; id: string; onChange(choice: `tts:${string}`): void }> = ({ sources, value, id, onChange }) => {
  const { t } = useI18n();
  const engines = usableEngines(sources);
  if (engines.length < 2) return null;
  return (
    <select id={id} className="audio-select" aria-label={t('audio.source.engine')} value={value} onChange={(e) => onChange(e.target.value as `tts:${string}`)}>
      {engines.map((s) => <option key={s.provider.id} value={s.provider.id}>{s.provider.label}</option>)}
    </select>
  );
};

export function formatRate(rate: number): string {
  return `${(Math.round(rate * 100) / 100).toFixed(rate * 10 % 1 === 0 ? 1 : 2)}×`;
}

export const RateSlider: React.FC<{ range: RateRange; value: number; onChange(rate: number): void; label: string }> = ({ range, value, onChange, label }) => {
  const shown = Math.min(range.max, Math.max(range.min, value));
  return (
    <div className="audio-rate">
      <input
        type="range"
        className="audio-rate__slider"
        min={range.min}
        max={range.max}
        step={range.step}
        value={shown}
        aria-label={label}
        aria-valuetext={formatRate(shown)}
        data-testid="audio-rate"
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="audio-rate__value" aria-hidden="true">{formatRate(shown)}</span>
    </div>
  );
};
