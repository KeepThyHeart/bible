/**
 * "Which passage?" - reference parsing, translation choice and fetching for
 * every dialog that quotes scripture.
 *
 * This began as the toolbar-only half of the insert dialog: the Tab flow
 * arrives with a reference already parsed and its verses already fetched,
 * because the reference was sitting in the document, while "+ Bible Passage"
 * has none of that. It is now what the *copy* dialog uses as well, which
 * retired a second, weaker implementation living inline in
 * `CopyOptionsDialog` - that one fetched on blur and on Enter rather than as
 * you type, had no translation picker, and reached for the Bible pane's
 * abbreviation directly, which is the `_default` panel-id defect described in
 * `docs/features/notes-writing.md`.
 *
 * **A caller that already has verses seeds them** through `initialVerses`, and
 * the hook will not re-fetch the reference they came from. That is what lets
 * the copy dialog open showing its passage immediately instead of blanking for
 * a debounce and then filling in.
 *
 * The hook is inert when `enabled` is false, for a caller that wants none of
 * this.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ReferenceParser } from '@bible/core';
import { useBibleStore } from '../../../stores/useBibleStore';
import { getActiveTranslation, resolveReferenceRange } from '../../../services/verseExpansionService';
import { getVersesCached, type CachedVerse } from '../../../services/verseFetchCache';

/** How long the field stays quiet before a keystroke turns into a fetch. */
const DEBOUNCE_MS = 300;

/** Stable empty list, so the default does not re-render on every store read. */
const EMPTY_BIBLES: Array<{ abbreviation: string; name: string }> = [];

export type PassageResolveStatus =
  /** Nothing typed yet. */
  | 'empty'
  /** Typed, but not a reference this app can parse. */
  | 'invalid'
  /** Parsed; the fetch is in flight. */
  | 'loading'
  /** Parsed and fetched, but the module has no such verses. */
  | 'notfound'
  /** Verses in hand. */
  | 'ok'
  /** The fetch itself failed. */
  | 'error'
  /** No Bible module is installed, so there is nothing to quote. */
  | 'noTranslation';

export interface PassageResolver {
  reference: string;
  setReference: (value: string) => void;
  translation: string;
  setTranslation: (value: string) => void;
  /** Every installed Bible, for the translation picker. */
  translations: Array<{ abbreviation: string; name: string }>;
  verses: CachedVerse[];
  status: PassageResolveStatus;
  /**
   * The box has been edited past what `verses` answers to.
   *
   * The caller needs this to refuse a commit: the reference resolves on a
   * debounce, so Enter typed straight after the last character of a reference
   * lands while the *previous* passage is still in hand, and acting on it
   * would copy or insert something the user has already replaced on screen.
   */
  isStale: boolean;
}

export interface UsePassageResolverOptions {
  enabled: boolean;
  initialReference: string;
  initialTranslation: string;
  /**
   * Verses the caller has already fetched for `initialReference`.
   *
   * Seeds the hook as though it had just resolved them, and suppresses the
   * first fetch - without this the dialog would open on an empty status line,
   * throw away a passage it already had, and re-fetch it 300ms later.
   */
  initialVerses?: CachedVerse[];
}

/**
 * The translation to quote from when the dialog opens.
 *
 * Takes what the Bible pane is showing, then the first installed module, and
 * only gives up when there genuinely is none. Nothing here asks the user to
 * make a choice they have already made by opening a Bible.
 */
function resolveDefaultTranslation(
  available: Array<{ abbreviation: string }>,
  fallback: string,
): string {
  const active = getActiveTranslation() || fallback;
  if (active) {
    // Match the picker's own casing, or the <select> silently falls back to
    // its first option instead of showing the value we resolved.
    const match = available.find(b => b.abbreviation.toLowerCase() === active.toLowerCase());
    if (match) return match.abbreviation;
    // The module list has not loaded yet; the open tab is still a better
    // answer than nothing, and this is re-normalised once the list arrives.
    if (available.length === 0) return active;
  }
  return available[0]?.abbreviation ?? '';
}

/** Identity of a resolution, so an unchanged one is not fetched twice. */
function resolutionKey(reference: string, translation: string): string {
  return `${reference}\0${translation}`;
}

