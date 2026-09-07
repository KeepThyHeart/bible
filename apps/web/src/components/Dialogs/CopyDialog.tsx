import { useState, useEffect, useRef, useId } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { useTranslation } from 'react-i18next';
import {
  decodeHtmlEntities,
  getPassageFormatCatalog,
  getPassageMarkupFormat,
  passageMarkupToHtml,
  passageMarkupToSourceText,
  renderPassageMarkup,
  resolveFormatShortcut,
  stripHtmlTags,
  HEADING_LEVELS,
  MAX_FORMAT_SHORTCUT,
  PASSAGE_REFERENCE_POSITIONS,
  QUOTE_MARK_STYLES,
  VERSE_NUMBER_STYLES,
  VERSE_TEXT_FORMATS,
  type AdvancedCopyOptions,
  type HeadingLevel,
  type PassageFormatEntry,
  type PassageMarkup,
  type PassageMarkupBlock,
  type PassageMarkupFormatId,
  type PassageMarkupLabels,
  type PassageMarkupOptions,
  type PassageMarkupShapeOptions,
  type PassageReferencePosition,
  type QuoteMarkStyle,
  type VerseContext,
  type VerseNumberStyle,
  type VerseTextFormat,
} from '@bible/core/browser';
import { bibleStore } from '../../stores/bibleStore';
import { moduleStore } from '../../stores/moduleStore';
import { useStore } from '../../hooks/useStore';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { formatPassageRef } from '../../constants';
import { getAllBookNames } from '../../utils/bookNames';
import { mapWithConcurrency } from '../../utils/concurrency';
import { sanitizeHtml } from '../../utils/sanitize';
import {
  loadAdvancedOptions,
  loadFormatId,
  loadMarkupOptions,
  saveAdvancedOptions,
  saveFormatId,
  saveMarkupOptions,
} from './copyPreferences';
import type { VerseData } from '../../types';

// Cap simultaneous chapter fetches for multi-chapter/whole-book copies. A book
// like Psalms (150 chapters) would otherwise open 150 connections at once,
// hammering the server and tripping the per-IP rate limiter.
const CHAPTER_FETCH_CONCURRENCY = 6;

/**
 * The formats this dialog offers: every *markup* shape in core's catalogue, in
 * catalogue order and under its catalogue number.
 *
 * Core's list is five entries; the fifth, Custom Template, needs a template
 * editor beside it and stays hidden on the web for the v2 release, exactly as
 * the old `template` format was. Filtering by family rather than by id is what
 * makes that a single rule: the clipboard family is `standard` and `combined`
 * (retired in core, never offered) plus `template`, and every remaining entry
 * is a `PassageMarkupFormatId` — which is why the selected format below can be
 * typed as one.
 *
 * Numbers are *not* renumbered by the filter. `blockquote` is 1 and
 * `heading-per-verse` is 4 here exactly as they are in the desktop app, and
 * un-hiding the template later would restore 5 rather than shuffling anything.
 */
function offeredFormats(): PassageFormatEntry[] {
  return getPassageFormatCatalog().filter(entry => entry.family === 'markup');
}

function offeredFormatIds(): PassageMarkupFormatId[] {
  return offeredFormats().map(entry => entry.id as PassageMarkupFormatId);
}

/**
 * Locale keys for the enumerated shape controls.
 *
 * The *values* and their order come from core (`PASSAGE_REFERENCE_POSITIONS`
 * and friends), so a value added there shows up here as a missing key rather
 * than as a silently absent option; only the labels are this app's.
 */
const REFERENCE_POSITION_LABELS: Record<PassageReferencePosition, string> = {
  before: 'ui.passageInsert.referenceBefore',
  after: 'ui.passageInsert.referenceAfter',
  none: 'ui.passageInsert.referenceNone',
};

const VERSE_NUMBER_LABELS: Record<VerseNumberStyle, string> = {
  parenthetical: 'ui.passageInsert.verseNumbersParenthetical',
  superscript: 'ui.passageInsert.verseNumbersSuperscript',
  none: 'ui.passageInsert.verseNumbersNone',
};

const TEXT_FORMAT_LABELS: Record<VerseTextFormat, string> = {
  blockquote: 'copyDialog.textFormatBlockQuote',
  inline: 'copyDialog.textFormatInline',
};

