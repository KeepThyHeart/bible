/**
 * Formats passages (the store holds ranges only) in the UI language: "John 3", "Rom 8:28-39".
 * The reference engine's locale data loads on demand, so the hook re-renders once it has arrived.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { referenceEngineFor } from '@bible/core/browser';
import type { ReferenceEngine, ReferenceRange } from '@bible/core/browser';
import type { AudioPassage } from '@bible/audio';
import { ensureReferenceLocales } from '../../../services/localizedReferenceParser';
import { useI18n } from '../../../contexts/useI18n';

export function toRange(p: AudioPassage): ReferenceRange {
  const r: ReferenceRange = { book: p.book as ReferenceRange['book'], chapter: p.chapter };
  if (p.verse !== undefined) r.verse = p.verse;
  if (p.endChapter !== undefined) r.endChapter = p.endChapter;
  if (p.endVerse !== undefined) r.endVerse = p.endVerse;
  return r;
}

export interface PassageLabeler {
  engine: ReferenceEngine;
  /** "Rom 8:28-39" */
  label(p: AudioPassage): string;
  /** "Ps 23; Rom 8:28-39": the text the editor shows for a list (parses back to the same list). */
  listText(passages: readonly AudioPassage[]): string;
}

export function usePassageLabel(): PassageLabeler {
  const { locale } = useI18n();
  const [ready, setReady] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(ensureReferenceLocales([locale])).catch(() => {}).then(() => { if (!cancelled) setReady((n) => n + 1); });
    return () => { cancelled = true; };
  }, [locale]);
  // `ready` re-creates the engine once the locale's names have loaded.
  const engine = useMemo(() => referenceEngineFor(locale), [locale, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = useCallback((p: AudioPassage) => engine.format(toRange(p)), [engine]);
  const listText = useCallback((passages: readonly AudioPassage[]) => passages.map((p) => engine.format(toRange(p))).join('; '), [engine]);
  return useMemo(() => ({ engine, label, listText }), [engine, label, listText]);
}
