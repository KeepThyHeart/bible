/**
 * The extension hover popup's trigger/timing state machine (task 0036,
 * P0.1c; design doc §11.3, amendment A6).
 *
 * A plain Zustand store rather than a React hook so any Bible-pane surface
 * (`HighlightedVerse`, `CellEnglish`, a verse row) can trigger it with a
 * single imperative call on a mouse event, and `ExtensionUiHost.tsx` - which
 * already renders `ExtensionVersePopup` the same way - is the one place that
 * mounts the resulting `<ExtensionHoverPopup>`. Timers live in module scope,
 * not store state, the same "side effect beside the store" pattern
 * `extensionUiStore.ts` already uses for `notificationResolvers`.
 *
 * State machine (design doc §11.3):
 *
 *   mouseover word ──▶ [ HOVER_DWELL_MS 250ms ] ──▶ fire query
 *                                                    ├─ [150ms] ─▶ show popup shell + spinner
 *                                                    ├─ content arrives ─▶ render
 *                                                    └─ [~2000ms, enforced main-side per provider] ─▶ timeout, close silently
 *   mouseout ──▶ [ HOVER_CLOSE_GRACE_MS 120ms ] ──▶ close (cancelled by entering the popup)
 *
 * Static content (`DecorationDto.hoverContent`, already resolved - see
 * `DecorationResolver.ts` (core Annotations)'s `verseHovers`/`WordPaint.hovers`) bypasses all of
 * it except the dwell: it is already in hand when the dwell fires, so it
 * renders immediately with no loading state ever, exactly as design doc
 * §11.3 specifies. The callback path (`VerseHoverProviderDescriptor.
 * hoverEndpoint`) is fetched in parallel and merges in as it resolves.
 */

import { create, type StoreApi } from 'zustand';
import type { Extensions } from '@bible/core';
import { useAmbientPopupStore } from '../stores/useAmbientPopupStore';
import { invokeUiBridge } from './extensionRendererBridge';
import { useExtensionUiStore } from './extensionUiStore';
import type { ResolvedHover } from '@bible/core/browser';

type LocalizedString = Extensions.LocalizedString;
type HoverContentDto = Extensions.HoverContentDto;
type VerseHoverFetchRequest = Extensions.VerseHoverFetchRequest;
type VerseHoverFetchResponse = Extensions.VerseHoverFetchResponse;
type Surface = 'standard' | 'study' | 'reading';
type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta';

// Design doc §9/§11.3. `HOVER_FETCH_TIMEOUT_MS` (2000ms) is enforced
// main-side, per provider, inside the reverse-RPC closure `uiApiImpl.
// handleRegisterVerseHover` builds - `Promise.allSettled` in `Verse
// DecorationService.fetchHover` means the whole `fetchVerseHover` call
// already resolves within that bound for every provider, so there is no
// separate client-side fetch timeout to enforce here.
const HOVER_DWELL_MS = 250;
const HOVER_SPINNER_DELAY_MS = 150;
const HOVER_CLOSE_GRACE_MS = 120;

/** This store's identity in `useAmbientPopupStore` (one popup instance, app-wide). */
const OWNER_ID = 'extension-hover-popup';

export interface HoverSection {
  /** Stable per section within one popup render - `React.key` and the "which extension is talking" label. */
  key: string;
  extensionId: string;
  title?: LocalizedString;
  content: HoverContentDto | 'loading';
}

export interface HoverPopupState {
  position: { x: number; y: number };
  sections: HoverSection[];
}

/** What triggered the hover - a word or a whole verse (design doc §11.1). */
export interface HoverTarget {
  verseId: number;
  moduleId: number;
  moduleAbbrev: string;
  surface: Surface;
  word?: { renderedIndex: number; text: string };
  modifiers: Modifier[];
  position: { x: number; y: number };
  /** Already-resolved static hover content for this exact target (verse-level or word-level - see `DecorationResolver.ts` (core Annotations)). */
  staticHovers: ResolvedHover[];
}

interface VerseHoverPopupState {
  popup: HoverPopupState | null;
  /** Start the dwell timer for a new hover target. Call on `mouseenter`/`mouseover`. */
  hover(target: HoverTarget): void;
  /** Start the close-grace timer. Call on `mouseleave`/`mouseout`. A no-op that just cancels the pending dwell if nothing has shown yet. */
  scheduleClose(): void;
  /** Cancel a pending close - call on the popup's own `onMouseEnter`. */
  cancelClose(): void;
  /** Close immediately, no grace period - click-away, navigation, explicit dismiss. */
  closeNow(): void;
}

let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let spinnerTimer: ReturnType<typeof setTimeout> | null = null;
/** Bumped every time a dwell fires (a hover "wins") - invalidates any in-flight fetch from an earlier, now-superseded hover. */
let requestSeq = 0;

function clearShowTimer(): void {
  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }
}
function clearHideTimer(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}
function clearSpinnerTimer(): void {
  if (spinnerTimer) {
    clearTimeout(spinnerTimer);
    spinnerTimer = null;
  }
}

