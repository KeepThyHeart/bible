/**
 * The controls the source popover and the settings tab share. Each is built from
 * what the registered providers report (`capabilities`, `voices`, `usable`), so a
 * new engine appears in them without any change here.
 */

import { useTranslation } from 'react-i18next';
import type { AudioCapabilities, RateRange } from '@bible/core/browser';
import type { SourceStatus } from '../../audio/AudioSourceResolver';
import { audioStore } from '../../stores/audioStore';
import { effectiveRate } from '../../audio/audioPrefs';

/** Text for a provider in the segmented control. */
export function providerLabel(status: SourceStatus, t: (k: string) => string): string {
  return status.provider.kind === 'recorded' ? t('audio.source.recorded') : status.provider.label;
}

/** Why a source cannot be chosen, in words. */
export function unusableText(status: SourceStatus, moduleAbbr: string, language: string, t: (k: string, o?: Record<string, string>) => string): string {
  const name = status.provider.kind === 'recorded' ? '' : status.provider.label;
  switch (status.reason) {
    case 'no-recording': return t('audio.source.noRecording', { module: moduleAbbr });
    case 'browser': return t('audio.source.browserUnsupported', { engine: name });
    default: return t('audio.source.noVoice', { engine: name, language });
  }
}

export interface SourceSegmentedProps {
  sources: SourceStatus[];
  /** A provider id, `auto`, or `default`. */
  value: string;
  onChange(value: string): void;
  /** Add "Automatic" as the first choice. */
  withAuto?: boolean;
  /** Add "Use default" as the first choice (a per-translation override that can be cleared). */
  withDefault?: boolean;
  label: string;
  /** For the tooltip that says why a source is unavailable. */
  moduleAbbr: string;
  language: string;
}

/** A radio group drawn as a segmented control; unusable sources are disabled with the reason as their tooltip. */
export function SourceSegmented({ sources, value, onChange, withAuto, withDefault, label, moduleAbbr, language }: SourceSegmentedProps) {
  const { t } = useTranslation();
  const items: Array<{ id: string; text: string; disabled: boolean; title?: string }> = [];
  if (withDefault) items.push({ id: 'default', text: t('audio.source.useDefault'), disabled: false });
  if (withAuto) items.push({ id: 'auto', text: t('audio.source.auto'), disabled: false });
  for (const s of sources) {
    items.push({
      id: s.provider.id,
      text: providerLabel(s, t),
      disabled: !s.usable,
      title: s.usable ? undefined : unusableText(s, moduleAbbr, language, (k, o) => t(k, o)),
    });
  }
  return (
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
