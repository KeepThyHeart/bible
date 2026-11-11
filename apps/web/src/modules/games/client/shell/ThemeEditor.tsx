/**
 * A theme, picked from the built-in presets.
 *
 * Round 1 gave this a "Customize colours" disclosure with one colour input
 * per token, on the theory that a host might want to nudge one colour
 * without losing the rest. The playtest said otherwise — "No Customize
 * Colors; just the built-in themes" — so this is deliberately pared back to
 * the preset row alone. `ThemeTokens` is still a plain map of values, not a
 * fixed enum (see `src/shared/theme.ts`), so adding a fourth preset later is
 * still just another value set, not new code here or anywhere this is used;
 * what changed is that nothing in this app offers to edit one by hand any
 * more.
 */

import { useRef } from 'preact/hooks';
import {
  THEME_PRESETS,
  THEME_PRESET_IDS,
  presetIdOf,
  type ThemeTokens,
} from '../../shared/theme.js';
import { themeName } from './gameLabels.js';
import { gt } from './t.js';

export interface ThemeEditorProps {
  theme: ThemeTokens;
  onChange(theme: ThemeTokens): void;
  /** A short label above the presets, since this editor appears in more than one place. */
  label?: string;
}

export function ThemeEditor({ theme, onChange, label = gt('games.phone.theme', 'Theme') }: ThemeEditorProps) {
  const activePreset = presetIdOf(theme);
  const groupRef = useRef<HTMLDivElement>(null);
  const ids = THEME_PRESET_IDS.filter((id) => THEME_PRESETS[id]);
  // Roving tabindex: the chosen preset is the one tab stop; with none chosen (a custom theme) the first is.
  const tabStop = activePreset !== null && ids.includes(activePreset) ? activePreset : ids[0];

  /** Arrow keys move the choice, and focus, to the neighbouring preset (wrapping). */
  const onKeyDown = (event: KeyboardEvent, index: number): void => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1
      : 0;
    if (step === 0) return;
    event.preventDefault();
    const nextId = ids[(index + step + ids.length) % ids.length];
    const next = nextId ? THEME_PRESETS[nextId] : undefined;
    if (!next) return;
    onChange(next);
    groupRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[(index + step + ids.length) % ids.length]?.focus();
  };

  return (
    <div class="theme-editor">
      <span class="field-label">{label}</span>
      <div class="theme-presets" role="radiogroup" ref={groupRef} aria-label={label}>
        {ids.map((id, index) => {
          const preset = THEME_PRESETS[id];
          if (!preset) return null;
          return (
            <button
              key={id}
              type="button"
              class="theme-preset"
              role="radio"
              aria-checked={activePreset === id}
              tabIndex={tabStop === id ? 0 : -1}
              onKeyDown={(event) => onKeyDown(event, index)}
              style={{ '--swatch': preset.accent, '--swatch-bg': preset.bg, '--swatch-fg': preset.fg }}
              onClick={() => onChange(preset)}
            >
              {themeName(id)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
