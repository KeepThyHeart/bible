import { useState, useRef, useEffect } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { bibleStore } from '../stores/bibleStore';
import { searchStore } from '../stores/searchStore';
import { settingsStore } from '../stores/settingsStore';
import { offlineStore } from '../stores/offlineStore';
import { useStore } from '../hooks/useStore';
import { getAllBookNames, getLocalizedBookName } from '../utils/bookNames';
import { focusSearchField } from '../utils/focusSearchField';


// Common abbreviation mappings (lowercase)
const BOOK_ABBREV_MAP: Record<string, number> = {
  'gen': 1, 'exo': 2, 'exod': 2, 'exodus': 2, 'lev': 3, 'num': 4, 'deu': 5, 'deut': 5,
  'jos': 6, 'josh': 6, 'jdg': 7, 'judg': 7, 'judges': 7, 'rut': 8, 'ruth': 8,
  'isa': 23, 'isaiah': 23, 'jer': 24, 'jeremiah': 24, 'lam': 25, 'eze': 26, 'ezek': 26,
  'dan': 27, 'daniel': 27, 'hos': 28, 'hosea': 28, 'joe': 29, 'joel': 29,
  'amo': 30, 'amos': 30, 'oba': 31, 'obad': 31, 'jon': 32, 'jonah': 32,
  'mic': 33, 'micah': 33, 'nah': 34, 'nahum': 34, 'hab': 35, 'zep': 36, 'zeph': 36,
  'hag': 37, 'zec': 38, 'zech': 38, 'mal': 39, 'malachi': 39,
  'mat': 40, 'matt': 40, 'matthew': 40, 'mar': 41, 'mk': 41, 'mark': 41,
  'luk': 42, 'lk': 42, 'luke': 42, 'joh': 43, 'jn': 43, 'john': 43,
  'act': 44, 'acts': 44, 'rom': 45, 'romans': 45,
  'gal': 48, 'galatians': 48, 'eph': 49, 'ephesians': 49,
  'phi': 50, 'php': 50, 'philippians': 50, 'col': 51, 'colossians': 51,
  'tit': 56, 'titus': 56, 'phm': 57, 'philemon': 57, 'heb': 58, 'hebrews': 58,
  'jam': 59, 'jas': 59, 'james': 59, 'jud': 65, 'jude': 65, 'rev': 66, 'revelation': 66,
  // Numbered books with various prefix styles
  '1sa': 9, '1sam': 9, '1 sam': 9, '1 samuel': 9, 'i sam': 9, 'i samuel': 9,
  '2sa': 10, '2sam': 10, '2 sam': 10, '2 samuel': 10, 'ii sam': 10, 'ii samuel': 10,
  '1ki': 11, '1kgs': 11, '1 ki': 11, '1 kings': 11, 'i ki': 11, 'i kings': 11,
  '2ki': 12, '2kgs': 12, '2 ki': 12, '2 kings': 12, 'ii ki': 12, 'ii kings': 12,
  '1ch': 13, '1chr': 13, '1 chr': 13, '1 chronicles': 13, 'i chr': 13, 'i chronicles': 13,
  '2ch': 14, '2chr': 14, '2 chr': 14, '2 chronicles': 14, 'ii chr': 14, 'ii chronicles': 14,
  '1co': 46, '1cor': 46, '1 cor': 46, '1 corinthians': 46, 'i cor': 46, 'i corinthians': 46,
  '2co': 47, '2cor': 47, '2 cor': 47, '2 corinthians': 47, 'ii cor': 47, 'ii corinthians': 47,
  '1th': 52, '1thess': 52, '1 thess': 52, '1 thessalonians': 52, 'i thess': 52,
  '2th': 53, '2thess': 53, '2 thess': 53, '2 thessalonians': 53, 'ii thess': 53,
  '1ti': 54, '1tim': 54, '1 tim': 54, '1 timothy': 54, 'i tim': 54, 'i timothy': 54,
  '2ti': 55, '2tim': 55, '2 tim': 55, '2 timothy': 55, 'ii tim': 55, 'ii timothy': 55,
  '1pe': 60, '1pet': 60, '1 pet': 60, '1 peter': 60, 'i pet': 60, 'i peter': 60,
  '2pe': 61, '2pet': 61, '2 pet': 61, '2 peter': 61, 'ii pet': 61, 'ii peter': 61,
  '1jo': 62, '1john': 62, '1 john': 62, 'i john': 62,
  '2jo': 63, '2john': 63, '2 john': 63, 'ii john': 63,
  '3jo': 64, '3john': 64, '3 john': 64, 'iii john': 64,
};

