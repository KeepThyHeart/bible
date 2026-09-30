import { useMemo } from 'react';
import {
  DEFAULT_XREF_HOPPER_LABELS,
  DEFAULT_XREF_WEB_LABELS,
  DEFAULT_XREF_ARCS_LABELS,
  DEFAULT_XREF_CONSTELLATION_LABELS,
  type XrefHopperLabels,
  type XrefWebViewLabels,
  type XrefArcViewLabels,
  type XrefConstellationLabels,
} from '@bible/ui';
import { useI18n } from '../contexts/useI18n';

type T = (key: string, params?: Record<string, unknown>) => string;

/**
 * Translate `key`, falling back to `defaultValue` when the catalog has no entry
 * (the i18n service answers `[key]` for a missing key).
 *
 * Single-brace placeholders in the English default (`{ref}`, `{n}`) belong to
 * the shared views, which substitute them themselves, so each is passed to the
 * ICU formatter as its own literal `{name}` text and survives untouched.
 */
export function translateWithDefault(t: T, key: string, defaultValue: string): string {
  const names = Array.from(new Set(Array.from(defaultValue.matchAll(/\{(\w+)\}/g), (m) => m[1])));
  const params = names.length > 0
    ? Object.fromEntries(names.map((name) => [name, `{${name}}`]))
    : undefined;
  const result = t(key, params);
  return result === `[${key}]` || result === key ? defaultValue : result;
}

export interface XrefGraphLabels {
  hopper: XrefHopperLabels;
  web: XrefWebViewLabels;
  constellation: XrefConstellationLabels;
  arcs: XrefArcViewLabels;
}

function build<L extends object>(t: T, view: string, defaults: L): L {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(defaults)) {
    out[name] = translateWithDefault(t, `xrefGraph.${view}.${name}`, value as string);
  }
  return out as L;
}

/** Localized labels for the three shared cross-reference graph views. */
export function useXrefGraphLabels(): XrefGraphLabels {
  const { t } = useI18n();
  return useMemo(
    () => ({
      hopper: build(t, 'hopper', DEFAULT_XREF_HOPPER_LABELS),
      web: build(t, 'web', DEFAULT_XREF_WEB_LABELS),
      constellation: build(t, 'constellation', DEFAULT_XREF_CONSTELLATION_LABELS),
      arcs: build(t, 'arcs', DEFAULT_XREF_ARCS_LABELS),
    }),
    [t],
  );
}
