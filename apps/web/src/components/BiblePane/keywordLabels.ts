import type { KeywordLegendLabels, KeywordMarkEditorProps } from '@bible/ui';
import type { TFunction } from 'i18next';

const COLORS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const LINES = ['solid', 'dashed', 'dotted', 'thick', 'none'] as const;
const SYMBOLS: Record<string, string> = {
  '∴': 'therefore', '∵': 'because', '⇄': 'contrast', '→': 'arrow', '✚': 'cross', '◆': 'diamond',
  '●': 'circle', '▲': 'triangle', '■': 'square', '★': 'star', '†': 'dagger', '?': 'question',
};
const KINDS = ['word', 'phrase', 'strongs', 'connective'] as const;
const CATEGORIES = ['inference', 'reason', 'contrast', 'purpose', 'condition', 'comparison', 'time'] as const;

/** Legend strings from the `keywordMarks` catalog. */
export function legendLabels(t: TFunction): KeywordLegendLabels {
  const k = (key: string, opts?: Record<string, unknown>) => t(`keywordMarks.${key}`, opts) as string;
  return {
    title: k('title'),
    toggle: k('toggle'),
    empty: k('empty'),
    count: (count) => k('count', { count }),
    show: (label) => k('show', { label }),
    hide: (label) => k('hide', { label }),
    next: (label) => k('next', { label }),
    prev: (label) => k('prev', { label }),
    edit: (label) => k('edit', { label }),
    approximate: k('approximate'),
    approximateHint: k('approximateHint'),
    add: k('add'),
    manageSets: k('manageSets'),
    suggestions: k('suggestions'),
    addSuggestion: (label) => k('addSuggestion', { label }),
  };
}

/** Mark-editor (and its style picker) strings from the `keywordMarks` catalog. */
export function editorLabels(t: TFunction): NonNullable<KeywordMarkEditorProps['labels']> {
  const k = (key: string) => t(`keywordMarks.${key}`) as string;
  const colors = Object.fromEntries(COLORS.map((n) => [`mark.${n}`, k(`style.colors.color${n}`)]));
  const lines = Object.fromEntries(LINES.map((l) => [l, k(`style.lines.${l}`)]));
  const symbols = Object.fromEntries(Object.entries(SYMBOLS).map(([glyph, name]) => [glyph, k(`style.symbols.${name}`)]));
  return {
    label: k('editor.label'),
    labelHint: k('editor.labelHint'),
    ruleKind: k('editor.ruleKind'),
    kinds: Object.fromEntries(KINDS.map((x) => [x, k(`editor.kinds.${x}`)])),
    forms: k('editor.forms'),
    formsHint: k('editor.formsHint'),
    phrase: k('editor.phrase'),
    strongs: k('editor.strongs'),
    strongsHint: k('editor.strongsHint'),
    category: k('editor.category'),
    categories: Object.fromEntries(CATEGORIES.map((x) => [x, k(`editor.categories.${x}`)])),
    matchCase: k('editor.matchCase'),
    style: k('editor.style'),
    enabled: k('editor.enabled'),
    save: k('editor.save'),
    cancel: k('editor.cancel'),
    delete: k('editor.delete'),
    errors: { label: k('editor.errorLabel') },
    ruleErrors: Object.fromEntries(KINDS.map((x) => [x, k(`editor.ruleErrors.${x}`)])),
    stylePicker: {
      colorGroup: k('style.colorGroup'),
      lineGroup: k('style.lineGroup'),
      symbolGroup: k('style.symbolGroup'),
      noSymbol: k('style.noSymbol'),
      bold: k('style.bold'),
      fill: k('style.fill'),
      colors,
      lines,
      symbols,
    },
  } as NonNullable<KeywordMarkEditorProps['labels']>;
}
