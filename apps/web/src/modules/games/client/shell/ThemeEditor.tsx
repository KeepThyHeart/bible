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

import {
  THEME_PRESETS,
  THEME_PRESET_IDS,
  THEME_PRESET_LABELS,
  presetIdOf,
  type ThemeTokens,
} from '../../shared/theme.js';

export interface ThemeEditorProps {
  theme: ThemeTokens;
  onChange(theme: ThemeTokens): void;
  /** A short label above the presets, since this editor appears in more than one place. */
  label?: string;
}

export function ThemeEditor({ theme, onChange, label = 'Theme' }: ThemeEditorProps) {
  const activePreset = presetIdOf(theme);

  return (
    <div class="theme-editor">
      <span class="field-label">{label}</span>
      <div class="theme-presets" role="radiogroup" aria-label={label}>
        {THEME_PRESET_IDS.map((id) => {
          const preset = THEME_PRESETS[id];
          if (!preset) return null;
          return (
            <button
              key={id}
              type="button"
              class="theme-preset"
              aria-pressed={activePreset === id}
              style={{ '--swatch': preset.accent, '--swatch-bg': preset.bg, '--swatch-fg': preset.fg }}
              onClick={() => onChange(preset)}
            >
              {THEME_PRESET_LABELS[id]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