/** The quote marks are their own labels; only "none" needs translating. */
const QUOTE_MARK_LABELS: Record<QuoteMarkStyle, string | null> = {
  double: '“”',
  single: '‘’',
  none: null,
};

/**
 * "Is the user typing into something right now?"
 *
 * The digit keys pick a format, and the reference box is mostly digits — so
 * claiming a digit while it has focus would make the field unusable. A native
 * `<select>` counts too: it uses printable characters for type-ahead, and
 * taking those away would break a keyboard behaviour the browser already gave
 * it. Mirrors the desktop app's `utils/textEntry.ts`.
 */
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    // A radio or a checkbox is not a text field: the digits must keep working
    // while focus sits on the format list they index.
    return target.type !== 'radio' && target.type !== 'checkbox';
  }
  return target.isContentEditable;
}

interface CopyDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ParsedReference {
  bookName: string;
  bookNumber: number;  // 0 = use current tab's book
  chapter: number;     // 0 = use current tab's chapter
  startVerse: number;
  endVerse: number;    // Infinity = to end of chapter
  wholeBook?: boolean; // true = copy entire book (all chapters)
  endChapter?: number; // for chapter ranges (John 16-21) and cross-chapter verse ranges (John 16:1-17:5)
}

/**
 * The reference box's parser.
 *
 * Deliberately *not* core's `ReferenceParser`: this one also accepts the two
 * book-less forms the dialog is built around — a bare `"5"` or `"3-10"`, read
 * against the tab already open — and reports a whole-book request as a flag the
 * chapter-fetching effect below can act on. Core's parser answers a different
 * question (what passage does this string name, in isolation) and has no notion
 * of "the chapter the user is looking at".
 */
function parseReferenceRange(input: string): ParsedReference | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Try to match a book name at the start
  const bookEntries = Object.entries(getAllBookNames());
  for (const [numStr, name] of bookEntries) {
    const bookNum = parseInt(numStr, 10);
    const lowerName = name.toLowerCase();
    const lowerInput = trimmed.toLowerCase();
    const abbrevs = [lowerName, lowerName.substring(0, 3)];
    if (/^\d/.test(lowerName)) abbrevs.push(lowerName.replace(' ', ''));

    for (const abbr of abbrevs) {
      if (lowerInput.startsWith(abbr)) {
        const rest = trimmed.substring(abbr.length).trim();

        // "Book Ch:V-Ch:V" (cross-chapter verse range, e.g., "John 16:1-17:5")
        const crossChapterMatch = rest.match(/^(\d+):(\d+)\s*-\s*(\d+):(\d+)$/);
        if (crossChapterMatch) {
          const ch1 = parseInt(crossChapterMatch[1], 10);
          const v1 = parseInt(crossChapterMatch[2], 10);
          const ch2 = parseInt(crossChapterMatch[3], 10);
          const v2 = parseInt(crossChapterMatch[4], 10);
          if (ch2 > ch1) {
            return { bookName: name, bookNumber: bookNum, chapter: ch1, startVerse: v1, endChapter: ch2, endVerse: v2 };
          }
        }

        // "Book Ch-Ch" (chapter range, e.g., "John 16-21")
        const chapterRangeMatch = rest.match(/^(\d+)\s*-\s*(\d+)$/);
        if (chapterRangeMatch) {
          const ch1 = parseInt(chapterRangeMatch[1], 10);
          const ch2 = parseInt(chapterRangeMatch[2], 10);
          if (ch2 > ch1) {
            return { bookName: name, bookNumber: bookNum, chapter: ch1, startVerse: 1, endChapter: ch2, endVerse: Infinity };
          }
        }

        // "Book Chapter:Verse-Verse"
        const fullMatch = rest.match(/^(\d+):(\d+)(?:\s*-\s*(\d+))?$/);
        if (fullMatch) {
          const chapter = parseInt(fullMatch[1], 10);
          const start = parseInt(fullMatch[2], 10);
          const end = fullMatch[3] ? parseInt(fullMatch[3], 10) : start;
          return { bookName: name, bookNumber: bookNum, chapter, startVerse: start, endVerse: end };
        }

        // "Book Chapter" (whole chapter)
        const chapterMatch = rest.match(/^(\d+)$/);
        if (chapterMatch) {
          const chapter = parseInt(chapterMatch[1], 10);
          return { bookName: name, bookNumber: bookNum, chapter, startVerse: 1, endVerse: Infinity };
        }

        // "Book" only (no chapter/verse) — whole book
        if (rest === '') {
          return { bookName: name, bookNumber: bookNum, chapter: 1, startVerse: 1, endVerse: Infinity, wholeBook: true };
        }
      }
    }
  }

  // Simple verse or verse range: "5" or "3-10"
  const simpleMatch = trimmed.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
  if (simpleMatch) {
    const start = parseInt(simpleMatch[1], 10);
    const end = simpleMatch[2] ? parseInt(simpleMatch[2], 10) : start;
    return { bookName: '', bookNumber: 0, chapter: 0, startVerse: start, endVerse: end };
  }

  // "Chapter:Verse-Verse" without book name
  const cvMatch = trimmed.match(/^(\d+):(\d+)(?:\s*-\s*(\d+))?$/);
  if (cvMatch) {
    const chapter = parseInt(cvMatch[1], 10);
    const start = parseInt(cvMatch[2], 10);
    const end = cvMatch[3] ? parseInt(cvMatch[3], 10) : start;
    return { bookName: '', bookNumber: 0, chapter, startVerse: start, endVerse: end };
  }

  return null;
}