/**
 * Damerau-Levenshtein distance (counts transpositions as single edit).
 */
function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = [];
  for (let i = 0; i <= m; i++) {
    d[i] = new Array<number>(n + 1);
    d[i][0] = i;
  }
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/**
 * Try to fuzzy-match a book name part against known book names/abbreviations.
 * Returns { book, rest } if a match is found, or null.
 * `rest` is the remaining string after the matched book name (e.g., "3:16").
 */
function fuzzyMatchReference(input: string): { book: number; rest: string; matchedName: string } | null {
  const lowerInput = input.toLowerCase();

  // Build candidate list from i18n book names and BOOK_ABBREV_MAP
  const candidates: Array<{ name: string; bookNum: number }> = [];
  for (const [numStr, name] of Object.entries(getAllBookNames())) {
    candidates.push({ name: name.toLowerCase(), bookNum: parseInt(numStr, 10) });
  }
  for (const [abbr, bookNum] of Object.entries(BOOK_ABBREV_MAP)) {
    candidates.push({ name: abbr, bookNum });
  }

  // Try to split input into bookPart + rest (where rest starts with a digit)
  // e.g., "jonh 3:16" → bookPart="jonh", rest="3:16"
  const splitMatch = lowerInput.match(/^([a-z]+(?:\s+[a-z]+)*)\s+(\d.*)$/i)
    || lowerInput.match(/^(\d+\s*[a-z]+)\s+(\d.*)$/i);
  if (!splitMatch) return null;

  const bookPart = splitMatch[1].trim();
  const rest = splitMatch[2].trim();

  // Only fuzzy match if rest looks like chapter[:verse[-verse]]. The range tail
  // has to be allowed here too, or "jonh 3:16-18" is rejected before the
  // caller's range-aware pattern ever sees it.
  if (!/^\d+(?::\d+(?:\s*[-–—]\s*\d+)?)?$/.test(rest)) return null;

  // Skip very short book parts — too ambiguous for fuzzy matching
  if (bookPart.length <= 2) return null;

  let bestCandidate: { name: string; bookNum: number } | null = null;
  let bestDistance = Infinity;
  let bestOverlap = -1;
  let bestLenDiff = Infinity;

  for (const cand of candidates) {
    if (cand.name.length <= 2) continue;

    const distance = damerauLevenshtein(bookPart, cand.name);
    const maxDistance = Math.min(2, Math.floor(bookPart.length / 2));
    if (distance > maxDistance || distance === 0) continue; // distance 0 = exact match, already handled

    // Tiebreakers: character overlap, then length similarity
    let overlap = 0;
    const countA = new Map<string, number>();
    for (const ch of bookPart) countA.set(ch, (countA.get(ch) ?? 0) + 1);
    for (const ch of cand.name) {
      const rem = countA.get(ch) ?? 0;
      if (rem > 0) { overlap++; countA.set(ch, rem - 1); }
    }
    const lenDiff = Math.abs(bookPart.length - cand.name.length);

    const isBetter =
      distance < bestDistance ||
      (distance === bestDistance && overlap > bestOverlap) ||
      (distance === bestDistance && overlap === bestOverlap && lenDiff < bestLenDiff);

    if (isBetter) {
      bestDistance = distance;
      bestOverlap = overlap;
      bestLenDiff = lenDiff;
      bestCandidate = cand;
    }
  }

  if (bestCandidate) {
    return { book: bestCandidate.bookNum, rest, matchedName: bestCandidate.name };
  }
  return null;
}

