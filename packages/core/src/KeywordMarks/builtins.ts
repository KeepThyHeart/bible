import { CONNECTIVE_CATEGORIES, type KeywordSet, type KeywordMark } from './types';
import { CONNECTIVE_LEXICON } from './connectives';

const BUILT_IN_DATE = '2026-09-29T00:00:00.000Z';

function connectiveSet(language: 'en' | 'es'): KeywordSet {
  const marks: KeywordMark[] = CONNECTIVE_CATEGORIES.map((category) => {
    const e = CONNECTIVE_LEXICON[category];
    return {
      id: `${language}:${category}`,
      label: e.labels[language],
      rule: { kind: 'connective', category },
      // Time shares its shape with inference, so it gets its own line: colour-safe marks stay distinguishable.
      style: { color: e.color, line: category === 'reason' ? 'dashed' : category === 'contrast' ? 'thick' : category === 'time' ? 'dotted' : 'solid', symbol: e.symbol },
      // Condition, comparison and time are noisy; off until the reader turns them on.
      enabled: category === 'inference' || category === 'reason' || category === 'contrast' || category === 'purpose',
    };
  });
  return {
    schema: 1,
    id: `builtin:connectives-${language}`,
    name: language === 'en' ? 'Connectives' : 'Conectores',
    language,
    scope: { kind: 'everywhere' },
    marks,
    builtIn: `connectives-${language}`,
    updatedAt: BUILT_IN_DATE,
  };
}

/** Shipped, read-only sets. Never stored; duplicate one to edit it. */
export const BUILT_IN_KEYWORD_SETS: readonly KeywordSet[] = [connectiveSet('en'), connectiveSet('es')];
