/**
 * What an app *is*, as data (task 0080). Small, loaded at boot, identical on
 * both platforms. The code (the view, its stores) is bound separately per
 * platform by an `AppBinding` and loaded on first activation.
 *
 * An `AppDescriptor` is exactly one item of a feature module's
 * `contributes.apps` (see `Modules/Contributes.ts`).
 */

import type { HostPlatform, LabelRef } from '../Modules/types';

/** `study`, `present`; extensions (M3): `ext.kth.bible-memory.memorize`. */
export type AppId = string;

/** The id of the built-in reading/study workspace, the host's default app. */
export const STUDY_APP_ID: AppId = 'study';

export type AppIcon =
  /** A host icon name (Font Awesome on web, lucide on desktop; each app maps it). */
  | { readonly kind: 'builtin'; readonly name: string }
  /** Extensions: `ext-ui://<id>/media/icon.svg`, always rendered through `<img>`. */
  | { readonly kind: 'image'; readonly src: string };

/**
 * What happens to an app's view when another app is shown.
 *
 * - `always`: stays mounted (hidden + inert) for the rest of the session.
 *   Study uses it: dockview and the reader are expensive to rebuild.
 * - `while-busy`: stays mounted while the app reports busy (`setBusy`), and
 *   is unmounted after `idleGraceMs` once hidden and idle. The Presenter
 *   (busy = a session is live).
 * - `never`: unmounted as soon as another app is shown. Its state comes back
 *   from its own store. The default for extension apps.
 */
export type AppKeepAlive = 'always' | 'while-busy' | 'never';

/**
 * Whether a restart reopens this app when it was the active one.
 *
 * - `reopen`: yes;
 * - `while-busy`: only if the app is busy at boot (the Presenter with a saved
 *   live session: the shell marks it busy before resolving the initial app);
 * - `default`: no, the default app (Study) opens instead.
 */
export type AppRestorePolicy = 'reopen' | 'while-busy' | 'default';

export interface AppLifecycle {
  readonly keepAlive: AppKeepAlive;
  readonly restore: AppRestorePolicy;
}

export interface AppDescriptor {
  readonly id: AppId;
  readonly title: LabelRef;
  /** Rail tooltip / sheet label when space is tight. */
  readonly shortTitle?: LabelRef;
  readonly icon: AppIcon;
  /** Order hint; clamped into the source's band by the registry. */
  readonly order?: number;
  /**
   * Context expression (cheap data predicate) evaluated by the shell, e.g.
   * `server.present`. False: the app is hidden from surfaces and cannot be
   * activated. Absent: always available.
   */
  readonly when?: string;
  /** Default: both. Items for another platform are skipped at registration. */
  readonly platforms?: readonly HostPlatform[];
  readonly lifecycle: AppLifecycle;
  /** `#/@<segment>[/route]` on web, `app:<segment>[/route]` on desktop. Default: the id. */
  readonly deepLink?: { readonly segment: string };
  /** Preferences section id for the app's settings. */
  readonly settingsSection?: string;
  /** Phones: listed in the Apps sheet (default) or hidden there. */
  readonly mobile?: 'sheet' | 'hidden';
  /** The app draws its own top bar (with the app switcher and a way back); phones skip the shell's bar. */
  readonly ownChrome?: boolean;
}

export type AppBadgeKind = 'dot' | 'count' | 'text';
export type AppBadgeTone = 'neutral' | 'live' | 'attention';

/** A small status mark shown on nav items (rail, tiles, menu). */
export interface AppBadge {
  readonly kind: AppBadgeKind;
  /** `count`: a number (shown as `99+` above 99). `text`: up to 4 characters. */
  readonly value?: number | string;
  readonly tone: AppBadgeTone;
  /** Accessible text, already localized: "5 verses due", "Live". Required. */
  readonly label: string;
}

const BADGE_LABEL_MAX = 80;
const BADGE_TEXT_MAX = 4;

/**
 * Validate and normalise a badge: caps counts at `99+`, trims text to four
 * characters and the label to 80, drops an empty count. Returns undefined for
 * a badge that should not show (count 0, missing label).
 */
export function normalizeBadge(badge: AppBadge | undefined): AppBadge | undefined {
  if (!badge) return undefined;
  const label = typeof badge.label === 'string' ? badge.label.trim().slice(0, BADGE_LABEL_MAX) : '';
  if (!label) return undefined;
  const tone: AppBadgeTone = badge.tone === 'live' || badge.tone === 'attention' ? badge.tone : 'neutral';
  switch (badge.kind) {
    case 'dot':
      return { kind: 'dot', tone, label };
    case 'count': {
      const n = typeof badge.value === 'number' ? Math.floor(badge.value) : Number.NaN;
      if (!Number.isFinite(n) || n <= 0) return undefined;
      return { kind: 'count', value: n > 99 ? '99+' : n, tone, label };
    }
    case 'text': {
      const text = typeof badge.value === 'string' ? [...badge.value.trim()].slice(0, BADGE_TEXT_MAX).join('') : '';
      if (!text) return undefined;
      return { kind: 'text', value: text, tone, label };
    }
    default:
      return undefined;
  }
}

/** The deep-link segment of an app (its id unless the descriptor says otherwise). */
export function appLinkSegment(desc: Pick<AppDescriptor, 'id' | 'deepLink'>): string {
  return desc.deepLink?.segment ?? desc.id;
}
