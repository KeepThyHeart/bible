import { useState, useRef, useEffect, useMemo } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { bibleStore } from '../stores/bibleStore';
import { searchStore } from '../stores/searchStore';
import { settingsStore } from '../stores/settingsStore';
import { offlineStore } from '../stores/offlineStore';
import { useStore } from '../hooks/useStore';
import { useLocalizer } from '../hooks/useLocalizer';
import { focusSearchField } from '../utils/focusSearchField';
import { AppSwitchSlot } from '../host/AppSwitchSlot';
import { PaneHeaderButtons } from '../host/PaneHeaderButtons';
import { stripBidiControls } from '@bible/core/browser';


export { BOOK_ABBREV_MAP, headerBookAliases, parseReference } from '../utils/referenceParse';
import { headerBookAliases, parseReference, setActiveTabSource } from '../utils/referenceParse';

// parseReference's quick verse jump needs the reader's current chapter (Study-only state).
setActiveTabSource(() => bibleStore.getActiveTab());


interface HeaderProps {
  onSettingsClick?: (section?: string) => void;
  onHelpClick?: () => void;
  /**
   * Opens the feedback dialog. Only the desktop shell passes it: the mobile
   * action row is already four buttons wide on a narrow phone, so mobile
   * reaches feedback through the Help dialog instead of a fifth icon.
   */
  onFeedbackClick?: () => void;
  onLogoClick?: () => void;
}