export function parseReference(input: string): { book: number; chapter: number; verse?: number; endVerse?: number; fuzzyMatch?: boolean; correctedBookName?: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // First try the full book names from i18n
  const bookEntries = Object.entries(getAllBookNames());
  for (const [numStr, name] of bookEntries) {
    const bookNum = parseInt(numStr, 10);
    const lowerName = name.toLowerCase();
    const lowerInput = trimmed.toLowerCase();
    const abbrevs = [lowerName, lowerName.substring(0, 3)];
    if (/^\d/.test(lowerName)) {
      abbrevs.push(lowerName.replace(' ', ''));
    }
    for (const abbr of abbrevs) {
      if (lowerInput.startsWith(abbr)) {
        const rest = trimmed.substring(abbr.length).trim();
        const match = rest.match(/^(\d+)(?::(\d+)(?:\s*[-–—]\s*(\d+))?)?$/);
        if (match) {
          return {
            book: bookNum,
            chapter: parseInt(match[1], 10),
            verse: match[2] ? parseInt(match[2], 10) : undefined,
            endVerse: match[3] ? parseInt(match[3], 10) : undefined,
          };
        }
        if (!rest) return { book: bookNum, chapter: 1 };
      }
    }
  }

  // Try abbreviation map - sort by longest match first to avoid partial matches
  const lowerInput = trimmed.toLowerCase();
  const sortedAbbrevs = Object.keys(BOOK_ABBREV_MAP).sort((a, b) => b.length - a.length);
  for (const abbr of sortedAbbrevs) {
    if (lowerInput.startsWith(abbr)) {
      const rest = trimmed.substring(abbr.length).trim();
      const match = rest.match(/^(\d+)(?::(\d+)(?:\s*[-–—]\s*(\d+))?)?$/);
      if (match) {
        return {
          book: BOOK_ABBREV_MAP[abbr],
          chapter: parseInt(match[1], 10),
          verse: match[2] ? parseInt(match[2], 10) : undefined,
          endVerse: match[3] ? parseInt(match[3], 10) : undefined,
        };
      }
      if (!rest) return { book: BOOK_ABBREV_MAP[abbr], chapter: 1 };
    }
  }

  // Try fuzzy matching as a fallback for typos like "jonh 3:16"
  const fuzzy = fuzzyMatchReference(trimmed);
  if (fuzzy) {
    const match = fuzzy.rest.match(/^(\d+)(?::(\d+)(?:\s*[-–—]\s*(\d+))?)?$/);
    if (match) {
      const correctedName = getLocalizedBookName(fuzzy.book);
      return {
        book: fuzzy.book,
        chapter: parseInt(match[1], 10),
        verse: match[2] ? parseInt(match[2], 10) : undefined,
        endVerse: match[3] ? parseInt(match[3], 10) : undefined,
        fuzzyMatch: true,
        correctedBookName: correctedName,
      };
    }
  }

  const numMatch = trimmed.match(/^(\d+)\s+(\d+)(?:\s+(\d+))?$/);
  if (numMatch) {
    return {
      book: parseInt(numMatch[1], 10),
      chapter: parseInt(numMatch[2], 10),
      verse: numMatch[3] ? parseInt(numMatch[3], 10) : undefined,
    };
  }

  // Quick verse jump: "5" → verse 5 of current chapter, "17:5" → chapter 17 verse 5
  const tab = bibleStore.getActiveTab();
  if (tab?.book && tab?.chapter) {
    const chapterVerseMatch = trimmed.match(/^(\d+):(\d+)(?:\s*[-–—]\s*(\d+))?$/);
    if (chapterVerseMatch) {
      return {
        book: tab.book,
        chapter: parseInt(chapterVerseMatch[1], 10),
        verse: parseInt(chapterVerseMatch[2], 10),
        endVerse: chapterVerseMatch[3] ? parseInt(chapterVerseMatch[3], 10) : undefined,
      };
    }
    const verseOnlyMatch = trimmed.match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/);
    if (verseOnlyMatch) {
      return {
        book: tab.book,
        chapter: tab.chapter,
        verse: parseInt(verseOnlyMatch[1], 10),
        endVerse: verseOnlyMatch[2] ? parseInt(verseOnlyMatch[2], 10) : undefined,
      };
    }
  }

  return null;
}

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
    const trimmed = value.trim();
    if (!trimmed) return;

    const ref = parseReference(trimmed);
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