/**
 * The preview, rendered from the block tree the formatter produced.
 *
 * Not a second implementation of the output: `renderPassageMarkup` hands back
 * blocks tagged `paragraph | heading | quote | placeholder`, and every line
 * carries both an `html` flavour (red-letter spans intact) and a `text` one.
 * Rendering the blocks is therefore the whole job — the preview shows the real
 * structure, and words of Christ are coloured without anything here having to
 * know which words those are.
 *
 * Line HTML is sanitized because it originates in a module's `text_html`, which
 * is third-party markup; see `utils/sanitize.ts`.
 */
function MarkupPreview({
  markup,
  blockQuote,
}: {
  markup: PassageMarkup;
  /**
   * Whether a quote block is drawn as a quote. This is the clipboard's Block
   * Quote/Inline choice: with it off the copied text carries no quote
   * decoration at all, so showing one here would misdescribe the output.
   */
  blockQuote: boolean;
}): JSX.Element {
  const line = (html: string, key: string): JSX.Element => (
    <span key={key} dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
  );

  // An inline format is one run with no block of its own — that is the whole
  // point of it, so it is previewed as one run too.
  if (markup.inline) {
    return (
      <p class="copy-dialog__preview-inline">
        {markup.blocks.map((block, i) =>
          block.kind === 'quote'
            ? block.lines.map((l, li) => line(l.html, `${i}-${li}`))
            : line(block.line.html, `${i}`),
        )}
      </p>
    );
  }

  const renderBlock = (block: PassageMarkupBlock, i: number): ComponentChildren => {
    switch (block.kind) {
      case 'heading': {
        // `h${level}` as a dynamic tag: the level is a user choice, and six
        // branches of identical JSX would say nothing the number does not.
        const Tag = `h${block.level}` as 'h1';
        return <Tag key={i}>{line(block.line.html, `${i}`)}</Tag>;
      }
      case 'quote': {
        const lines = block.lines.map((l, li) => <p key={li}>{line(l.html, `${i}-${li}`)}</p>);
        return blockQuote ? <blockquote key={i}>{lines}</blockquote> : <div key={i}>{lines}</div>;
      }
      case 'placeholder':
        return (
          <p key={i} class="copy-dialog__preview-placeholder">
            <em>{line(block.line.html, `${i}`)}</em>
          </p>
        );
      case 'paragraph':
      default:
        return <p key={i}>{line(block.line.html, `${i}`)}</p>;
    }
  };

  return <div class="copy-dialog__preview-blocks">{markup.blocks.map(renderBlock)}</div>;
}

