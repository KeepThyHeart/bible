/**
 * ReferencePicker: a single text input that turns a typed Bible reference ("John 3:16", "Juan 3:16-18",
 * "约翰福音3:16") into a `ReferenceValue`, with book-name suggestions (APG editable combobox with list
 * autocomplete). It fires `onChange` only on commit: Enter, or choosing the reference option.
 *
 * Pure parsing and suggestion logic lives in `referenceInput.ts`. Labels are props with English defaults; this
 * component knows no i18n library. Ids inside are derived from `id` (or a generated one), so several pickers
 * on a page (or in several kit roots) never collide when each is given its own `id`.
 */
import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { directionForTag } from '@bible/core/browser';
import { parseReferenceInput, suggestBooks } from './referenceInput';
import type { ReferenceValue } from './referenceInput';

export type { ReferenceValue } from './referenceInput';

export interface ReferencePickerLabels {
  /** Accessible name of the input. */
  label: string;
  placeholder: string;
  /** Accessible name of the suggestion list. */
  suggestions: string;
  /** Live-region text after a failed commit. */
  invalid: string;
  /** Live-region text when the options change; `{count}` is replaced. */
  count: string;
}

export const DEFAULT_REFERENCE_PICKER_LABELS: ReferencePickerLabels = {
  label: 'Bible reference',
  placeholder: 'e.g. John 3:16',
  suggestions: 'Suggestions',
  invalid: 'Not a valid reference',
  count: '{count} suggestions',
};

export interface ReferencePickerProps {
  /** Prefix for inner ids (input, listbox, options). Give each picker on a page its own. */
  id?: string;
  /** Controlled input text. */
  value?: string;
  defaultValue?: string;
  /** Fired only on commit (Enter, or choosing the reference option). */
  onChange?: (value: ReferenceValue) => void;
  onInputChange?: (text: string) => void;
  /** BCP 47 tag: book names, aliases and the `ref` format. English is always accepted as input. */
  locale?: string;
  /** Defaults to the direction of `locale`. */
  dir?: 'ltr' | 'rtl';
  labels?: Partial<ReferencePickerLabels>;
  /** Show the label above the input (default: visually hidden). */
  showLabel?: boolean;
  noRanges?: boolean;
  noWholeChapter?: boolean;
  /** Most book suggestions shown (default 8). */
  maxSuggestions?: number;
  disabled?: boolean;
  autoFocus?: boolean;
}

type Option =
  | { kind: 'book'; key: string; label: string; book: number }
  | { kind: 'ref'; key: string; label: string; value: ReferenceValue };

export function ReferencePicker({
  id: idProp,
  value,
  defaultValue = '',
  onChange,
  onInputChange,
  locale = 'en',
  dir,
  labels: labelOverrides,
  showLabel = false,
  noRanges,
  noWholeChapter,
  maxSuggestions = 8,
  disabled,
  autoFocus,
}: ReferencePickerProps) {
  const labels: ReferencePickerLabels = { ...DEFAULT_REFERENCE_PICKER_LABELS, ...labelOverrides };
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const inputId = `${id}-input`;
  const listboxId = `${id}-listbox`;
  const optionId = (i: number) => `${id}-opt-${i}`;

  const [innerText, setInnerText] = useState(defaultValue);
  const text = value ?? innerText;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [invalid, setInvalid] = useState(false);

  const setText = (next: string) => {
    if (value === undefined) setInnerText(next);
    onInputChange?.(next);
  };

  const options = useMemo<Option[]>(() => {
    const parsed = parseReferenceInput(text, locale, { noRanges, noWholeChapter });
    if (parsed.ok) return [{ kind: 'ref', key: 'ref', label: parsed.value.ref, value: parsed.value }];
    return suggestBooks(text, locale, maxSuggestions).map((s) => ({
      kind: 'book' as const,
      key: `book-${s.book}`,
      label: s.name,
      book: s.book,
    }));
  }, [text, locale, noRanges, noWholeChapter, maxSuggestions]);

  const listOpen = open && options.length > 0;
  const activeIndex = listOpen && active >= 0 && active < options.length ? active : -1;
  const rtl = (dir ?? directionForTag(locale)) === 'rtl';
  const status = invalid ? labels.invalid : listOpen ? labels.count.replace('{count}', String(options.length)) : '';

  const commit = (v: ReferenceValue) => {
    setInvalid(false);
    setOpen(false);
    setActive(-1);
    setText(v.ref);
    onChange?.(v);
  };

  const choose = (opt: Option) => {
    if (opt.kind === 'ref') {
      commit(opt.value);
      return;
    }
    setInvalid(false);
    setText(`${opt.label} `);
    setOpen(true);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        if (!listOpen) {
          if (options.length > 0) setOpen(true);
          return;
        }
        if (e.altKey) return;
        setActive(activeIndex + 1 >= options.length ? 0 : activeIndex + 1);
        return;
      }
      case 'ArrowUp': {
        e.preventDefault();
        if (!listOpen) {
          if (options.length > 0) setOpen(true);
          return;
        }
        setActive(activeIndex <= 0 ? options.length - 1 : activeIndex - 1);
        return;
      }
      case 'Enter': {
        e.preventDefault();
        if (activeIndex >= 0) {
          choose(options[activeIndex]);
          return;
        }
        const parsed = parseReferenceInput(text, locale, { noRanges, noWholeChapter });
        if (parsed.ok) commit(parsed.value);
        else setInvalid(true);
        return;
      }
      case 'Escape': {
        if (listOpen) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          setActive(-1);
        } else if (text !== '') {
          e.preventDefault();
          e.stopPropagation();
          setInvalid(false);
          setText('');
        }
        return;
      }
      case 'Tab':
        setOpen(false);
        setActive(-1);
        return;
      default:
    }
  };

  return (
    <div className="kth-combobox" dir={dir ?? (rtl ? 'rtl' : 'ltr')}>
      <label htmlFor={inputId} className={showLabel ? 'kth-combobox__label' : 'kth-visually-hidden'}>
        {labels.label}
      </label>
      <input
        id={inputId}
        className="kth-input"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listOpen}
        aria-controls={listboxId}
        aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={labels.placeholder}
        value={text}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => {
          setInvalid(false);
          setOpen(true);
          setActive(-1);
          setText(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
      />
      <ul
        id={listboxId}
        role="listbox"
        aria-label={labels.suggestions}
        className="kth-menu kth-combobox__list"
        hidden={!listOpen}
      >
        {listOpen &&
          options.map((opt, i) => (
            <li
              key={opt.key}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              className="kth-menu__item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(opt)}
            >
              <bdi>{opt.label}</bdi>
            </li>
          ))}
      </ul>
      <div role="status" className="kth-visually-hidden">
        {status}
      </div>
    </div>
  );
}
