import { useMemo } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_XREF_HOPPER_LABELS,
  DEFAULT_XREF_WEB_LABELS,
  DEFAULT_XREF_ARCS_LABELS,
  DEFAULT_XREF_COMPASS_LABELS,
} from '@bible/ui';
import type { XrefHopperLabels, XrefWebViewLabels, XrefArcViewLabels, XrefCompassLabels } from '@bible/ui';

export interface XrefGraphLabels {
  hopper: XrefHopperLabels;
  web: XrefWebViewLabels;
  compass: XrefCompassLabels;
  arcs: XrefArcViewLabels;
}

type TFn = (key: string, options?: Record<string, unknown>) => string;

function build<T extends object>(view: string, defaults: T, t: TFn): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(defaults) as (keyof T & string)[]) {
    // The defaults carry single-brace placeholders ({ref}, {n}); i18next only
    // interpolates double braces, so they pass through for the view to fill.
    out[key] = t(`xrefGraph.${view}.${key}`, { defaultValue: defaults[key] });
  }
  return out as T;
}

/** Translated labels for the three shared cross-reference views, keyed `xrefGraph.<view>.<label>`. */
export function useXrefGraphLabels(): XrefGraphLabels {
  const { t, i18n } = useTranslation();
  return useMemo(() => ({
    hopper: build('hopper', DEFAULT_XREF_HOPPER_LABELS, t as unknown as TFn),
    web: build('web', DEFAULT_XREF_WEB_LABELS, t as unknown as TFn),
    compass: build('compass', DEFAULT_XREF_COMPASS_LABELS, t as unknown as TFn),
    arcs: build('arcs', DEFAULT_XREF_ARCS_LABELS, t as unknown as TFn),
  }), [t, i18n.language]);
}
