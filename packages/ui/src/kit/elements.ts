/**
 * The kit's element table: tag -> component + attribute/event contract. Attributes and events are additive-only
 * within kit major 1. Keep the tag list identical to `UI_KIT_COMPONENTS['1']` in core (a test enforces it).
 *
 * Colours and labels never come from attributes as markup: strings are rendered as text by the components, and
 * the swatch fill comes from core's palette. Object/function inputs (`labels`) are properties only.
 */
import { createElement, useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { ENGLISH_BOOK_NAMES, HIGHLIGHT_COLOR_NAMES, VerseIdHelper } from '@bible/core/browser';
import type { HighlightColor } from '@bible/core/browser';
import { BookChapterPicker } from '../components/BookChapterPicker';
import { HighlightSwatch } from '../components/HighlightSwatch';
import { ReferencePicker } from '../components/ReferencePicker';
import { getPickerParsers } from '../components/referenceInput';
import type { ReferenceValue } from '../components/referenceInput';
import type { KthElementSpec } from './defineKthElement';
import type { KitLocale } from './kitLocale';

type Loose = Record<string, unknown>;

/** Locale/direction from the kit store unless the element sets its own. */
function withLocale(props: Loose, l: KitLocale): Loose {
  return { ...props, locale: props.locale ?? l.locale, dir: props.dir ?? l.direction };
}

/** Fold single-string label attributes into `labels`; the attribute beats the `labels` property for that key. */
function mergeLabels(props: Loose, fromAttrs: Readonly<Record<string, string>>): Loose {
  const out: Loose = { ...props };
  const labels: Loose = { ...(typeof props.labels === 'object' && props.labels !== null ? (props.labels as Loose) : {}) };
  for (const [prop, key] of Object.entries(fromAttrs)) {
    if (typeof out[prop] === 'string') labels[key] = out[prop];
    delete out[prop];
  }
  out.labels = labels;
  return out;
}

// --- kth-reference-picker ---------------------------------------------------------------------------------------

/**
 * Keeps the typed text in the element's own state; the `value` attribute seeds it and a later change resets it.
 * The reset must run only on a real change: an effect that also ran after mount would overwrite text typed
 * before the (deferred) effect fired.
 */
function KitReferencePicker(props: Loose) {
  const { value, ...rest } = props;
  const [text, setText] = useState(typeof value === 'string' ? value : '');
  const seen = useRef(value);
  useEffect(() => {
    if (seen.current === value) return;
    seen.current = value;
    setText(typeof value === 'string' ? value : '');
  }, [value]);
  return createElement(ReferencePicker, { ...rest, value: text, onInputChange: setText });
}

function plainReference(v: ReferenceValue): ReferenceValue {
  const out: ReferenceValue = { verseId: v.verseId, ref: v.ref };
  if (v.endVerseId !== undefined) out.endVerseId = v.endVerseId;
  if (v.wholeChapter) out.wholeChapter = true;
  return out;
}

const referencePicker: KthElementSpec = {
  attrs: {
    value: { prop: 'value', type: 'string' },
    placeholder: { prop: 'placeholder', type: 'string' },
    label: { prop: 'label', type: 'string' },
    locale: { prop: 'locale', type: 'string' },
    dir: { prop: 'dir', type: { enum: ['ltr', 'rtl'] } },
    disabled: { prop: 'disabled', type: 'boolean' },
    'show-label': { prop: 'showLabel', type: 'boolean' },
    'no-ranges': { prop: 'noRanges', type: 'boolean' },
    'no-whole-chapter': { prop: 'noWholeChapter', type: 'boolean' },
    'max-suggestions': { prop: 'maxSuggestions', type: 'number' },
  },
  props: ['labels'],
  events: { onChange: { event: 'kth-change', detail: plainReference } },
  mapProps: (props, l) => mergeLabels(withLocale(props, l), { placeholder: 'placeholder', label: 'label' }),
};

// --- kth-book-chapter-picker ------------------------------------------------------------------------------------

/**
 * The shared BookChapterPicker with the locale's book names and aliases filled in (the apps pass their own).
 * English aliases stay accepted under any locale.
 */
function KitBookChapterPicker(props: Loose) {
  const { locale, book, chapter, noAutofocus, ...rest } = props;
  const parsers = getPickerParsers(typeof locale === 'string' ? locale : 'en');
  const bookName = (n: number) => parsers.displayNames[n - 1] ?? `Book ${n}`;
  const bookAliases: Record<string, number> = { ...Object.fromEntries(ENGLISH_BOOK_NAMES), ...Object.fromEntries(parsers.aliasKeys) };
  const current = typeof book === 'number' ? { book, chapter: typeof chapter === 'number' ? chapter : null } : null;
  return createElement(BookChapterPicker, {
    ...rest,
    current,
    bookName,
    bookAliases,
    referenceSyntax: 'extended',
    autoFocusInput: noAutofocus !== true,
  } as never);
}

const bookChapterPicker: KthElementSpec = {
  attrs: {
    book: { prop: 'book', type: 'number' },
    chapter: { prop: 'chapter', type: 'number' },
    locale: { prop: 'locale', type: 'string' },
    dir: { prop: 'dir', type: { enum: ['ltr', 'rtl'] } },
    'no-autofocus': { prop: 'noAutofocus', type: 'boolean' },
  },
  props: ['labels'],
  events: {
    onPick: {
      event: 'kth-pick',
      detail: (book: number, chapter: number, verse?: number, endVerse?: number) => {
        const detail: { book: number; chapter: number; verseId: number; endVerseId?: number } = {
          book,
          chapter,
          verseId: VerseIdHelper.calculate(book, chapter, verse ?? 1),
        };
        if (endVerse !== undefined) detail.endVerseId = VerseIdHelper.calculate(book, chapter, endVerse);
        return detail;
      },
    },
    onClose: { event: 'kth-close', detail: () => ({}) },
  },
  mapProps: withLocale,
};

// --- kth-highlight-swatch ---------------------------------------------------------------------------------------

const highlightSwatch: KthElementSpec = {
  attrs: {
    value: { prop: 'value', type: 'string' },
    colors: { prop: 'colors', type: 'list' },
    'group-label': { prop: 'groupLabel', type: 'string' },
    size: { prop: 'size', type: { enum: ['sm', 'md'] } },
    dir: { prop: 'dir', type: { enum: ['ltr', 'rtl'] } },
    disabled: { prop: 'disabled', type: 'boolean' },
  },
  props: ['labels'],
  events: { onChange: { event: 'kth-change', detail: (v: { color: string; hex: string }) => ({ color: v.color, hex: v.hex }) } },
  mapProps: (props, l) => {
    const out = mergeLabels({ ...props, dir: props.dir ?? l.direction }, { groupLabel: 'group' });
    // Only palette names: an unknown token would render a swatch with no colour and no name.
    if (Array.isArray(out.colors)) {
      out.colors = (out.colors as unknown[]).filter((c): c is HighlightColor => (HIGHLIGHT_COLOR_NAMES as readonly unknown[]).includes(c));
    }
    return out;
  },
};

export interface KitElement {
  component: ComponentType<Loose>;
  spec: KthElementSpec;
}

export const KIT_ELEMENTS: Readonly<Record<string, KitElement>> = {
  'kth-reference-picker': { component: KitReferencePicker, spec: referencePicker },
  'kth-book-chapter-picker': { component: KitBookChapterPicker, spec: bookChapterPicker },
  'kth-highlight-swatch': { component: HighlightSwatch as unknown as ComponentType<Loose>, spec: highlightSwatch },
};