export function Header({ onSettingsClick, onHelpClick, onFeedbackClick, onLogoClick }: HeaderProps) {
  const { t } = useTranslation();
  const theme = useStore(settingsStore, () => settingsStore.getResolvedTheme());
  const [value, setValue] = useState('');
  const [showThemeDropdown, setShowThemeDropdown] = useState(false);
  const [showSearchTypeDropdown, setShowSearchTypeDropdown] = useState(false);
  const [showIdeasHelp, setShowIdeasHelp] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const searchType = useStore(searchStore, () => searchStore.searchType);
  const searchQuery = useStore(searchStore, () => searchStore.query);
  const isOnline = useStore(offlineStore, () => offlineStore.isOnline);
  const offlineEnabled = useStore(offlineStore, () => offlineStore.enabled);
  const localizer = useLocalizer();
  const bookAliases = useMemo(() => headerBookAliases(localizer), [localizer]);

  // Sync search box when a search is performed externally (e.g., Strong's click)
  useEffect(() => {
    if (searchQuery && searchQuery !== value) {
      setValue(searchQuery);
      // Focus and select the input to draw attention
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [searchQuery]);

  // Close dropdowns on Escape.
  //
  // Attached once, with the open flags read from a ref, rather than attached
  // when a dropdown opens. Preact flushes effects on an animation frame, so an
  // open-triggered listener is not live for the first frames the dropdown is on
  // screen — a dropdown that is visibly open but deaf to Escape. Rare by hand,
  // reliable from a test that clicks and presses in the same tick.
  const openDropdownsRef = useRef({ theme: false, searchType: false, ideasHelp: false });
  openDropdownsRef.current = {
    theme: showThemeDropdown,
    searchType: showSearchTypeDropdown,
    ideasHelp: showIdeasHelp,
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const open = openDropdownsRef.current;
      if (open.theme) setShowThemeDropdown(false);
      if (open.searchType) setShowSearchTypeDropdown(false);
      if (open.ideasHelp) setShowIdeasHelp(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Close Ideas help popup on any click outside
  useEffect(() => {
    if (!showIdeasHelp) return;
    const handler = () => setShowIdeasHelp(false);
    // Use setTimeout to avoid catching the opening click itself
    const id = setTimeout(() => window.addEventListener('click', handler), 0);
    return () => { clearTimeout(id); window.removeEventListener('click', handler); };
  }, [showIdeasHelp]);

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const trimmed = stripBidiControls(value).trim();
    if (!trimmed) return;

    const ref = parseReference(trimmed, bookAliases);
    if (ref) {
      bibleStore.navigateTo(ref.book, ref.chapter, ref.verse, { endVerse: ref.endVerse });
      if (ref.fuzzyMatch && ref.correctedBookName) {
        // Show the corrected reference briefly so user sees what was matched
        const corrected = ref.verse
          ? `${ref.correctedBookName} ${ref.chapter}:${ref.verse}`
          : `${ref.correctedBookName} ${ref.chapter}`;
        setValue(corrected);
        setTimeout(() => setValue(''), 2000);
      } else {
        setValue('');
      }
      inputRef.current?.blur();
    } else {
      // Both modes want the reader's translation: keyword searches its text,
      // semantic renders its matches in it. Left undefined when no translation
      // is open, which is what makes the server fall back to KJV.
      const activeModule = bibleStore.getActiveTab()?.moduleAbbr;
      const modules = activeModule ? [activeModule] : undefined;
      searchStore.performSearch(trimmed, undefined, modules);
      inputRef.current?.blur();
    }
  };

  const selectSearchType = (type: 'keyword' | 'semantic') => {
    searchStore.setSearchType(type);
    setShowSearchTypeDropdown(false);
    inputRef.current?.focus();

    // Pre-load semantic search models on first selection
    if (type === 'semantic') {
      searchStore.warmupSemanticSearch().catch(() => {});
    }
  };

  const themeOptions = [
    { value: 'light', label: 'themes.light', icon: 'fa-sun' },
    { value: 'dark', label: 'themes.dark', icon: 'fa-moon' },
    { value: 'sepia', label: 'themes.sepia', icon: 'fa-mug-hot' },
    { value: 'forest', label: 'themes.forest', icon: 'fa-palette' },
    { value: 'ocean', label: 'themes.ocean', icon: 'fa-palette' },
    { value: 'midnight', label: 'themes.midnight', icon: 'fa-palette' },
    { value: 'meadow', label: 'themes.meadow', icon: 'fa-palette' },
    { value: 'sunset', label: 'themes.sunset', icon: 'fa-palette' },
    { value: 'sunrise', label: 'themes.sunrise', icon: 'fa-palette' },
    { value: 'slate', label: 'themes.slate', icon: 'fa-palette' },
    { value: 'parchment', label: 'themes.parchment', icon: 'fa-palette' },
    { value: 'rose', label: 'themes.rose', icon: 'fa-palette' },
    { value: 'arctic', label: 'themes.arctic', icon: 'fa-palette' },
    { value: 'autumn', label: 'themes.autumn', icon: 'fa-palette' },
    { value: 'lagoon', label: 'themes.lagoon', icon: 'fa-palette' },
  ] as const;

  return (
    <header class="header">
      <div class="header__logo" onClick={onLogoClick} style={onLogoClick ? { cursor: 'pointer' } : undefined}>
        <i class="fa-solid fa-book-bible" />
        {/* Wordmark stacks the product name over what it is, so the full
            "Keep Thy Heart Bible Reader" reads without taking a second column
            of a header that has none to give. */}
        <span class="header__wordmark">
          <span class="header__wordmark-name">{t('app.name')}</span>
          <span class="header__wordmark-tagline">{t('app.tagline')}</span>
        </span>
      </div>
      <form class="header__search" onSubmit={handleSubmit} action="javascript:void(0)">
        <div class="header__search-type-wrapper">
          <button
            type="button"
            class="header__search-type-btn"
            onClick={() => setShowSearchTypeDropdown(!showSearchTypeDropdown)}
            title={t('header.searchTypeChange')}
          >
            <i class={`fa-solid ${searchType === 'keyword' ? 'fa-magnifying-glass' : 'fa-lightbulb'}`} />
            <span class="header__search-type-label">
              {searchType === 'keyword' ? t('header.search') : t('header.ideas')}
            </span>
            <i class="fa-solid fa-chevron-down header__search-type-caret" />
          </button>
          {showSearchTypeDropdown && (
            <div class="header__search-type-dropdown"
              onMouseLeave={() => setShowSearchTypeDropdown(false)}
            >
              <button
                type="button"
                class={`header__search-type-option ${searchType === 'keyword' ? 'header__search-type-option--active' : ''}`}
                onMouseDown={() => selectSearchType('keyword')}
              >
                <i class="fa-solid fa-magnifying-glass" />
                <span>{t('header.standardSearch')}</span>
              </button>
              <button
                type="button"
                class={`header__search-type-option ${searchType === 'semantic' ? 'header__search-type-option--active' : ''}`}
                onMouseDown={() => selectSearchType('semantic')}
                data-search-type="semantic"
              >
                <i class="fa-solid fa-lightbulb" />
                <span>{t('header.ideasSearch')}</span>
              </button>
            </div>
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          class="header__search-field"
          placeholder={t('header.placeholder')}
          title={t('header.shortcutHint')}
          aria-keyshortcuts="/ Control+K"
          value={value}
          onInput={(e) => {
            setValue((e.target as HTMLInputElement).value);
          }}
        />
        {value ? (
          <button
            type="button"
            class="header__search-clear"
            onClick={() => { setValue(''); inputRef.current?.focus(); }}
          >
            <i class="fa-solid fa-xmark" />
          </button>
        ) : (
          /* Shortcut affordance. Hidden while the field is focused or has a
             value (CSS), so it never sits next to what you are typing, and
             `aria-hidden` because the shortcut is already announced through
             the input's own title. Clicking it does what it advertises rather
             than being inert decoration. */
          <kbd
            class="header__search-hint"
            aria-hidden="true"
            onMouseDown={(e) => {
              e.preventDefault();
              focusSearchField({ select: true });
            }}
          >
            /
          </kbd>
        )}
        {searchType === 'semantic' && (
          <div class="header__ideas-help-wrapper">
            <button
              type="button"
              class="header__ideas-help-btn"
              onClick={() => setShowIdeasHelp(!showIdeasHelp)}
              title={t('header.ideasHelpQuestion')}
            >
              <i class="fa-solid fa-circle-question" />
            </button>
            {showIdeasHelp && (
              <div class="header__ideas-help-popup"
                onMouseLeave={() => setShowIdeasHelp(false)}
              >
                <div class="header__ideas-help-title">{t('header.ideasHelpTitle')}</div>
                <p dangerouslySetInnerHTML={{ __html: t('header.ideasHelpDesc') }} />
                <div class="header__ideas-help-subtitle">{t('header.ideasHelpSubtitle')}</div>
                <ul>
                  <li dangerouslySetInnerHTML={{ __html: t('header.ideasHelpThemes') }} />
                  <li dangerouslySetInnerHTML={{ __html: t('header.ideasHelpConcepts') }} />
                  <li dangerouslySetInnerHTML={{ __html: t('header.ideasHelpQuestions') }} />
                  <li dangerouslySetInnerHTML={{ __html: t('header.ideasHelpTopics') }} />
                  <li dangerouslySetInnerHTML={{ __html: t('header.ideasHelpEmotions') }} />
                </ul>
                <p class="header__ideas-help-note">
                  {t('header.ideasHelpNote')}
                </p>
              </div>
            )}
          </div>
        )}
      </form>
      <button
        type="button"
        class="header__toc-btn"
        onClick={() => bibleStore.openBookPicker()}
        title={t('header.toc')}
      >
        <i class="fa-solid fa-list" />
      </button>
      <div class="header__actions">
        {/* The app switcher: the wide-screen rail covers it, so this shows on phones and when the rail is off. */}
        <AppSwitchSlot className="header__action-btn header__app-switch" />
        {offlineEnabled && !isOnline && (
          <span class="header__offline-badge" title={t('header.offlineTooltip')}>
            <i class="fa-solid fa-wifi" style={{ opacity: 0.5 }} />
            <span class="header__offline-dot" />
          </span>
        )}
        <button
          class="header__action-btn"
          onClick={() => window.location.reload()}
          title={t('header.refresh')}
        >
          <i class="fa-solid fa-rotate-right" />
        </button>
        <div class="header__theme-wrapper">
          <button
            class="header__action-btn"
            onClick={() => setShowThemeDropdown(!showThemeDropdown)}
            title={t('header.theme')}
          >
            <i class={`fa-solid ${themeOptions.find(o => o.value === theme)?.icon ?? 'fa-sun'}`} />
          </button>
          {showThemeDropdown && (
            <div class="header__theme-dropdown"
              onMouseLeave={() => setShowThemeDropdown(false)}
            >
              {themeOptions.slice(0, 3).map(opt => (
                <button
                  key={opt.value}
                  class={`header__theme-option ${theme === opt.value ? 'header__theme-option--active' : ''}`}
                  onClick={() => {
                    settingsStore.setTheme(opt.value);
                    setShowThemeDropdown(false);
                  }}
                >
                  <i class={`fa-solid ${opt.icon}`} /> {t(opt.label)}
                </button>
              ))}
              <div class="header__theme-divider" />
              <button
                class="header__theme-option"
                onClick={() => {
                  setShowThemeDropdown(false);
                  onSettingsClick?.('theme');
                }}
              >
                <i class="fa-solid fa-palette" /> {t('header.more')}
              </button>
            </div>
          )}
        </div>
        <PaneHeaderButtons className="header__action-btn" />
        {onFeedbackClick && (
          <button
            class="header__action-btn"
            onClick={onFeedbackClick}
            title={t('header.feedback')}
            data-testid="header-feedback-btn"
          >
            <i class="fa-solid fa-comment-dots" />
          </button>
        )}
        {onHelpClick && (
          <button
            class="header__action-btn"
            onClick={onHelpClick}
            title={t('header.help')}
          >
            <i class="fa-solid fa-circle-question" />
          </button>
        )}
        {onSettingsClick && (
          <button
            class="header__action-btn"
            onClick={() => onSettingsClick?.()}
            title={t('header.settings')}
            data-testid="header-settings-btn"
          >
            <i class="fa-solid fa-gear" />
          </button>
        )}
      </div>
    </header>
  );
}
