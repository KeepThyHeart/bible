import { useMemo } from 'react';
import {
  DEFAULT_XREF_HOPPER_LABELS,
  DEFAULT_XREF_WEB_LABELS,
  DEFAULT_XREF_ARCS_LABELS,
  DEFAULT_XREF_COMPASS_LABELS,
  type XrefHopperLabels,
  type XrefWebViewLabels,
  type XrefArcViewLabels,
  type XrefCompassLabels,
} from '@bible/ui';
import { useI18n } from '../../contexts/useI18n';

import { translateWithDefault } from '../../utils/translateWithDefault';

type T = (key: string, params?: Record<string, unknown>) => string;

export interface XrefGraphLabels {
  hopper: XrefHopperLabels;
  web: XrefWebViewLabels;
  compass: XrefCompassLabels;
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
      compass: build(t, 'compass', DEFAULT_XREF_COMPASS_LABELS),
      arcs: build(t, 'arcs', DEFAULT_XREF_ARCS_LABELS),
    }),
    [t],
  );
}
