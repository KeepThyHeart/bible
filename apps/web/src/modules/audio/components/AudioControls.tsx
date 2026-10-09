/**
 * The controls the quick settings and the settings tab share. Each is built from
 * what the registered providers report (`capabilities`, `voices`, `usable`), so a
 * new engine appears in them without any change here.
 */

import { useTranslation } from 'react-i18next';
import type { AudioCapabilities, RateRange } from '@bible/core/browser';
import type { SourceStatus } from '../lib/AudioSourceResolver';
import { audioStore } from '../audioStore';
import { effectiveRate } from '../lib/audioPrefs';
import { unusableText, uiOptions, usableEngines } from '../lib/sourceChoice';
import type { UiSource } from '../lib/sourceChoice';

/** Why a source cannot be chosen, in words. */
export { unusableText };

export interface SourceSegmentedProps {
  sources: SourceStatus[];
  /** `auto`, `recorded`, `generated`, or `default` (with `withDefault`). */
  value: UiSource | 'default';
  onChange(value: UiSource | 'default'): void;
  /** Add "Use default" as the first choice (a per-translation override that can be cleared). */
  withDefault?: boolean;
  label: string;
  /** For the reason a source is unavailable. */
  moduleAbbr: string;
  language: string;
}

/**
 * Auto / Recorded / Generated as a radio group drawn as a segmented control. An
 * unusable option is disabled, and its reason is written under the control (phones
 * have no tooltips) as well as in its `title`.
 */
export function SourceSegmented({ sources, value, onChange, withDefault, label, moduleAbbr, language }: SourceSegmentedProps) {
  const { t } = useTranslation();
  const tt = (k: string, o?: Record<string, string>) => t(k, o);
  const options = uiOptions(sources, moduleAbbr, language, tt);
  const items: Array<{ id: UiSource | 'default'; text: string; disabled: boolean; title?: string }> = [];
  if (withDefault) items.push({ id: 'default', text: t('audio.source.useDefault'), disabled: false });
  for (const o of options) items.push({ id: o.id, text: o.label, disabled: o.disabled, title: o.reason });
  const reasons = options.filter(o => o.disabled && o.reason);
  return (
    <div class="audio-source">
      <div class="audio-segmented" role="radiogroup" aria-label={label}>
        {items.map(item => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={value === item.id}
            disabled={item.disabled}
            title={item.title}
            class={`audio-segmented__btn${value === item.id ? ' audio-segmented__btn--active' : ''}`}
            onClick={() => onChange(item.id)}
          >
            {item.text}
          </button>
        ))}
      </div>
      {reasons.length > 0 && (
        <p class="audio-note audio-source__reasons" data-testid="audio-source-reasons">
          {reasons.map(o => <span key={o.id} class="audio-source__reason" data-source={o.id}>{o.reason}</span>)}
        </p>
      )}
    </div>
  );
}

/** A `<select>` of the usable engines (only worth showing with two or more); writes `tts:<id>`. */
export function EngineSelect({ sources, value, id, onChange }: { sources: SourceStatus[]; value: string; id: string; onChange(choice: `tts:${string}`): void }) {
  const engines = usableEngines(sources);
  if (engines.length < 2) return null;
  return (
    <select id={id} class="audio-select" value={value} onChange={e => onChange((e.target as HTMLSelectElement).value as `tts:${string}`)}>
      {engines.map(s => <option key={s.provider.id} value={s.provider.id}>{s.provider.label}</option>)}
    </select>
  );
}

/** One line per source that cannot play this translation, saying why. */
export function UnusableNotes({ sources, moduleAbbr, language }: { sources: SourceStatus[]; moduleAbbr: string; language: string }) {
  const { t } = useTranslation();
  const bad = sources.filter(s => !s.usable);
  if (bad.length === 0) return null;
  return (
    <p class="audio-note">{bad.map(s => unusableText(s, moduleAbbr, language, (k, o) => t(k, o))).join(' ')}</p>
  );
}

export function RateSlider({ range, value, onChange, label }: { range: RateRange; value: number; onChange(rate: number): void; label: string }) {
  const shown = Math.min(range.max, Math.max(range.min, value));
  return (
    <div class="audio-rate">
      <input
        type="range"
        class="audio-rate__slider"
        min={range.min}
        max={range.max}
        step={range.step}
        value={shown}
        aria-label={label}
        aria-valuetext={`${shown.toFixed(2).replace(/0$/, '')}×`}
        data-testid="audio-rate"
        onInput={e => onChange(Number((e.target as HTMLInputElement).value))}
      />
      <span class="audio-rate__value" aria-hidden="true">{formatRate(shown)}</span>
    </div>
  );
}

export function formatRate(rate: number): string {
  return `${(Math.round(rate * 100) / 100).toFixed(rate * 10 % 1 === 0 ? 1 : 2)}×`;
}

/** The rate the current source will actually use (the reader's preference, clamped to what it supports). */
export function rateFor(caps: AudioCapabilities | null): number {
  return caps ? effectiveRate(audioStore.prefs.rate, caps) : audioStore.prefs.rate;
}
