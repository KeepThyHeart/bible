import { useMemo } from 'react';
import { isFontInstalled } from '@bible/ui';

/** What a font picker needs from either font list (`AVAILABLE_FONT_FAMILIES` or `AVAILABLE_FONTS`). */
export interface PickableFont {
  /** The value stored when picked. */
  value: string;
  label: string;
  labelKey?: string;
  stack: string;
  kind?: 'serif' | 'sans';
  family?: string;
  origin?: string;
}

export interface FontGroups {
  /** Entries with no kind (System Default): listed first, ungrouped. */
  general: PickableFont[];
  serif: PickableFont[];
  sans: PickableFont[];
}

/**
 * Split a font list into the groups a picker shows, keeping only the faces this machine has
 * (bundled ones always). `keepValue` - the saved choice - stays listed even if it is missing here, flagged
 * `missing`, so the picker keeps showing what is stored instead of silently selecting something else.
 */
export function groupOfferedFonts(
  fonts: PickableFont[],
  keepValue: string | undefined,
  installed: (family: string) => boolean = isFontInstalled,
): { groups: FontGroups; missing: PickableFont | null } {
  const groups: FontGroups = { general: [], serif: [], sans: [] };
  let missing: PickableFont | null = null;
  for (const f of fonts) {
    const available = !f.family || f.origin === 'bundled' || installed(f.family);
    if (!available) {
      if (f.value === keepValue) missing = f;
      continue;
    }
    if (f.kind === 'serif') groups.serif.push(f);
    else if (f.kind === 'sans') groups.sans.push(f);
    else groups.general.push(f);
  }
  return { groups, missing };
}

export function useOfferedFonts(fonts: PickableFont[], keepValue: string | undefined) {
  return useMemo(() => groupOfferedFonts(fonts, keepValue), [fonts, keepValue]);
}