export function usePassageResolver({
  enabled,
  initialReference,
  initialTranslation,
  initialVerses,
}: UsePassageResolverOptions): PassageResolver {
  const [reference, setReference] = useState(initialReference);
  const [translation, setTranslation] = useState(initialTranslation);
  const [verses, setVerses] = useState<CachedVerse[]>(() => initialVerses ?? []);
  const [status, setStatus] = useState<PassageResolveStatus>(
    initialVerses && initialVerses.length > 0 ? 'ok' : 'empty',
  );

  /**
   * The reference/translation pair the current `verses` belong to. Seeded from
   * the caller's own fetch so the opening render is already the answer, and
   * updated on every resolution so an unchanged pair (a re-render, a
   * translation list arriving and re-normalising to the same value) does not
   * fetch again.
   */
  const resolvedKey = useRef<string | null>(
    initialVerses && initialVerses.length > 0
      ? resolutionKey(initialReference, initialTranslation)
      : null,
  );

  // Defaulted rather than asserted: the dialog renders inside detached notes
  // windows, whose renderer has its own store that has not loaded the module
  // list yet. An empty list is a real state here, not a broken one.
  const availableBibles = useBibleStore(s => s.availableBibles) ?? EMPTY_BIBLES;
  const loadAvailableBibles = useBibleStore(s => s.loadAvailableBibles);

  // A detached notes window is its own renderer with its own empty store, so
  // the dialog can be the first thing that needs the module list. Load it
  // rather than concluding no Bible is installed.
  useEffect(() => {
    if (!enabled) return;
    if (availableBibles.length === 0) void loadAvailableBibles?.();
  }, [enabled, availableBibles.length, loadAvailableBibles]);

  useEffect(() => {
    if (!enabled) return;
    setTranslation(prev =>
      prev && (availableBibles.length === 0 || availableBibles.some(b => b.abbreviation === prev))
        ? prev
        : resolveDefaultTranslation(availableBibles, initialTranslation),
    );
  }, [enabled, availableBibles, initialTranslation]);

  const resolve = useCallback(
    async (text: string, version: string, isCancelled: () => boolean): Promise<void> => {
      if (!text.trim()) {
        setVerses([]);
        setStatus('empty');
        return;
      }

      // `allowWholeBook`: this dialog only ever takes a reference, so a bare
      // "John" here is unambiguous - unlike in the search box, where it is a
      // word to look for. The help popover beside the field has always
      // advertised it.
      const parsed = new ReferenceParser().parse(text, { allowWholeBook: true });
      // The range maths lives in `resolveReferenceRange`, which is the same one
      // the notes expansion path uses. Computing it here instead had quietly
      // broken three of the six forms the help popover promises: "John 3"
      // fetched only verse 1, "John 3-5" only 3:1, and a whole book was
      // unreachable, because an absent verse defaulted to a *single* verse
      // rather than to the end of the span.
      const range = parsed.isValid ? resolveReferenceRange(parsed) : null;
      if (!range) {
        setVerses([]);
        setStatus('invalid');
        return;
      }

      if (!version) {
        setVerses([]);
        setStatus('noTranslation');
        return;
      }

      setStatus('loading');

      try {
        const fetched = await getVersesCached(version, range.startId, range.endId);
        if (isCancelled()) return;
        setVerses(fetched);
        setStatus(fetched.length === 0 ? 'notfound' : 'ok');
        if (fetched.length > 0) resolvedKey.current = resolutionKey(text, version);
      } catch {
        if (isCancelled()) return;
        setVerses([]);
        setStatus('error');
      }
    },
    [],
  );

  useEffect(() => {
    if (!enabled) return undefined;
    // Already holding the verses for exactly this reference - the caller
    // fetched them, or we just did. Re-fetching would blank the preview for a
    // debounce to arrive at the same answer.
    if (resolvedKey.current === resolutionKey(reference, translation)) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      void resolve(reference, translation, () => cancelled);
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, reference, translation, resolve]);

  return {
    reference,
    setReference,
    translation,
    setTranslation,
    translations: availableBibles.map(b => ({ abbreviation: b.abbreviation, name: b.name })),
    verses,
    status,
    isStale: enabled && resolvedKey.current !== resolutionKey(reference, translation),
  };
}
