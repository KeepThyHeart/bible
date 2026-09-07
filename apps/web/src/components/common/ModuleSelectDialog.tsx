import { useState, useRef, useEffect } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { ModuleSection } from '../../types';

/** The minimum a module needs to appear in the dialog. */
export interface SelectableModule {
  abbreviation: string;
  name: string;
}

/** Every user-visible string, so the dialog itself stays i18n-agnostic. */
export interface ModuleSelectDialogLabels {
  title: string;
  filterPlaceholder: string;
  /** Shown when there are no modules at all. */
  noModules: string;
  /** Shown when the filter excludes everything. */
  noMatches: string;
  /** Heading for modules that no configured section claims. */
  other: string;
  cancel: string;
  apply: string;
}

interface ModuleSelectDialogProps<M extends SelectableModule> {
  isOpen: boolean;
  /** Modules in the order they should appear when no filter is typed. */
  modules: M[];
  /** Section grouping from settings.json, or null for a flat list. */
  sections?: ModuleSection[] | null;
  /** Abbreviations checked when the dialog opens (re-read on every open). */
  selected: string[];
  labels: ModuleSelectDialogLabels;
  /** Called with the final checked set when Apply is pressed. */
  onApply: (selected: Set<string>) => void;
  onClose: () => void;
  /** Card headline; defaults to the abbreviation. */
  getDisplayAbbr?: (module: M) => string;
  /** Secondary line; defaults to the name when it differs from the abbreviation. */
  getDisplayName?: (module: M) => string | undefined;
  getDescription?: (module: M) => string | undefined;
  /** Extra rows under the description — the commentary availability badges. */
  renderExtra?: (module: M) => ComponentChildren;
}

/**
 * Centered, filterable module picker with checkboxes and Apply/Cancel.
 *
 * Grown out of the commentary tab bar's inline dialog, which the dictionary
 * tab bar now shares: a dropdown that only listed *unopened* modules and added
 * one per click gave the two panes different mental models for the same "+"
 * button, and could not close a tab at all.
 *
 * The Bible translation picker (`BiblePane/TranslationDialog`) wears the same
 * `.module-dialog` clothes but is a single-select with its own recommended /
 * tagline rules, so it stays a separate component rather than a mode here.
 */
