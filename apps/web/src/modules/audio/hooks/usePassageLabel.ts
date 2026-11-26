/** Formats passages and parses typed lists with the reference engine of the UI language (the store holds ranges only). */

import { useMemo } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { referenceEngineFor, ReadingPlans } from '@bible/core/browser';
import type { ReferenceEngine, ReferenceRange } from '@bible/core/browser';
import type { AudioPassage } from '@bible/audio';
import { moduleStore } from '../../../stores/moduleStore';

const engines = new Map<string, ReferenceEngine>();

export function engineFor(locale: string): ReferenceEngine {
  let e = engines.get(locale);
  if (!e) {
    try { e = referenceEngineFor(locale); } catch { e = referenceEngineFor('en'); }
    engines.set(locale, e);
  }
  return e;
}

export const chapterCountOf = (book: number): number =>
  moduleStore.getBookByNumber(book)?.chapter_count ?? ReadingPlans.chapterCount(book);

export const rangeOf = (p: AudioPassage): ReferenceRange => ({ ...p });

export function usePassageLabel(): (p: AudioPassage) => string {
  const { i18n } = useTranslation();
  const lang = i18n?.language || 'en';
  return useMemo(() => {
    const engine = engineFor(lang);
    return (p: AudioPassage) => engine.format(rangeOf(p));
  }, [lang]);
}
