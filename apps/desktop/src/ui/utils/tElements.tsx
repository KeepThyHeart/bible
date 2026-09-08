/**
 * Render one whole ICU message that contains placeholders which must come out
 * as React elements rather than text.
 *
 * ## Why this exists
 *
 * The recurring i18n defect this replaces is a sentence assembled at render
 * time out of several `t()` calls with JSX between them:
 *
 * ```tsx
 * <kbd>Enter</kbd> {t('searchBar.toSearch')}   // WRONG: English word order baked in
 * ```
 *
 * English happens to put the key name first; Hindi is verb-final and cannot,
 * and Arabic needs the whole run under one bidi context. The fix is one ICU
 * message per sentence - `"{key} to search"` - so the translator owns the word
 * order. That only works if a placeholder can render as markup.
 *
 * `II18nService.t()` returns a `string`, and the app deliberately has no
 * rich-text i18n layer (the only other markup-in-string mechanism is
 * `sanitizeHtml` + `dangerouslySetInnerHTML` in the documentation renderer,
 * which cannot carry styled React elements). Rather than introduce a second
 * i18n mechanism, this helper keeps the ICU string whole and splits the
 * *formatted* result at the placeholder.
 *
 * ## How
 *
 * Each element placeholder is formatted as a NUL-delimited sentinel
 * (`\u0000name\u0000`) and the result is split on it. Substituting through ICU
 * rather than string-replacing the raw message matters: ICU escaping (`''`),
 * plural/select branches and any co-occurring text placeholders all keep
 * working exactly as `locales/README.md` documents. NUL cannot appear in a
 * catalog string that survived JSON parsing, so the sentinel is unambiguous.
 *
 * ## Usage
 *
 * ```tsx
 * {tElements(t, 'searchBar.hintSearch', {
 *   key: <kbd dir="ltr">{t('searchBar.enterKey')}</kbd>,
 * })}
 * ```
 *
 * Element placeholders are documented for translators like any other ICU
 * placeholder: moveable within the sentence, never renamed or dropped.
 */

import React from 'react';

/** Delimiter for element placeholders. Never occurs in catalog text. */
const NUL = '\u0000';

/** Matches a sentinel and captures the placeholder name. */
const SENTINEL_RE = /\u0000(\w+)\u0000/;

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

/**
 * Format `key` and return a React node list in which each name in `elements`
 * has been replaced by its node.
 *
 * @param t         `t` from `useI18n()`.
 * @param key       Catalog key of the complete message.
 * @param elements  Placeholder name -> React node.
 * @param params    Ordinary (text) ICU params, if the message has any.
 */
export function tElements(
  t: TranslateFn,
  key: string,
  elements: Record<string, React.ReactNode>,
  params?: Record<string, unknown>,
): React.ReactNode {
  const values: Record<string, unknown> = { ...params };
  for (const name of Object.keys(elements)) {
    values[name] = `${NUL}${name}${NUL}`;
  }

  const formatted = t(key, values);

  // `String.split` with a capturing group interleaves literals and captures:
  // even indices are literal text, odd indices are placeholder names.
  const parts = formatted.split(SENTINEL_RE);
  if (parts.length === 1) return formatted;

  return parts.map((part, i) => {
    if (i % 2 === 1) {
      // Unknown names cannot occur - we only substituted names we were handed -
      // but be defensive rather than render `undefined`.
      return <React.Fragment key={i}>{elements[part] ?? null}</React.Fragment>;
    }
    return part === '' ? null : <React.Fragment key={i}>{part}</React.Fragment>;
  });
}