export function ModuleSelectDialog<M extends SelectableModule>({
  isOpen,
  modules,
  sections,
  selected,
  labels,
  onApply,
  onClose,
  getDisplayAbbr,
  getDisplayName,
  getDescription,
  renderExtra,
}: ModuleSelectDialogProps<M>) {
  const [filter, setFilter] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [pendingSelection, setPendingSelection] = useState<Set<string>>(new Set());
  const filterInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isFiltering = filter.length > 0;
  const filteredModules = isFiltering
    ? modules.filter(m =>
        m.abbreviation.toLowerCase().includes(filter.toLowerCase()) ||
        (m.name || '').toLowerCase().includes(filter.toLowerCase())
      )
    : modules;

  // Re-seed from the caller's selection every time the dialog opens, so an
  // abandoned edit does not survive into the next open.
  useEffect(() => {
    if (!isOpen) return;
    setFilter('');
    setFocusedIndex(-1);
    setPendingSelection(new Set(selected));
    filterInputRef.current?.focus();
  }, [isOpen]);

  // Keyboard handling.
  //
  // Attached once for the component's life with the open flag read from a ref,
  // rather than attached when the dialog opens: Preact flushes effects on an
  // animation frame, so an open-triggered listener is not live for the first
  // frames the dialog is on screen — the dialog is visible and Escape does
  // nothing.
  const dialogOpenRef = useRef(false);
  dialogOpenRef.current = isOpen;

  // Held in refs because the handlers close over this render's state; the
  // listener is registered once and would otherwise freeze the first render's.
  const applyRef = useRef<() => void>(() => {});
  const closeRef = useRef<() => void>(() => {});

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!dialogOpenRef.current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex(prev => {
          const max = listRef.current?.querySelectorAll('.module-card').length ?? 0;
          return Math.min(prev + 1, max - 1);
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (e.key === ' ' && document.activeElement === filterInputRef.current) return;
        e.preventDefault();
        setFocusedIndex(cur => {
          if (e.key === 'Enter' && cur < 0) {
            // Enter with no focused item = Apply
            applyRef.current();
            return cur;
          }
          const cards = listRef.current?.querySelectorAll('.module-card');
          if (cards && cur >= 0 && cur < cards.length) {
            (cards[cur] as HTMLElement).click();
          }
          return cur;
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Reset focused index when the filter changes
  useEffect(() => {
    setFocusedIndex(-1);
  }, [filter]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex < 0) return;
    const cards = listRef.current?.querySelectorAll('.module-card');
    if (cards && cards[focusedIndex]) {
      (cards[focusedIndex] as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex]);

  const togglePending = (abbr: string) => {
    setPendingSelection(prev => {
      const next = new Set(prev);
      if (next.has(abbr)) {
        next.delete(abbr);
      } else {
        next.add(abbr);
      }
      return next;
    });
  };

  const handleApply = () => {
    onApply(pendingSelection);
    setFilter('');
  };

  const handleCancel = () => {
    onClose();
    setFilter('');
  };

  applyRef.current = handleApply;
  closeRef.current = handleCancel;

  if (!isOpen) return null;

  let globalIdx = 0;

  const renderCard = (m: M) => {
    const idx = globalIdx++;
    const isChecked = pendingSelection.has(m.abbreviation);
    const abbrLabel = getDisplayAbbr ? getDisplayAbbr(m) : m.abbreviation;
    const nameLabel = getDisplayName
      ? getDisplayName(m)
      : (m.name && m.name !== m.abbreviation ? m.name : undefined);
    const descText = getDescription?.(m);
    return (
      <div
        key={m.abbreviation}
        class={`module-card${idx === focusedIndex ? ' module-card--focused' : ''}`}
        onClick={() => togglePending(m.abbreviation)}
      >
        <div class="module-card__top">
          <div class="module-card__check">
            {isChecked ? (
              <i class="fa-solid fa-square-check module-card__check--on" />
            ) : (
              <i class="fa-regular fa-square module-card__check--off" />
            )}
          </div>
          <div class="module-card__info">
            <span class="module-card__abbr">{abbrLabel}</span>
            {nameLabel && <span class="module-card__name">{nameLabel}</span>}
          </div>
        </div>
        {descText && <div class="module-card__desc">{descText}</div>}
        {renderExtra?.(m)}
      </div>
    );
  };

  const renderList = () => {
    // Sections are a browsing aid; once the reader is filtering, a flat list of
    // hits is what they are looking at.
    if (!isFiltering && sections && sections.length > 0) {
      const modulesByAbbr = new Map(filteredModules.map(m => [m.abbreviation.toLowerCase(), m]));
      const rendered = new Set<string>();

      return (
        <>
          {sections.map(section => {
            const sectionModules = section.modules
              .map(abbr => modulesByAbbr.get(abbr.toLowerCase()))
              .filter((m): m is M => !!m);
            if (sectionModules.length === 0) return null;
            sectionModules.forEach(m => rendered.add(m.abbreviation.toLowerCase()));
            return (
              <>
                <div class="module-dialog__section-label">{section.title}</div>
                {section.helpText && (
                  <div class="module-dialog__section-help">{section.helpText}</div>
                )}
                {sectionModules.map(m => renderCard(m))}
              </>
            );
          })}
          {(() => {
            const unsectioned = filteredModules.filter(m => !rendered.has(m.abbreviation.toLowerCase()));
            if (unsectioned.length === 0) return null;
            return (
              <>
                <div class="module-dialog__section-label">{labels.other}</div>
                {unsectioned.map(m => renderCard(m))}
              </>
            );
          })()}
        </>
      );
    }

    return filteredModules.map(m => renderCard(m));
  };

  return (
    <div class="module-dialog-overlay" onClick={handleCancel}>
      <div class="module-dialog" onClick={(e) => e.stopPropagation()}>
        <div class="module-dialog__header">
          <h3>{labels.title}</h3>
          <button class="module-dialog__close" onClick={handleCancel}>
            <i class="fa-solid fa-xmark" />
          </button>
        </div>
        <div class="module-dialog__filter">
          <i class="fa-solid fa-magnifying-glass module-dialog__filter-icon" />
          <input
            ref={filterInputRef}
            type="text"
            placeholder={labels.filterPlaceholder}
            value={filter}
            onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="module-dialog__list" ref={listRef}>
          {filteredModules.length === 0 ? (
            <div class="module-dialog__empty">
              {modules.length === 0 ? labels.noModules : labels.noMatches}
            </div>
          ) : renderList()}
        </div>
        <div class="module-dialog__footer">
          <button class="module-dialog__btn module-dialog__btn--cancel" onClick={handleCancel}>
            {labels.cancel}
          </button>
          <button class="module-dialog__btn module-dialog__btn--apply" onClick={handleApply}>
            {labels.apply}
          </button>
        </div>
      </div>
    </div>
  );
}