export function CopyDialog({ isOpen, onClose }: CopyDialogProps) {
  const { t } = useTranslation();
  const formats = offeredFormats();

  const [formatId, setFormatId] = useState<PassageMarkupFormatId>(() =>
    loadFormatId(offeredFormatIds()),
  );
  const [options, setOptions] = useState<PassageMarkupOptions>(() =>
    loadMarkupOptions(loadFormatId(offeredFormatIds())),
  );
  const [advanced, setAdvanced] = useState<AdvancedCopyOptions>(loadAdvancedOptions);

  const [refInput, setRefInput] = useState('');
  const [parsedBookNumber, setParsedBookNumber] = useState(0);
  const [parsedBookName, setParsedBookName] = useState('');
  const [parsedChapter, setParsedChapter] = useState(0);
  const [startVerse, setStartVerse] = useState(1);
  const [endVerse, setEndVerse] = useState(1);
  const [copied, setCopied] = useState(false);
  const [fetchedVerses, setFetchedVerses] = useState<VerseData[] | null>(null);
  const [fetchingVerses, setFetchingVerses] = useState(false);
  const [isWholeBook, setIsWholeBook] = useState(false);
  const [parsedEndChapter, setParsedEndChapter] = useState(0);

  const tab = useStore(bibleStore, () => bibleStore.getActiveTab());
  const formatGroupName = useId();

  useEscapeKey(isOpen, onClose);

  /**
   * Selecting a format swaps in that format's own remembered shape options.
   *
   * Kept above the `!isOpen` early return so the keyboard effect below — which
   * must be registered unconditionally — can reach it through a ref.
   */
  const chooseFormat = (id: PassageMarkupFormatId): void => {
    setFormatId(id);
    saveFormatId(id);
    setOptions(loadMarkupOptions(id));
  };

  // Enter copies and dismisses; a digit picks a format. Both are held in refs
  // because the handlers they call are defined below the component's `!isOpen`
  // early return, so this effect — which must run unconditionally — cannot
  // close over them directly.
  const confirmRef = useRef<() => void>(() => {});
  const chooseFormatRef = useRef(chooseFormat);
  chooseFormatRef.current = chooseFormat;

  const openRef = useRef(isOpen);
  openRef.current = isOpen;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!openRef.current || e.defaultPrevented) return;

      // A bare digit selects the format wearing that number. Guarded on where
      // focus is rather than on a modifier — a modifier means the user is
      // reaching for something else entirely.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !isTextEntryTarget(document.activeElement)) {
        const shortcut = resolveFormatShortcut(e.key);
        if (shortcut && offeredFormatIds().includes(shortcut.id as PassageMarkupFormatId)) {
          e.preventDefault();
          chooseFormatRef.current(shortcut.id as PassageMarkupFormatId);
          return;
        }
      }

      if (e.key !== 'Enter' || e.shiftKey) return;
      // A textarea owns Enter for newlines, and a button focused via keyboard
      // should act on Enter itself rather than having the dialog copy out from
      // under it.
      const el = document.activeElement;
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLButtonElement) return;
      e.preventDefault();
      confirmRef.current();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (isOpen && tab?.book && tab.chapter) {
      const bookName = moduleStore.getBookName(tab.book);
      const highlighted = tab.studyVerse;
      setParsedBookNumber(tab.book);
      setParsedBookName(bookName);
      setParsedChapter(tab.chapter);
      setFetchedVerses(null);
      setIsWholeBook(false);
      setParsedEndChapter(0);
      if (highlighted) {
        // A shift-click selection opens the dialog on the whole passage. The
        // anchor may sit at either end of it, so order the pair rather than
        // assuming the anchor is the start.
        const other = tab.selectionEndVerse ?? highlighted;
        const verse = Math.min(highlighted, other) % 1000;
        const endV = Math.max(highlighted, other) % 1000;
        const base = formatPassageRef(tab.book, tab.chapter, verse, bookName);
        setRefInput(endV > verse ? `${base}-${endV}` : base);
        setStartVerse(verse);
        setEndVerse(endV);
      } else {
        setRefInput(formatPassageRef(tab.book, tab.chapter, 1, bookName));
        setStartVerse(1);
        setEndVerse(1);
      }
    }
  }, [isOpen]);

  // Fetch verses when user enters a different book/chapter than the current tab
  const fetchKeyRef = useRef('');
  useEffect(() => {
    if (!tab?.book || !tab.chapter) return;
    const effectiveBook = parsedBookNumber || tab.book;
    const effectiveChapter = parsedChapter || tab.chapter;

    // Whole-book fetch: fetch all chapters
    if (isWholeBook && effectiveBook) {
      const bookInfo = moduleStore.getBookByNumber(effectiveBook);
      const chapterCount = bookInfo?.chapter_count ?? 0;
      const key = `${tab.moduleAbbr}-${effectiveBook}-whole`;

      if (key !== fetchKeyRef.current && chapterCount > 0) {
        fetchKeyRef.current = key;
        setFetchingVerses(true);

        const chapters = Array.from({ length: chapterCount }, (_, i) => i + 1);
        mapWithConcurrency(chapters, CHAPTER_FETCH_CONCURRENCY, ch =>
          bibleStore.fetchChapter(tab.moduleAbbr, effectiveBook, ch)
        ).then(chapterArrays => {
          if (fetchKeyRef.current === key) {
            setFetchedVerses(chapterArrays.flat());
            setFetchingVerses(false);
          }
        }).catch(() => {
          if (fetchKeyRef.current === key) {
            setFetchedVerses([]);
            setFetchingVerses(false);
          }
        });
      }
      return;
    }

    // Multi-chapter range fetch (e.g., "John 16-21" or "John 16:1-17:5")
    if (parsedEndChapter > 0 && parsedEndChapter > effectiveChapter && effectiveBook) {
      const key = `${tab.moduleAbbr}-${effectiveBook}-${effectiveChapter}-${parsedEndChapter}`;

      if (key !== fetchKeyRef.current) {
        fetchKeyRef.current = key;
        setFetchingVerses(true);

        const chapters = Array.from(
          { length: parsedEndChapter - effectiveChapter + 1 },
          (_, i) => effectiveChapter + i,
        );
        mapWithConcurrency(chapters, CHAPTER_FETCH_CONCURRENCY, ch =>
          bibleStore.fetchChapter(tab.moduleAbbr, effectiveBook, ch)
        ).then(chapterArrays => {
          if (fetchKeyRef.current === key) {
            setFetchedVerses(chapterArrays.flat());
            setFetchingVerses(false);
          }
        }).catch(() => {
          if (fetchKeyRef.current === key) {
            setFetchedVerses([]);
            setFetchingVerses(false);
          }
        });
      }
      return;
    }

    const isDifferent = effectiveBook !== tab.book || effectiveChapter !== tab.chapter;
    const key = `${tab.moduleAbbr}-${effectiveBook}-${effectiveChapter}`;

    if (isDifferent && key !== fetchKeyRef.current) {
      fetchKeyRef.current = key;
      setFetchingVerses(true);
      bibleStore.fetchChapter(tab.moduleAbbr, effectiveBook, effectiveChapter).then(verses => {
        // Only apply if the key still matches (user may have typed more)
        if (fetchKeyRef.current === key) {
          setFetchedVerses(verses);
          setFetchingVerses(false);
        }
      }).catch(() => {
        if (fetchKeyRef.current === key) {
          setFetchedVerses([]);
          setFetchingVerses(false);
        }
      });
    } else if (!isDifferent) {
      fetchKeyRef.current = '';
      setFetchedVerses(null);
      setFetchingVerses(false);
    }
  }, [parsedBookNumber, parsedChapter, parsedEndChapter, isWholeBook, tab?.book, tab?.chapter, tab?.moduleAbbr]);

  if (!isOpen || !tab?.book || !tab.chapter) return null;

  const tabBookName = moduleStore.getBookName(tab.book);

  const handleRefChange = (value: string) => {
    setRefInput(value);
    const parsed = parseReferenceRange(value);
    if (parsed) {
      setStartVerse(parsed.startVerse);
      setEndVerse(parsed.endVerse);
      setIsWholeBook(!!parsed.wholeBook);
      setParsedEndChapter(parsed.endChapter ?? 0);
      if (parsed.bookNumber) {
        setParsedBookNumber(parsed.bookNumber);
        setParsedBookName(parsed.bookName);
        setParsedChapter(parsed.chapter);
      } else if (parsed.chapter) {
        // Chapter:verse without book — use current tab's book
        setParsedBookNumber(tab.book ?? 0);
        setParsedBookName(tabBookName);
        setParsedChapter(parsed.chapter);
      } else {
        setParsedBookNumber(tab.book ?? 0);
        setParsedBookName(tabBookName);
        setParsedChapter(tab.chapter ?? 0);
      }
    }
  };

  // Use fetched verses when viewing a different book/chapter, otherwise use tab verses
  const sourceVerses = fetchedVerses ?? tab.verses;
  const isMultiChapterRange = parsedEndChapter > 0 && parsedEndChapter > (parsedChapter || tab.chapter);

  const selectedVerses = isWholeBook
    ? sourceVerses  // Whole book: use all fetched verses
    : isMultiChapterRange
      ? (() => {
          const effectiveBook = parsedBookNumber || tab.book;
          const startCh = parsedChapter || tab.chapter;
          const startId = effectiveBook * 1000000 + startCh * 1000 + startVerse;
          const endId = endVerse === Infinity
            ? effectiveBook * 1000000 + parsedEndChapter * 1000 + 999
            : effectiveBook * 1000000 + parsedEndChapter * 1000 + endVerse;
          return sourceVerses.filter(v => v.verse_id >= startId && v.verse_id <= endId);
        })()
      : sourceVerses.filter(v => v.verse >= startVerse && v.verse <= endVerse);

  // What the formatter needs to know about the passage. The reference itself is
  // core's to build (`buildPassageReference`), which reads the chapters off the
  // verses — so a cross-chapter range renders "John 16:1-17:5" rather than
  // splicing this chapter onto that verse.
  const context: VerseContext = {
    bookName: parsedBookName || tabBookName,
    chapter: parsedChapter || tab.chapter,
    translation: tab.moduleAbbr,
  };

  // The two strings core cannot produce itself, because they are localized.
  // `{verse}` and `{reference}` are core's own placeholders, substituted by the
  // renderer — not i18next's, which is why they keep single braces.
  const labels: PassageMarkupLabels = {
    verseHeading: t('ui.passageInsert.verseHeading'),
    commentPlaceholder: t('ui.passageInsert.commentPlaceholderText'),
  };

  const markup = renderPassageMarkup(selectedVerses, context, formatId, options, labels);

  const wantsBlockQuote = advanced.textFormat === 'blockquote';

  /**
   * Whether a `text/html` flavour goes on the clipboard beside the plain one.
   *
   * Red letters are the reason there is markup to carry at all, and Markdown is
   * the reason not to: Markdown reaches the clipboard as *source text*, and
   * writing an HTML flavour alongside it would let a rich editor pick the HTML
   * and silently discard the Markdown the user explicitly asked for. The same
   * condition is what tells the renderer to keep the red-letter spans in the
   * lines it writes out.
   */
  const useRichCopy = options.wordsOfChristInRed && !advanced.markdown;

  /**
   * The block tree written out as source text — what a consumer with no
   * structure of its own wants, and what the plain clipboard flavour is
   * derived from.
   */
  const sourceText = passageMarkupToSourceText(markup, {
    markdown: advanced.markdown,
    blockQuote: wantsBlockQuote,
    richText: useRichCopy,
  });

  // Stripped with core's DOM-free helpers rather than a detached div's
  // `textContent`: unlike the whitespace-collapsing `stripHtml`, these leave the
  // line structure the passage was written into intact.
  const plainText = useRichCopy ? decodeHtmlEntities(stripHtmlTags(sourceText)) : sourceText;

  const handleCopy = async () => {
    if (useRichCopy) {
      // A markup shape knows its own structure, so its rich flavour *is* that
      // structure: pasting "Verse headings" into a document gives real headings
      // and a real block quote rather than a run of quote markers.
      const html = `<div style="font-family: serif; font-size: 14px; line-height: 1.6;">${passageMarkupToHtml(markup)}</div>`;
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plainText], { type: 'text/plain' }),
          }),
        ]);
      } catch {
        // Not every browser has the async ClipboardItem API, and a page served
        // without a permission grant refuses `write` while still allowing
        // `writeText`. Plain text is always better than nothing.
        await navigator.clipboard.writeText(plainText);
      }
    } else {
      await navigator.clipboard.writeText(plainText);
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const canCopy = !fetchingVerses && selectedVerses.length > 0;

  // Enter is "copy and be done" — the dialog exists only to produce the copy,
  // so leaving it open afterwards just makes the user reach for Escape too.
  // Clicking the button keeps the old behaviour, where the dialog stays put and
  // shows "Copied!", so a second copy after tweaking options costs no reopen.
  confirmRef.current = () => {
    if (!canCopy) return;
    void handleCopy().then(onClose);
  };

  const changeOptions = (partial: Partial<PassageMarkupOptions>): void => {
    const next = { ...options, ...partial };
    setOptions(next);
    // Written through as they change rather than on Copy, so dismissing with
    // Escape throws away the copy and never the settings.
    saveMarkupOptions(formatId, next);
  };

  const changeAdvanced = (partial: Partial<AdvancedCopyOptions>): void => {
    const next = { ...advanced, ...partial };
    setAdvanced(next);
    saveAdvancedOptions(next);
  };

  /**
   * Which shape controls the selected format actually understands. A control
   * that cannot do anything for this format is not rendered, rather than shown
   * doing nothing.
   */
  const meta = getPassageMarkupFormat(formatId);
  const uses = (control: keyof PassageMarkupShapeOptions): boolean =>
    meta?.controls.includes(control) ?? false;

  const shortcutLast = Math.min(
    formats.length > 0 ? formats[formats.length - 1].number : 0,
    MAX_FORMAT_SHORTCUT,
  );

  const renderPreview = (): ComponentChildren => {
    if (fetchingVerses) {
      return <pre class="copy-dialog__preview-source" style={{ opacity: 0.5 }}>{t('copyDialog.loading')}</pre>;
    }
    // Markdown previews as its own source text. It reaches the clipboard as
    // literal markup, so rendering the structure here would show styling the
    // paste will not carry; the source is both simpler and what the user is
    // actually about to paste.
    if (advanced.markdown) {
      return <pre class="copy-dialog__preview-source">{sourceText}</pre>;
    }
    return <MarkupPreview markup={markup} blockQuote={wantsBlockQuote} />;
  };

  return (
    <div class="copy-dialog-overlay" onMouseDown={onClose}>
      <div class="copy-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div class="copy-dialog__header">
          <h3>{t('copyDialog.title')}</h3>
          <button onClick={onClose} aria-label={t('common.close')}><i class="fa-solid fa-xmark" /></button>
        </div>

        <div class="copy-dialog__ref-field">
          <label>
            <span>{t('copyDialog.reference')}</span>
            <input
              type="text"
              value={refInput}
              placeholder={`${tabBookName} ${tab.chapter}:1-5`}
              onInput={(e) => handleRefChange((e.target as HTMLInputElement).value)}
            />
          </label>
        </div>

        {/* Formats and their options on the left, live preview on the right —
            a toggle and its effect on the output are then one glance apart. On
            a narrow screen the two stack and the preview lands underneath. */}
        <div class="copy-dialog__body">
          <div class="copy-dialog__left">
            <div class="copy-dialog__format-section">
              {/* Not a <label>: it names the radio group, not one field. */}
              <div id="copy-dialog-format-heading" class="copy-dialog__section-heading">
                {t('copyDialog.formatHeading')}
              </div>
              <div
                class="copy-dialog__formats"
                role="radiogroup"
                aria-labelledby="copy-dialog-format-heading"
              >
                {formats.map(f => {
                  const id = f.id as PassageMarkupFormatId;
                  const selected = id === formatId;
                  return (
                    <label
                      key={f.id}
                      data-format-id={f.id}
                      class={`copy-dialog__format ${selected ? 'copy-dialog__format--selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name={formatGroupName}
                        value={f.id}
                        checked={selected}
                        onChange={() => chooseFormat(id)}
                      />
                      {/* The badge is a keyboard hint, not part of the format's
                          name: a screen reader announcing "three inline quote"
                          would read as a count. The hint line below says what
                          the numbers are for. */}
                      <span class="copy-dialog__format-number" aria-hidden="true" data-format-number={f.number}>
                        {f.number}
                      </span>
                      <span class="copy-dialog__format-text">
                        <span class="copy-dialog__format-name">{t(`${f.labelKey}.name`)}</span>
                        <span class="copy-dialog__format-desc">{t(`${f.labelKey}.description`)}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <p class="copy-dialog__format-hint">
                {t('ui.passageInsert.formatShortcutHint', { first: 1, last: shortcutLast })}
              </p>
            </div>

            <div class="copy-dialog__advanced-options">
              <div class="copy-dialog__section-heading">{t('copyDialog.advancedOptionsHeading')}</div>

              {uses('referencePosition') && (
                <label class="copy-dialog__option">
                  <span>{t('ui.passageInsert.referenceLabel')}</span>
                  <select
                    value={options.referencePosition}
                    onChange={(e) => changeOptions({ referencePosition: (e.target as HTMLSelectElement).value as PassageReferencePosition })}
                  >
                    {PASSAGE_REFERENCE_POSITIONS.map(pos => (
                      <option key={pos} value={pos}>{t(REFERENCE_POSITION_LABELS[pos])}</option>
                    ))}
                  </select>
                </label>
              )}

              {uses('verseNumbers') && (
                <label class="copy-dialog__option">
                  <span>{t('ui.passageInsert.verseNumbersLabel')}</span>
                  <select
                    value={options.verseNumbers}
                    onChange={(e) => changeOptions({ verseNumbers: (e.target as HTMLSelectElement).value as VerseNumberStyle })}
                  >
                    {VERSE_NUMBER_STYLES.map(style => (
                      <option key={style} value={style}>{t(VERSE_NUMBER_LABELS[style])}</option>
                    ))}
                  </select>
                </label>
              )}

              {uses('headingLevel') && (
                <label class="copy-dialog__option">
                  <span>{t('ui.passageInsert.headingLevelLabel')}</span>
                  <select
                    value={String(options.headingLevel)}
                    onChange={(e) => changeOptions({ headingLevel: Number((e.target as HTMLSelectElement).value) as HeadingLevel })}
                  >
                    {HEADING_LEVELS.map(level => (
                      <option key={level} value={String(level)}>{`H${level}`}</option>
                    ))}
                  </select>
                </label>
              )}

              {uses('quoteMarks') && (
                <label class="copy-dialog__option">
                  <span>{t('ui.passageInsert.quoteMarksLabel')}</span>
                  <select
                    value={options.quoteMarks}
                    onChange={(e) => changeOptions({ quoteMarks: (e.target as HTMLSelectElement).value as QuoteMarkStyle })}
                  >
                    {QUOTE_MARK_STYLES.map(style => (
                      <option key={style} value={style}>
                        {QUOTE_MARK_LABELS[style] ?? t('ui.passageInsert.quoteMarksNone')}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {/* A checkbox rather than a select, because unlike the others this
                  is not a choice between renderings of the same thing — it
                  either adds a row of writing prompts or it does not. */}
              {uses('commentPlaceholders') && (
                <label class="copy-dialog__option">
                  <input
                    type="checkbox"
                    checked={options.commentPlaceholders}
                    onChange={(e) => changeOptions({ commentPlaceholders: (e.target as HTMLInputElement).checked })}
                  />
                  <span>{t('ui.passageInsert.commentPlaceholdersLabel')}</span>
                </label>
              )}

              {/* The two flags every format understands. They change the verse
                  *text* rather than the shape, so they are always offered. */}
              <label class="copy-dialog__option">
                <input
                  type="checkbox"
                  checked={options.displayVersionNumber}
                  onChange={(e) => changeOptions({ displayVersionNumber: (e.target as HTMLInputElement).checked })}
                />
                <span>{t('copyDialog.includeVersion')}</span>
              </label>

              <label class="copy-dialog__option">
                <input
                  type="checkbox"
                  checked={options.wordsOfChristInRed}
                  onChange={(e) => changeOptions({ wordsOfChristInRed: (e.target as HTMLInputElement).checked })}
                />
                <span>{t('copyDialog.christInRed')}</span>
              </label>

              {/* Markdown and the quote decoration are about the *output*
                  rather than the shape, which is why they come from the shared
                  advanced options rather than from the format's own record. */}
              <label class="copy-dialog__option copy-dialog__markdown" title={t('copyDialog.markdownDesc')}>
                <input
                  type="checkbox"
                  checked={advanced.markdown}
                  onChange={(e) => changeAdvanced({ markdown: (e.target as HTMLInputElement).checked })}
                />
                <span>{t('copyDialog.markdown')}</span>
              </label>

              {/* An inline quotation has no quote block to decorate, so the
                  control is not offered for it rather than shown doing
                  nothing. */}
              {formatId !== 'inline-quote' && (
                <label class="copy-dialog__option">
                  <span>{t('copyDialog.textFormat')}</span>
                  <select
                    value={advanced.textFormat}
                    onChange={(e) => changeAdvanced({ textFormat: (e.target as HTMLSelectElement).value as VerseTextFormat })}
                  >
                    {VERSE_TEXT_FORMATS.map(value => (
                      <option key={value} value={value}>{t(TEXT_FORMAT_LABELS[value])}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>

          <div class="copy-dialog__right">
            <div id="copy-dialog-preview-heading" class="copy-dialog__section-heading">
              {t('copyDialog.previewHeading')}
            </div>
            <div
              class="copy-dialog__preview"
              role="region"
              aria-labelledby="copy-dialog-preview-heading"
              tabIndex={0}
            >
              {renderPreview()}
            </div>
            <button
              class="copy-dialog__copy-btn"
              onClick={handleCopy}
              disabled={!canCopy}
            >
              {copied ? t('copyDialog.copied') : t('copyDialog.copyToClipboard')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
