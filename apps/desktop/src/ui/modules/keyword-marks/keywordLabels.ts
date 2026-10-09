/**
 * i18n wiring for the shared keyword-mark components (task 0065): builds the `labels` props of `KeywordLegend`
 * and `KeywordMarkEditor` from the desktop catalog (`keywords.*`).
 */
import type { KeywordLegendLabels, KeywordMarkEditorLabels } from '@bible/ui';

type T = (key: string, params?: Record<string, string | number>) => string;

export function legendLabels(t: T): KeywordLegendLabels {
  return {
    title: t('keywords.legend.title'),
    toggle: t('keywords.legend.toggle'),
    empty: t('keywords.legend.empty'),
    count: (n) => t('keywords.legend.count', { count: n }),
    show: (label) => t('keywords.legend.show', { label }),
    hide: (label) => t('keywords.legend.hide', { label }),
    next: (label) => t('keywords.legend.next', { label }),
    prev: (label) => t('keywords.legend.prev', { label }),
    edit: (label) => t('keywords.legend.edit', { label }),
    approximate: t('keywords.legend.approximate'),
    approximateHint: t('keywords.legend.approximateHint'),
    add: t('keywords.legend.add'),
    manageSets: t('keywords.legend.manageSets'),
    suggestions: t('keywords.legend.suggestions'),
    addSuggestion: (label) => t('keywords.legend.addSuggestion', { label }),
  };
}

export function editorLabels(t: T): Partial<KeywordMarkEditorLabels> {
  const cat = (k: string) => t(`keywords.editor.category.${k}`);
  return {
    label: t('keywords.editor.label'),
    labelHint: t('keywords.editor.labelHint'),
    ruleKind: t('keywords.editor.ruleKind'),
    kinds: {
      word: t('keywords.editor.kind.word'),
      phrase: t('keywords.editor.kind.phrase'),
      strongs: t('keywords.editor.kind.strongs'),
      connective: t('keywords.editor.kind.connective'),
    },
    forms: t('keywords.editor.forms'),
    formsHint: t('keywords.editor.formsHint'),
    phrase: t('keywords.editor.phrase'),
    strongs: t('keywords.editor.strongs'),
    strongsHint: t('keywords.editor.strongsHint'),
    category: t('keywords.editor.category'),
    categories: {
      inference: cat('inference'), reason: cat('reason'), contrast: cat('contrast'), purpose: cat('purpose'),
      condition: cat('condition'), comparison: cat('comparison'), time: cat('time'),
    },
    matchCase: t('keywords.editor.matchCase'),
    style: t('keywords.editor.style'),
    enabled: t('keywords.editor.enabled'),
    save: t('keywords.editor.save'),
    cancel: t('keywords.editor.cancel'),
    delete: t('keywords.editor.delete'),
    errors: { label: t('keywords.editor.error.label') },
    ruleErrors: {
      word: t('keywords.editor.error.word'),
      phrase: t('keywords.editor.error.phrase'),
      strongs: t('keywords.editor.error.strongs'),
      connective: t('keywords.editor.error.connective'),
    },
    stylePicker: {
      colorGroup: t('keywords.style.colorGroup'),
      lineGroup: t('keywords.style.lineGroup'),
      symbolGroup: t('keywords.style.symbolGroup'),
      noSymbol: t('keywords.style.noSymbol'),
      bold: t('keywords.style.bold'),
      fill: t('keywords.style.fill'),
    } as KeywordMarkEditorLabels['stylePicker'],
  };
}
