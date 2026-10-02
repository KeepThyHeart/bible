/**
 * Direction primitives shared by both apps (task 0076).
 *
 * Two independent directions, never inferred from each other:
 *  - **UI direction** (chrome): from the UI locale. Each app provides it once
 *    with `<DirectionProvider>`, fed from its own i18n service; shared
 *    components read it with `useDirection()` / `useIsRtl()`.
 *  - **Content direction**: from a module's language (`<ContentDir>`), with an
 *    optional user override. Scripture in Arabic stays RTL inside an English
 *    UI, and the KJV stays LTR inside an Arabic UI.
 *
 * Without a provider, `useDirection()` falls back to the document's `dir`
 * attribute, so a component rendered in a sandboxed extension iframe (where
 * the kit sets `<html dir>`) or in a test still gets the right answer.
 */

import { createContext, createElement, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { directionForLanguage } from '@bible/core/browser';
import type { LocaleDirection } from '@bible/core/browser';

export interface DirectionContextValue {
  /** UI (chrome) direction. */
  ui: LocaleDirection;
  /** Active UI locale tag (BCP 47), e.g. `ar`, `he-IL`. */
  locale: string;
}

const DirectionContext = createContext<DirectionContextValue | null>(null);

export interface DirectionProviderProps {
  value: DirectionContextValue;
  children?: ReactNode;
}

/** Provide the UI direction to every shared component below. */
export function DirectionProvider({ value, children }: DirectionProviderProps) {
  // Memoize on the two primitives so a parent re-render does not re-render every consumer.
  const memo = useMemo(() => ({ ui: value.ui, locale: value.locale }), [value.ui, value.locale]);
  return createElement(DirectionContext.Provider, { value: memo }, children);
}

function documentDirection(): LocaleDirection {
  if (typeof document === 'undefined') return 'ltr';
  return document.documentElement.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
}

/** The UI direction: the provider's, else `<html dir>`, else `ltr`. */
export function useDirection(): LocaleDirection {
  const ctx = useContext(DirectionContext);
  return ctx?.ui ?? documentDirection();
}

/** `useDirection() === 'rtl'`. */
export function useIsRtl(): boolean {
  return useDirection() === 'rtl';
}

/** The UI locale from the provider (undefined without one). */
export function useUiLocale(): string | undefined {
  return useContext(DirectionContext)?.locale;
}

export interface BdiProps {
  children?: ReactNode;
  /** Force a direction; default is the content's own first strong character. */
  dir?: LocaleDirection | 'auto';
  className?: string;
  lang?: string;
}

/**
 * An isolated inline run: module abbreviations, book names, references, user
 * titles, search terms - anything whose direction may differ from the
 * sentence around it. Renders `<bdi>`, which isolates by default in every
 * browser; `dir` is only emitted when forced.
 */
export function Bdi({ children, dir, className, lang }: BdiProps) {
  return createElement(
    'bdi',
    {
      dir: dir && dir !== 'auto' ? dir : undefined,
      className: className ? `kth-bdi ${className}` : undefined,
      lang,
    },
    children,
  );
}

/** User override for a module's content direction (`auto` = from its language). */
export type ContentDirOverride = 'auto' | LocaleDirection;

/** Resolve a content direction: an explicit override wins, else the module's language. */
export function resolveContentDir(lang: string | undefined | null, override?: ContentDirOverride | null): LocaleDirection {
  if (override === 'ltr' || override === 'rtl') return override;
  return directionForLanguage(lang);
}

export interface ContentDirProps {
  /** The module's language (BCP 47 / ISO 639), e.g. `ar`, `he`, `en`. */
  lang?: string | null;
  /** Optional user override; `auto` or absent means "from the language". */
  override?: ContentDirOverride | null;
  /** Element to render (default `div`). */
  as?: 'div' | 'section' | 'article' | 'span';
  className?: string;
  children?: ReactNode;
}

/**
 * A content container: sets `dir`, `lang` and `data-content-dir` from the
 * module's language so the bidi algorithm, fonts (`:lang()` stacks in KTH
 * CSS) and shaping rules all follow the text, not the UI.
 */
export function ContentDir({ lang, override, as = 'div', className, children }: ContentDirProps) {
  const dir = resolveContentDir(lang, override);
  return createElement(
    as,
    {
      dir,
      lang: lang || undefined,
      'data-content-dir': dir,
      className: className ? `kth-content ${className}` : 'kth-content',
    },
    children,
  );
}