export const useVerseHoverPopupStore = create<VerseHoverPopupState>((set) => ({
  popup: null,

  hover(target) {
    // A new hover target pre-empts anything pending from a previous one -
    // including a scheduled close, so moving directly between two decorated
    // words never flashes a blank gap.
    clearShowTimer();
    clearHideTimer();
    showTimer = setTimeout(() => {
      showTimer = null;
      const mySeq = ++requestSeq;
      void openHover(set, target, mySeq);
    }, HOVER_DWELL_MS);
  },

  scheduleClose() {
    if (showTimer) {
      // Dwell never completed - nothing opened, nothing to close.
      clearShowTimer();
      return;
    }
    clearHideTimer();
    hideTimer = setTimeout(() => {
      hideTimer = null;
      closeNow(set);
    }, HOVER_CLOSE_GRACE_MS);
  },

  cancelClose() {
    clearHideTimer();
  },

  closeNow() {
    closeNow(set);
  },
}));

function closeNow(set: StoreApi<VerseHoverPopupState>['setState']): void {
  clearShowTimer();
  clearHideTimer();
  clearSpinnerTimer();
  requestSeq++; // invalidate any in-flight fetch
  set({ popup: null });
  useAmbientPopupStore.getState().release(OWNER_ID);
}

async function openHover(
  set: StoreApi<VerseHoverPopupState>['setState'],
  target: HoverTarget,
  mySeq: number,
): Promise<void> {
  const staticSections: HoverSection[] = target.staticHovers.map((h, i) => ({
    key: `static:${h.layerKey}:${i}`,
    extensionId: h.extensionId,
    content: h.content,
  }));

  if (staticSections.length > 0) {
    useAmbientPopupStore.getState().claim(OWNER_ID);
    set({ popup: { position: target.position, sections: staticSections } });
  }

  // Cheap synchronous check - skip the round-trip entirely when nothing is
  // even registered, which is the common case for most installs.
  const hasHoverProviders = useExtensionUiStore.getState().verseHoverProviders.length > 0; // allow-getstate: imperative read at trigger time, not a subscription
  if (!hasHoverProviders) {
    if (staticSections.length === 0) closeIfCurrent(set, mySeq);
    return;
  }

  clearSpinnerTimer();
  spinnerTimer = setTimeout(() => {
    spinnerTimer = null;
    if (mySeq !== requestSeq) return;
    useAmbientPopupStore.getState().claim(OWNER_ID);
    set((s) => ({
      popup: {
        position: target.position,
        sections: [...(s.popup?.sections ?? staticSections), { key: 'loading', extensionId: '', content: 'loading' }],
      },
    }));
  }, HOVER_SPINNER_DELAY_MS);

  try {
    const req: VerseHoverFetchRequest = {
      verseId: target.verseId,
      moduleId: target.moduleId,
      moduleAbbrev: target.moduleAbbrev,
      surface: target.surface,
      modifiers: target.modifiers,
      ...(target.word !== undefined ? { word: target.word } : {}),
    };
    const response = await invokeUiBridge<VerseHoverFetchResponse>('fetchVerseHover', [req]);
    if (mySeq !== requestSeq) return; // superseded by a later hover
    clearSpinnerTimer();

    const dynamicSections: HoverSection[] = [];
    for (const r of response.results) {
      // Failures (timeout/error/skipped) are omitted silently (design doc
      // §11.4) - the section just doesn't appear, no error UI.
      if (r.status !== 'ok') continue;
      r.content.forEach((content, i) => {
        dynamicSections.push({
          key: `${r.extensionId}::${r.providerId}:${i}`,
          extensionId: r.extensionId,
          ...(r.title !== undefined ? { title: r.title } : {}),
          content,
        });
      });
    }

    const combined = [...staticSections, ...dynamicSections];
    if (combined.length === 0) {
      // Nothing to show at all - close silently rather than leaving an
      // empty shell (or the spinner) on screen (design doc §11.4: "an empty
      // tooltip is worse than no tooltip").
      closeIfCurrent(set, mySeq);
      return;
    }
    useAmbientPopupStore.getState().claim(OWNER_ID);
    set({ popup: { position: target.position, sections: combined } });
  } catch {
    if (mySeq !== requestSeq) return;
    clearSpinnerTimer();
    // The IPC call itself failed (e.g. no bridge attached) - fall back to
    // whatever static content exists; close silently if none.
    if (staticSections.length === 0) closeIfCurrent(set, mySeq);
  }
}

/** Close, but only if `mySeq` is still the current (not superseded/already-closed) request. */
function closeIfCurrent(
  set: StoreApi<VerseHoverPopupState>['setState'],
  mySeq: number,
): void {
  if (mySeq !== requestSeq) return;
  set({ popup: null });
  useAmbientPopupStore.getState().release(OWNER_ID);
}

/** This store's ambient-popup owner id, exported so `ExtensionHoverPopup` can tell whether IT still owns the slot (vs. having been pre-empted). */
export const EXTENSION_HOVER_POPUP_OWNER_ID = OWNER_ID;

// Close this popup the moment another ambient popup (a Strong's tooltip, a
// note preview, an extension-panel verse popup) claims the shared slot
// (amendment A6: "close when another owner claims it"). One module-level
// subscription for the app's lifetime - mirrors how `extensionUiStore.ts`
// keeps `panelMessageListeners` outside any component.
useAmbientPopupStore.subscribe((s) => {
  if (s.owner !== OWNER_ID && useVerseHoverPopupStore.getState().popup !== null) {
    closeNow(useVerseHoverPopupStore.setState);
  }
});

/** Test-only reset. */
export function __resetVerseHoverPopupStore(): void {
  clearShowTimer();
  clearHideTimer();
  clearSpinnerTimer();
  requestSeq = 0;
  useVerseHoverPopupStore.setState({ popup: null });
}
