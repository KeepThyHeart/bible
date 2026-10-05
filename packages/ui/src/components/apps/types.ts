import type { ReactNode } from 'react';

/** A small status marker on an app (unread count, "live" dot, ...). `label` is the already-translated accessible text. */
export interface AppNavBadge {
  kind: 'dot' | 'count' | 'text';
  value?: number | string;
  tone: 'neutral' | 'live' | 'attention';
  label: string;
}

/** One app as the shared navigation components see it: already resolved strings and an already rendered icon. */
export interface AppNavEntry {
  id: string;
  title: string;
  shortTitle?: string;
  icon: ReactNode;
  badge?: AppNavBadge;
  busy?: boolean;
  /** e.g. "Ctrl+Shift+2"; shown in the tooltip. */
  shortcutHint?: string;
}
