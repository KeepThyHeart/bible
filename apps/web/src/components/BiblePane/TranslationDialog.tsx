import { useState, useRef, useEffect } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { moduleStore } from '../../stores/moduleStore';
import { useStore } from '../../hooks/useStore';
import { RECOMMENDED_BIBLES, getBibleDescription } from '../../moduleDescriptions';
import type { ModuleSection } from '../../types';

interface TranslationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Abbreviation of the translation currently in use, shown checked. */
  currentAbbr: string;
  onSelect: (abbreviation: string) => void;
}

/**
 * Translation picker, in the same visual language as the commentary module
 * dialog.
 *
 * Extracted from BibleToolbar so the passage picker can offer the same list:
 * choosing a translation is a basic enough operation that it should be reachable
 * from wherever the reader is already choosing a passage, and two hand-kept
 * copies of a 130-line dialog would drift.
 */
export function TranslationDialog({ isOpen, onClose, currentAbbr, onSelect }: TranslationDialogProps) {
  const { t } = useTranslation();
  const bibleModules = useStore(moduleStore, () => moduleStore.getBibleModules());
  const [translationFilter, setTranslationFilter] = useState('');
  const filterInputRef = useRef<HTMLInputElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredModules = translationFilter
    ? bibleModules.filter(m =>
        m.abbreviation.toLowerCase().includes(translationFilter.toLowerCase()) ||
        (m.name || '').toLowerCase().includes(translationFilter.toLowerCase())
      ).sort((a, b) => {
        const filter = translationFilter.toLowerCase();
        const aAbbrLower = a.abbreviation.toLowerCase();
        const bAbbrLower = b.abbreviation.toLowerCase();
        // Exact match first
        const aExact = aAbbrLower === filter ? 0 : 1;
        const bExact = bAbbrLower === filter ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        // Then prefix matches (e.g., "KJV" before "AKJV")
        const aPrefix = aAbbrLower.startsWith(filter) ? 0 : 1;
        const bPrefix = bAbbrLower.startsWith(filter) ? 0 : 1;
        if (aPrefix !== bPrefix) return aPrefix - bPrefix;
        // Then alphabetical
        return aAbbrLower.localeCompare(bAbbrLower);
      })
    : bibleModules;

  // Auto-focus the filter input when the dialog opens.
  useEffect(() => {
    if (!isOpen) return;
    setTranslationFilter('');
    filterInputRef.current?.focus();
    setFocusedIndex(-1);
  }, [isOpen]);

  // Keyboard handling.
  //
  // Attached once, with the open flag read from a ref, rather than attached
  // when the dialog opens. Preact flushes effects on an animation frame, so an
  // open-triggered listener is not live for the first frames the dialog is on
  // screen — the dialog is visible and Escape does nothing.
  const dialogOpenRef = useRef(false);
  dialogOpenRef.current = isOpen;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!dialogOpenRef.current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
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
        // Only handle Space when focus is not in the filter input
        if (e.key === ' ' && document.activeElement === filterInputRef.current) return;
        e.preventDefault();
        setFocusedIndex(cur => {
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

  // Escape reads the latest onClose without re-registering the listener.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Reset focused index when filter changes
  useEffect(() => {
    setFocusedIndex(-1);
  }, [translationFilter]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex < 0) return;
    const cards = listRef.current?.querySelectorAll('.module-card');
    if (cards && cards[focusedIndex]) {
      (cards[focusedIndex] as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex]);

  if (!isOpen) return null;

  return (
      <div class="module-dialog-overlay" onClick={() => onClose()}>
        <div class="module-dialog" onClick={(e) => e.stopPropagation()}>
          <div class="module-dialog__header">
            <h3>{t('bibleToolbar.selectTranslation')}</h3>
            <button class="module-dialog__close" onClick={() => onClose()}>
              <i class="fa-solid fa-xmark" />
            </button>
          </div>
          <div class="module-dialog__filter">
            <i class="fa-solid fa-magnifying-glass module-dialog__filter-icon" />
            <input
              ref={filterInputRef}
              type="text"
              placeholder={t('bibleToolbar.filterTranslations')}
              value={translationFilter}
              onInput={(e) => setTranslationFilter((e.target as HTMLInputElement).value)}
            />
          </div>
          {/*
            A radiogroup, not a checkbox list: picking a translation replaces
            the one in the tab and closes the dialog. The rows used to draw
            checkboxes, borrowed from the genuinely multi-select
            `ModuleSelectDialog`, which read as "tick as many as you like".
          */}
          <div class="module-dialog__list" role="radiogroup" aria-label={t('bibleToolbar.selectTranslation')} ref={listRef}>
            {filteredModules.length === 0 ? (
              <div class="module-dialog__empty">
                {bibleModules.length === 0 ? t('bibleToolbar.noModules') : t('bibleToolbar.noMatches')}
              </div>
            ) : (() => {
              const isFiltering = translationFilter.length > 0;
              let globalIdx = 0;

              const renderCard = (m: typeof filteredModules[0], idx: number, showTagline: boolean) => {
                const isActive = m.abbreviation === currentAbbr;
                // Settings.json description override, then the catalog entry
                const settingsDesc = moduleStore.getModuleDescription('bibles', m.abbreviation);
                const desc = getBibleDescription(m.abbreviation);
                const descText = settingsDesc?.description || (showTagline && desc?.tagline ? desc.tagline : desc?.description);
                return (
                  <div
                    key={m.abbreviation}
                    class={`module-card module-card--single${idx === focusedIndex ? ' module-card--focused' : ''}`}
                    role="radio"
                    aria-checked={isActive}
                    onClick={() => onSelect(m.abbreviation)}
                  >
                    <div class="module-card__top">
                      <div class="module-card__check">
                        {isActive ? (
                          <i class="fa-solid fa-circle-dot module-card__check--on" />
                        ) : (
                          <i class="fa-regular fa-circle module-card__check--off" />
                        )}
                      </div>
                      <div class="module-card__info">
                        <span class="module-card__abbr">{m.abbreviation}</span>
                        {m.name && m.name !== m.abbreviation && (
                          <span class="module-card__name">{m.name}</span>
                        )}
                      </div>
                    </div>
                    {descText && (
                      <div class="module-card__desc">{descText}</div>
                    )}
                  </div>
                );
              };

              // Use server-provided sections if configured, otherwise fall back to hardcoded
              const serverSections: ModuleSection[] | null = isFiltering ? null : moduleStore.getBibleSections();

              if (serverSections && serverSections.length > 0) {
                // Build a lookup for quick module matching
                const modulesByAbbr = new Map(filteredModules.map(m => [m.abbreviation.toLowerCase(), m]));
                const rendered = new Set<string>();

                return (
                  <>
                    {serverSections.map(section => {
                      const sectionModules = section.modules
                        .map(abbr => modulesByAbbr.get(abbr.toLowerCase()))
                        .filter((m): m is typeof filteredModules[0] => !!m);
                      if (sectionModules.length === 0) return null;
                      sectionModules.forEach(m => rendered.add(m.abbreviation.toLowerCase()));
                      return (
                        <>
                          <div class="module-dialog__section-label">{section.title}</div>
                          {section.helpText && (
                            <div class="module-dialog__section-help">{section.helpText}</div>
                          )}
                          {sectionModules.map(m => {
                            const idx = globalIdx++;
                            return renderCard(m, idx, true);
                          })}
                        </>
                      );
                    })}
                    {/* Modules not in any section */}
                    {(() => {
                      const unsectioned = filteredModules.filter(m => !rendered.has(m.abbreviation.toLowerCase()));
                      if (unsectioned.length === 0) return null;
                      return (
                        <>
                          <div class="module-dialog__section-label">{t('bibleToolbar.other')}</div>
                          {unsectioned.map(m => {
                            const idx = globalIdx++;
                            return renderCard(m, idx, false);
                          })}
                        </>
                      );
                    })()}
                  </>
                );
              }

              // Fallback: hardcoded recommended sections
              const recommendedModules = isFiltering ? [] : filteredModules.filter(m => RECOMMENDED_BIBLES.includes(m.abbreviation));
              recommendedModules.sort((a, b) => RECOMMENDED_BIBLES.indexOf(a.abbreviation) - RECOMMENDED_BIBLES.indexOf(b.abbreviation));
              const restModules = isFiltering ? filteredModules : filteredModules.filter(m => !RECOMMENDED_BIBLES.includes(m.abbreviation));

              return (
                <>
                  {recommendedModules.length > 0 && (
                    <>
                      <div class="module-dialog__section-label">{t('bibleToolbar.popular')}</div>
                      {recommendedModules.map(m => {
                        const idx = globalIdx++;
                        return renderCard(m, idx, true);
                      })}
                      <div class="module-dialog__section-label">{t('bibleToolbar.allTranslations')}</div>
                    </>
                  )}
                  {restModules.map(m => {
                    const idx = globalIdx++;
                    return renderCard(m, idx, false);
                  })}
                </>
              );
            })()}
          </div>
        </div>
      </div>
  );
}
