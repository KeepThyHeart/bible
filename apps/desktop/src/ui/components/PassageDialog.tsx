/**
 * "Which passage, in what shape?" - the one dialog behind copying scripture to
 * the clipboard, inserting it into a note, and re-formatting a passage already
 * in a note.
 *
 * Two separate dialogs, one for copy and one for insert, would drift apart in
 * every way two dialogs doing the same job can: different reference boxes
 * (one debounced as you typed, one fetched on blur), different format lists
 * in different orders, different keyboard policies, one portaled and one
 * not. The product owner's summary is the design brief - *"I'd like to see
 * '+ Bible Passage' act just like copy/paste as far as the dialog goes,
 * except the text would be Insert instead of Copy"* - so
 * {@link PassageDialogMode} is the whole of the difference between them:
 *
 *   - `copy` - writes to the clipboard; primary button "Copy".
 *   - `insert` - writes HTML into the note; primary button "Insert".
 *   - `reformat` - the same, for a passage already in the note; "Apply".
 *
 * Everything else - the reference box, the translation picker, the five
 * formats, the per-format options, the live preview, the digit shortcuts - is
 * shared verbatim, because there is never a reason for it not to be.
 *
 * **Five formats, not seven.** See `@bible/core`'s `PassageFormat/formatCatalog.ts`:
 * "Standard" is a numbered quote and "Combined" is an inline quote, both
 * written as lines, which is why nobody can say what the difference is.
 * Both still *render* - a note saved with one keeps its shape, and
 * re-formatting such a passage shows it in the picker marked as retired -
 * but neither is offered as a new choice.
 *
 * **The preview follows the mode, not the format.** Copy previews the source
 * text the clipboard will receive, in a `whitespace-pre-wrap` box; insert
 * previews the HTML the document will receive. The same format therefore looks
 * different in the two modes, which is correct: that *is* the difference
 * between a clipboard and a document.
 *
 * **It is portaled and sits above the editor's own chrome.** `PopupPortal` is
 * not optional: dockview's `.dv-dockview { contain: layout }` establishes a
 * containing block for every pane, so a `fixed inset-0` backdrop declared
 * inside one covers the pane rather than the window. The z-index is above the
 * notes editor's fixed-position chrome (the expand notice and "Change format"
 * chip both sit at 9998), so a modal can never open underneath one of them -
 * Tailwind's `z-50` would.
 *
 * **Its height is fixed, not content-driven.** Every format brings a different
 * number of controls and a different-length preview, and in prompt mode the
 * body starts as a single status line. A content-sized dialog would open
 * three rows tall and jump to full height when the fetch lands, walking the
 * primary button out from under the pointer. Sized generously up front
 * instead; the body scrolls, and `h-[85vh]` keeps it inside a short window.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  copyToClipboard,
  getLastUsedPassageFormatId,
  setLastUsedFormatId,
  setLastUsedFormatOptions,
  type FormatOptions,
} from '../services/verseCopyService';
import {
  BUILTIN_TEMPLATES,
  loadAdvancedCopyOptions,
  saveAdvancedCopyOptions,
  type AdvancedCopyOptions,
  type VerseTextFormat,
  loadUserTemplates,
  upsertUserTemplate,
  deleteSavedCopyTemplate,
  loadActiveTemplateText,
  saveActiveTemplateText,
  loadActiveTemplateName,
  saveActiveTemplateName,
  renderCopyTemplate,
  type SavedTemplate,
  isPassageMarkupFormat,
  renderPassageMarkup,
  passageMarkupToSourceText,
  passageMarkupToHtml,
  resolvePassageMarkupOptions,
  savePassageMarkupOptions,
  resolveFormatShortcut,
  getPassageFormatCatalog,
  getLastInsertFormatId,
  setLastInsertFormatId,
  getSkipFormatMenu,
  setSkipFormatMenu,
  MAX_FORMAT_SHORTCUT,
  type PassageInsertOptions,
  type PassageMarkupLabels,
} from '../services/copyFormats';
import {
  buildInsertHtml,
  buildVerseContext,
  formatExpansion,
  loadInsertOptions,
  MAX_EXPAND_VERSES,
} from '../services/verseExpansionService';
import type { CachedVerse } from '../services/verseFetchCache';
import { usePassageResolver } from './notes/editor/usePassageResolver';
import FormatOptionsPanel from './FormatOptionsPanel';
import PassageMarkupOptionsPanel from './PassageMarkupOptionsPanel';
import VerseFormatPicker from './shared/VerseFormatPicker';
import { useI18n } from '../contexts/useI18n';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { PopupPortal } from '../hooks/usePopupPosition';
import { isTextEntryTarget } from '../utils/textEntry';
import { sanitizeHtml } from '../utils/sanitize';

/**
 * Above the notes editor's own fixed-position chrome, which sits at 9998.
 * See the file header.
 */
const MODAL_Z_INDEX = 9999;

/** Element ids the dialog-level Enter handler has to recognise. */
const REFERENCE_INPUT_ID = 'passage-dialog-reference';
const TEMPLATE_SAVE_INPUT_ID = 'passage-dialog-template-save-name';

export type PassageDialogMode = 'copy' | 'insert' | 'reformat';

export interface PassageDialogProps {
  mode: PassageDialogMode;
  /**
   * Verses the caller has already fetched. Empty only in prompt mode, where
   * the user has not named a passage yet.
   */
  verses: CachedVerse[];
  /** Reference to seed the box with - empty in prompt mode. */
  referenceText: string;
  /** Translation the verses came from, and the one quoted unless changed. */
  translation: string;
  /**
   * Open with an empty reference and let the user name the passage.
   *
   * This is what makes "+ Bible Passage" and "type a reference, press Tab" the
   * same feature rather than two half-features producing different markup. It
   * only changes where focus lands and whether the dialog opens holding a
   * passage; the reference box itself is always there.
   */
  promptForReference?: boolean;
  onClose: () => void;
  /** copy mode: called after the clipboard write succeeds. */
  onCopied?: () => void;
  /** insert and reformat: called with the HTML to put in the document. */
  onInsert?: (html: string) => void;
  /**
   * Identity stamped onto the inserted passage so it can be re-formatted
   * later. Re-formatting reuses the existing id, so the passage keeps one
   * identity across format changes.
   */
  expansionId?: string;
  /** Pre-selected format - the expansion's current one when re-formatting. */
  initialFormatId?: string;
  initialOptions?: PassageInsertOptions;
  /**
   * The passage is going into a paragraph of its own (Tab appending beneath a
   * sentence), so even a one-line format has to be a block.
   */
  asBlock?: boolean;
  /**
   * Offer "always use this format - Tab inserts without asking".
   *
   * Only on the Tab-shaped paths: the checkbox is about what *Tab* does, and
   * from the toolbar the user came here precisely to make a choice.
   */
  offerSkipFormatMenu?: boolean;
}

const PassageDialog: React.FC<PassageDialogProps> = ({
  mode,
  verses,
  referenceText,
  translation,
  promptForReference = false,
  onClose,
  onCopied,
  onInsert,
  expansionId,
  initialFormatId,
  initialOptions,
  asBlock = false,
  offerSkipFormatMenu = false,
}) => {
  const { t } = useI18n();
  const isCopy = mode === 'copy';
  const isReformat = mode === 'reformat';

  // One resolver for every mode; a dialog-local one would be weaker - see
  // `usePassageResolver`'s header for what that costs.
  const resolver = usePassageResolver({
    enabled: true,
    initialReference: referenceText,
    initialTranslation: translation,
    initialVerses: promptForReference ? [] : verses,
  });

  const activeVerses = resolver.verses;
  const activeTranslation = resolver.translation;
  const hasPassage = activeVerses.length > 0;
  /** The box has been edited past what `activeVerses` answers to. */
  const isStale = resolver.isStale;

  const [formatId, setFormatId] = useState<string>(() => {
    if (initialFormatId) return initialFormatId;
    return isCopy ? getLastUsedPassageFormatId() : getLastInsertFormatId();
  });
  const [options, setOptions] = useState<PassageInsertOptions>(
    () => initialOptions ?? loadInsertOptions(initialFormatId ?? (isCopy
      ? getLastUsedPassageFormatId()
      : getLastInsertFormatId())),
  );
  const [skipMenu, setSkipMenu] = useState<boolean>(() => getSkipFormatMenu());

  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  const referenceInputRef = useRef<HTMLInputElement>(null);

  const [showReferenceHelp, setShowReferenceHelp] = useState(false);

  // Template editor state (used when formatId === 'template')
  const [templateText, setTemplateText] = useState<string>(() => loadActiveTemplateText());
  const [userTemplates, setUserTemplates] = useState<SavedTemplate[]>(() => loadUserTemplates());
  const [templatePickerValue, setTemplatePickerValue] = useState<string>(() =>
    loadActiveTemplateName(),
  );
  const [showVariableRef, setShowVariableRef] = useState(false);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveName, setSaveName] = useState('');
  const isTemplateFormat = formatId === 'template';
  const markupFormatId = isPassageMarkupFormat(formatId) ? formatId : null;

  /**
   * Markdown and "is the quote decorated at all" are genuinely about the
   * *output*, not the shape, so they stay in the shared advanced-options
   * record even though the panel that held the rest of it is gone, along with
   * Standard and Combined. Written through on change, so tuning them and
   * dismissing with Escape keeps the tuning.
   */
  const [advancedOptions, setAdvancedOptions] = useState<AdvancedCopyOptions>(() =>
    loadAdvancedCopyOptions(),
  );

  /**
   * Localized strings the markup renderer cannot produce itself, so a "Verse
   * headings" copy and a "Verse headings" insertion of the same passage read
   * identically.
   */
  const labels: PassageMarkupLabels = useMemo(
    () => ({
      verseHeading: t('ui.passageInsert.verseHeading'),
      commentPlaceholder: t('ui.passageInsert.commentPlaceholderText'),
    }),
    [t],
  );

  /**
   * Where the format choice is remembered.
   *
   * Two keys, deliberately, even though there is now one dialog: copying to
   * the clipboard and writing into a document are different acts, and someone
   * who habitually pastes an inline quote into an email may just as habitually
   * quote a numbered block into a sermon. The insert key also records a
   * clipboard format in *both* stores, so "the format I was last using" does
   * not disagree between the two surfaces when the user picks one of those.
   */
  const rememberFormatId = useCallback(
    (id: string) => {
      if (isCopy) {
        setLastUsedFormatId(id);
        return;
      }
      setLastInsertFormatId(id);
      if (!isPassageMarkupFormat(id)) setLastUsedFormatId(id);
    },
    [isCopy],
  );

  /** Selecting a format swaps in that format's remembered options. */
  const chooseFormat = useCallback(
    (id: string) => {
      setFormatId(id);
      rememberFormatId(id);
      setOptions(loadInsertOptions(id));
    },
    [rememberFormatId],
  );

  /**
   * Options are written through as they change rather than on commit, so
   * dismissing with Escape throws away the copy or the insertion and never the
   * settings.
   */
  const changeOptions = useCallback(
    (next: PassageInsertOptions) => {
      setOptions(next);
      if (isPassageMarkupFormat(formatId)) {
        savePassageMarkupOptions(formatId, resolvePassageMarkupOptions(formatId, next));
      } else {
        setLastUsedFormatOptions({
          displayVersionNumber: next.displayVersionNumber,
          wordsOfChristInRed: next.wordsOfChristInRed,
        });
      }
    },
    [formatId],
  );

  useEffect(() => {
    rememberFormatId(formatId);
  }, [formatId, rememberFormatId]);

  useEffect(() => {
    saveActiveTemplateName(templatePickerValue);
  }, [templatePickerValue]);

  useEffect(() => {
    saveAdvancedCopyOptions(advancedOptions);
  }, [advancedOptions]);

  /**
   * The template text is saved *synchronously* as it is edited, not in an
   * effect, because the insert-mode preview renders through the format
   * registry - which reads the saved text. Deferring the write left that
   * preview one keystroke behind what the editor showed.
   */
  const changeTemplateText = useCallback((next: string) => {
    saveActiveTemplateText(next);
    setTemplateText(next);
  }, []);

  /**
   * Focus on open.
   *
   * Where it goes decides whether the digit shortcuts work: the reference box
   * is a text entry, so `1`-`5` belong to "John 3:16" while it has focus.
   * A path that arrives with its passage already resolved (Tab, re-format)
   * therefore opens on the *format list*, which is what makes "John 3:16-17,
   * Tab, 2, Enter" a complete insertion. Everywhere the user still has to say
   * which passage, the box wins.
   *
   * Declared after `useFocusTrap` so it runs second and wins - the trap
   * otherwise parks focus on the first focusable element.
   */
  const focusFormatListOnOpen = !isCopy && !promptForReference;
  useEffect(() => {
    if (focusFormatListOnOpen) {
      const root = dialogRef.current;
      const target =
        root?.querySelector<HTMLElement>(`[data-format-id="${formatId}"] input`) ??
        root?.querySelector<HTMLElement>('[data-format-id] input');
      target?.focus();
      return;
    }
    const input = referenceInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
    // On open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    // The backdrop covers the window, so "outside the dialog" means the
    // backdrop.
    const handleClickOutside = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose, dialogRef]);

  // -- Rendering the chosen format -----------------------------------

  /**
   * The clipboard flavour: source text, exactly what Copy will write.
   *
   * Bypasses the format registry for the two formats whose input the user is
   * editing live - the template's text and a markup format's options - because
   * `format()` reads the *saved* values and would show the preview one edit
   * behind the control just touched.
   */
  const renderCopyOutput = useCallback(
    (verseList: CachedVerse[]): string => {
      if (verseList.length === 0) return '';
      const ctx = buildVerseContext(verseList, activeTranslation);
      if (isTemplateFormat) {
        return renderCopyTemplate(templateText, verseList, ctx, options);
      }
      if (isPassageMarkupFormat(formatId)) {
        // A block tree has nowhere to go on a clipboard, so it is written out
        // as source text - the same thing the Markdown option has always done.
        return passageMarkupToSourceText(
          renderPassageMarkup(verseList, ctx, formatId, options, labels),
          {
            markdown: advancedOptions.markdown,
            blockQuote: advancedOptions.textFormat === 'blockquote',
            richText: options.wordsOfChristInRed && !advancedOptions.markdown,
          },
        );
      }
      // A retired format, reached only by re-formatting an old note.
      return formatExpansion(verseList, activeTranslation, formatId, options);
    },
    [
      activeTranslation, isTemplateFormat, templateText, options, formatId, labels,
      advancedOptions.markdown, advancedOptions.textFormat,
    ],
  );

  /** The document flavour: exactly the HTML Insert will put in the note. */
  const renderInsertHtml = useCallback(
    (verseList: CachedVerse[]): string =>
      verseList.length === 0
        ? ''
        : buildInsertHtml(verseList, activeTranslation, formatId, options, { asBlock, labels }),
    [activeTranslation, formatId, options, asBlock, labels],
  );

  const previewHtml = useMemo(
    () =>
      sanitizeHtml(isCopy ? renderCopyOutput(activeVerses) : renderInsertHtml(activeVerses)),
    [isCopy, renderCopyOutput, renderInsertHtml, activeVerses],
  );

  // -- Committing ----------------------------------------------------

  const handleCopy = useCallback(async () => {
    const verseList = activeVerses;
    if (verseList.length === 0) return;

    const output = renderCopyOutput(verseList);

    const tmp = document.createElement('div');
    tmp.innerHTML = output;
    const plainText = tmp.textContent || tmp.innerText || output;

    // Markdown output goes on the clipboard as plain text only: writing an
    // HTML flavour alongside it would let a rich editor pick the HTML and
    // silently discard the Markdown the user explicitly asked for. A template
    // writes whatever it says and is never Markdown by this flag's reckoning.
    const isMarkdownOutput = !isTemplateFormat && advancedOptions.markdown;

    let htmlForClipboard: string | undefined;
    if (options.wordsOfChristInRed && !isMarkdownOutput) {
      // A note-insertion shape already knows its own structure, so its rich
      // flavour *is* that structure: pasting "Verse headings" into Word should
      // give real headings and a real block quote, not a run of quote markers.
      // Everything else is source text, one <br> per newline - and nothing
      // extra for an empty line, or the single blank line the renderer puts
      // between the reference and the passage arrives as two.
      const htmlBody = isPassageMarkupFormat(formatId)
        ? passageMarkupToHtml(
            renderPassageMarkup(
              verseList,
              buildVerseContext(verseList, activeTranslation),
              formatId,
              options,
              labels,
            ),
          )
        : output.split('\n').join('<br>\n');
      htmlForClipboard = `<div style="font-family: serif; font-size: 14px; line-height: 1.6;">${htmlBody}</div>`;
    }

    const success = await copyToClipboard(plainText, htmlForClipboard);
    if (success) {
      onCopied?.();
      onClose();
    } else {
      alert(t('exportUtility.copyFailed'));
    }
  }, [
    activeVerses, renderCopyOutput, isTemplateFormat, advancedOptions.markdown, options,
    formatId, activeTranslation, labels, onCopied, onClose, t,
  ]);

  const handleInsert = useCallback(() => {
    if (activeVerses.length === 0) return;
    rememberFormatId(formatId);
    onInsert?.(
      buildInsertHtml(activeVerses, activeTranslation, formatId, options, {
        asBlock,
        labels,
        meta: expansionId
          ? { expansionId, reference: resolver.reference }
          : undefined,
      }),
    );
  }, [
    activeVerses, activeTranslation, formatId, options, asBlock, labels, expansionId,
    resolver.reference, onInsert, rememberFormatId,
  ]);

  /**
   * Commit - but never on a passage the box has already been edited past.
   *
   * The reference resolves on a debounce, so Enter typed straight after the
   * last character of a reference lands while the old verses are still in
   * hand. Refusing is better than copying the previous passage; the preview
   * arrives a moment later and a second Enter takes it.
   */
  const canCommit = hasPassage && !isStale;
  const commit = useCallback(() => {
    if (!canCommit) return;
    if (isCopy) void handleCopy();
    else handleInsert();
  }, [canCommit, isCopy, handleCopy, handleInsert]);

  const handleSaveTemplate = useCallback(() => {
    const name = saveName.trim();
    if (!name) return;
    setUserTemplates(upsertUserTemplate({ name, template: templateText }));
    setTemplatePickerValue(name);
    setSaveName('');
    setShowSaveInput(false);
  }, [saveName, templateText]);

  /**
   * The two dialog-level keys, on the dialog root rather than on `window`.
   *
   * A window listener was what the copy dialog used, and it is the more
   * fragile of the two inside a dock pane: it fires for keystrokes that never
   * reached the dialog at all. React's own bubbling gives exactly the events
   * the dialog owns.
   *
   * **A digit picks a format**, by the number shown beside it - the same
   * number in every mode, so "John 3:16-17, Tab, 2, Enter" is a complete
   * insertion. Guarded on focus rather than on a modifier: the reference box
   * is mostly digits, so claiming them there would make the field unusable.
   *
   * **Enter commits**, except where another control owns it: a newline in the
   * template editor, a save in the "save template as" box, and the action-row
   * buttons' own activation (which is what makes Cancel work from the
   * keyboard). Ctrl/Cmd+Enter commits from anywhere, including the textarea.
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.defaultPrevented) return;

    if (hasPassage && !e.ctrlKey && !e.metaKey && !e.altKey && !isTextEntryTarget(e.target)) {
      const shortcut = resolveFormatShortcut(e.key);
      if (shortcut) {
        e.preventDefault();
        chooseFormat(shortcut.id);
        // Keep focus on the format list when that is where it already was, so
        // the radio group and the arrow keys stay in step with the selection
        // the digit just made.
        if ((e.target as HTMLElement).closest('[data-format-id]')) {
          dialogRef.current
            ?.querySelector<HTMLElement>(`[data-format-id="${shortcut.id}"] input`)
            ?.focus();
        }
        return;
      }
    }

    if (e.key !== 'Enter') return;

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      commit();
      return;
    }

    const target = e.target as HTMLElement | null;
    if (target?.tagName === 'TEXTAREA') return;
    if (target instanceof HTMLInputElement && target.id === TEMPLATE_SAVE_INPUT_ID) return;
    if (target?.closest('[data-popover-actions]')) return;

    e.preventDefault();
    commit();
  };

  // -- Labels --------------------------------------------------------

  const dialogTitle = isCopy
    ? t('copyOptionsDialog.title')
    : promptForReference
      ? t('insertPassageDialog.title')
      : resolver.reference;

  const dialogLabel = isCopy
    ? t('copyOptionsDialog.title')
    : promptForReference
      ? t('insertPassageDialog.title')
      : t('ui.noteEditor.expandDialogLabel');

  const primaryLabel = isCopy
    ? t('copyOptionsDialog.copyButton')
    : isReformat
      ? t('ui.noteEditor.expandApply')
      : t('ui.noteEditor.expandInsert');

  const statusMessage = (): string | null => {
    switch (resolver.status) {
      case 'empty':
        return t('ui.passageInsert.promptHint');
      case 'invalid':
        return t('insertPassageDialog.invalidReference');
      case 'loading':
        return t('insertPassageDialog.loadingVerses');
      case 'notfound':
        return t('ui.passageInsert.noSuchPassage');
      case 'error':
        return t('insertPassageDialog.fetchFailed');
      case 'noTranslation':
        return t('insertPassageDialog.noTranslation');
      case 'ok':
      default:
        return null;
    }
  };

  const overCap = activeVerses.length > MAX_EXPAND_VERSES;

  return (
    <PopupPortal>
      <div
        className="fixed inset-0 bg-background-overlay flex items-center justify-center p-4"
        style={{ zIndex: MODAL_Z_INDEX }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={dialogLabel}
          data-testid="passage-dialog"
          onKeyDown={handleKeyDown}
          className="bg-surface-elevated text-text-primary rounded-lg shadow-xl w-full max-w-5xl h-[85vh] max-h-[54rem] overflow-hidden flex flex-col"
        >
          {/* Header - pinned */}
          <div className="flex items-baseline justify-between gap-3 px-6 py-4 border-b border-border">
            <h2
              id="passage-dialog-title"
              className="text-xl font-semibold text-text-heading bidi-isolate"
            >
              {dialogTitle}
            </h2>
            {hasPassage && (
              <span className="text-xs text-text-secondary">
                {t(
                  'ui.noteEditor.expandVerseCount',
                  { count: activeVerses.length, translation: activeTranslation, },
                )}
              </span>
            )}
          </div>

          {/* Body. `min-h-0` on every flex/grid ancestor of a scroller, or the
              scroller grows to its content instead of scrolling and pushes the
              pinned footer off the bottom. */}
          <div className="flex-1 min-h-0 overflow-hidden px-6 py-4 flex flex-col gap-4">
            {/* Passage reference - the same row in every mode. */}
            <div className="shrink-0">
              <div className="flex items-center gap-2 mb-1">
                <label
                  htmlFor={REFERENCE_INPUT_ID}
                  className="text-sm font-medium text-text-heading"
                >
                  {t('copyOptionsDialog.passageLabel')}
                </label>
                <button
                  type="button"
                  onClick={() => setShowReferenceHelp(v => !v)}
                  className="w-5 h-5 rounded-full border border-border-secondary text-text-secondary text-xs flex items-center justify-center hover:bg-background-hover transition-colors"
                  title={t('copyOptionsDialog.referenceFormatHelpTitle')}
                  aria-label={t('copyOptionsDialog.referenceFormatHelpTitle')}
                  aria-expanded={showReferenceHelp}
                  aria-controls="passage-dialog-reference-help"
                >
                  ?
                </button>
              </div>
              {showReferenceHelp && (
                <div
                  id="passage-dialog-reference-help"
                  className="mb-2 p-2 bg-accent-light border border-accent-soft rounded text-xs text-text-secondary"
                >
                  {t('passageDialog.supportedFormats')}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  id={REFERENCE_INPUT_ID}
                  ref={referenceInputRef}
                  data-testid="passage-reference-input"
                  type="text"
                  value={resolver.reference}
                  onChange={e => resolver.setReference(e.target.value)}
                  placeholder={t('copyOptionsDialog.referencePlaceholder')}
                  aria-invalid={resolver.status === 'invalid' ? true : undefined}
                  className="flex-1 px-3 py-2 border border-border rounded text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-accent"
                />
                {resolver.translations.length > 1 && (
                  <select
                    data-testid="passage-translation-select"
                    value={resolver.translation}
                    onChange={e => resolver.setTranslation(e.target.value)}
                    aria-label={t('insertPassageDialog.translationLabel')}
                    className="px-2 py-2 border border-border rounded text-sm bg-surface"
                  >
                    {resolver.translations.map(b => (
                      <option key={b.abbreviation} value={b.abbreviation}>
                        {b.abbreviation}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {/* While a passage is still on screen the status belongs beside
                  the box that caused it - "Loading..." holds the previous
                  passage in view, and hiding the message would make the
                  disabled primary button look broken. With nothing to show,
                  the message takes the whole body instead (below). */}
              {hasPassage && statusMessage() && (
                <p role="status" className="mt-1 text-xs text-text-secondary">
                  {statusMessage()}
                </p>
              )}
            </div>

            {/* Formats and options on the left, live preview on the right - a
                toggle and its effect on the output are then one glance apart.
                Withheld entirely until there is a passage: choosing how to lay
                out nothing is busywork, and a preview of nothing reads as a
                bug. */}
            {hasPassage ? (
              <div className="flex-1 min-h-0 grid gap-4 overflow-y-auto lg:overflow-hidden lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
                <div className="space-y-4 min-w-0 lg:overflow-y-auto lg:pe-1">
                  <div className="border border-border rounded p-3">
                    {/* Not a <label>: it names the radio group, not one field. */}
                    <div
                      id="passage-dialog-format-label"
                      className="block text-sm font-semibold text-text-heading mb-2"
                    >
                      {t('copyOptionsDialog.formatHeading')}
                    </div>
                    <VerseFormatPicker
                      selectedFormatId={formatId}
                      onSelect={chooseFormat}
                      labelledBy="passage-dialog-format-label"
                    />
                    {/* The badges are decoration until something says what they
                        are for. */}
                    <p
                      data-testid="format-shortcut-hint"
                      className="mt-2 text-xs text-text-tertiary"
                    >
                      {t(
                        'ui.passageInsert.formatShortcutHint',
                        { first: 1, last: Math.min(getPassageFormatCatalog().length, MAX_FORMAT_SHORTCUT), },
                      )}
                    </p>
                  </div>

                  {/* A note-insertion shape brings its own controls, kept per
                      format in `passageMarkupPreferences`. Only the two that
                      are genuinely about the *output* - Markdown, and whether
                      the quote is decorated at all - come from the shared
                      advanced options, and only where they can do anything. */}
                  {markupFormatId && (
                    <div className="border border-border rounded p-3 space-y-3">
                      <h3 className="text-sm font-semibold text-text-heading">
                        {t('copyOptionsDialog.advancedOptionsHeading')}
                      </h3>

                      <PassageMarkupOptionsPanel
                        formatId={markupFormatId}
                        options={options}
                        onOptionsChange={changeOptions}
                      />

                      <FormatOptionsPanel
                        options={{
                          displayVersionNumber: options.displayVersionNumber,
                          wordsOfChristInRed: options.wordsOfChristInRed,
                        }}
                        onOptionsChange={(next: FormatOptions) =>
                          changeOptions({ ...options, ...next })
                        }
                        showNote={false}
                      />

                      {/* Markdown and the quote decoration describe *text*, so
                          they are offered only where the output is text. */}
                      {isCopy && (
                        <>
                          <label className="flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={advancedOptions.markdown}
                              onChange={() =>
                                setAdvancedOptions({
                                  ...advancedOptions,
                                  markdown: !advancedOptions.markdown,
                                })
                              }
                              className="w-4 h-4 text-accent border-border-secondary rounded focus:ring-accent focus:ring-2"
                            />
                            <span className="ms-3 text-sm text-text-primary">
                              {t('copyOptionsDialog.markdown')}
                            </span>
                          </label>

                          {/* An inline quotation has no quote block to
                              decorate, so the control is not offered for it
                              rather than shown doing nothing. */}
                          {markupFormatId !== 'inline-quote' && (
                            <label className="flex items-center justify-between gap-2">
                              <span className="text-sm text-text-primary">
                                {t('copyOptionsDialog.textFormat')}
                              </span>
                              <select
                                value={advancedOptions.textFormat}
                                onChange={e =>
                                  setAdvancedOptions({
                                    ...advancedOptions,
                                    textFormat: e.target.value as VerseTextFormat,
                                  })
                                }
                                className="px-2 py-1 border border-border rounded text-sm bg-surface"
                              >
                                <option value="blockquote">
                                  {t('copyOptionsDialog.textFormatBlockQuote')}
                                </option>
                                <option value="inline">
                                  {t('copyOptionsDialog.textFormatInline')}
                                </option>
                              </select>
                            </label>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Every format that is not a markup shape still has the two
                      universal flags - a template included: they change the
                      verse *text*, which a template cannot reconstruct on its
                      own, so they are not among the things it "says for
                      itself". */}
                  {!markupFormatId && (
                    <div className="border border-border rounded p-3">
                      <FormatOptionsPanel
                        options={{
                          displayVersionNumber: options.displayVersionNumber,
                          wordsOfChristInRed: options.wordsOfChristInRed,
                        }}
                        onOptionsChange={(next: FormatOptions) =>
                          changeOptions({ ...options, ...next })
                        }
                      />
                    </div>
                  )}

                  {/* Template editor. A template says everything about its own
                      output, so nothing above applies to it and nothing above
                      is offered. */}
                  {isTemplateFormat && (
                    <div className="border border-border rounded p-3 bg-surface-secondary">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <label
                          htmlFor="passage-dialog-template-text"
                          className="text-sm font-medium text-text-heading"
                        >
                          {t('copyOptionsDialog.templateLabel')}
                        </label>
                        <select
                          aria-label={t('copyOptionsDialog.loadTemplateLabel')}
                          value={templatePickerValue}
                          onChange={e => {
                            const name = e.target.value;
                            setTemplatePickerValue(name);
                            if (!name) return;
                            const all: SavedTemplate[] = [...BUILTIN_TEMPLATES, ...userTemplates];
                            const found = all.find(item => item.name === name);
                            if (found) changeTemplateText(found.template);
                          }}
                          className="px-2 py-1 border border-border rounded text-sm bg-surface"
                          title={t('copyOptionsDialog.loadTemplateLabel')}
                        >
                          <option value="">{t('passageDialog.loadTemplate')}</option>
                          <optgroup label="Built-in">
                            {BUILTIN_TEMPLATES.map(item => (
                              <option key={`b-${item.name}`} value={item.name}>{item.name}</option>
                            ))}
                          </optgroup>
                          {userTemplates.length > 0 && (
                            <optgroup label={t('passageDialog.saved')}>
                              {userTemplates.map(item => (
                                <option key={`u-${item.name}`} value={item.name}>{item.name}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        <button
                          type="button"
                          onClick={() => setShowSaveInput(v => !v)}
                          aria-expanded={showSaveInput}
                          aria-controls="passage-dialog-template-save"
                          className="px-2 py-1 text-xs bg-surface border border-border rounded hover:bg-background-hover transition-colors"
                          title={t('copyOptionsDialog.saveTemplateTitle')}
                        >
                          {t('passageDialog.save')}
                        </button>
                        {templatePickerValue &&
                          userTemplates.some(item => item.name === templatePickerValue) && (
                            <button
                              type="button"
                              onClick={() => {
                                setUserTemplates(deleteSavedCopyTemplate(templatePickerValue));
                                setTemplatePickerValue('');
                              }}
                              className="px-2 py-1 text-xs bg-surface border border-border rounded text-danger hover:bg-danger-soft transition-colors"
                              title={t('copyOptionsDialog.deleteSavedTemplateTitle')}
                              aria-label={t(
                                'copyOptionsDialog.deleteSavedTemplateLabel',
                                { name: templatePickerValue },
                              )}
                            >
                              {t('passageDialog.delete')}
                            </button>
                          )}
                        <button
                          type="button"
                          onClick={() => setShowVariableRef(v => !v)}
                          className="w-6 h-6 rounded-full border border-border-secondary text-text-secondary text-xs flex items-center justify-center hover:bg-background-hover transition-colors ms-auto"
                          title={t('copyOptionsDialog.variableReferenceLabel')}
                          aria-label={t('copyOptionsDialog.variableReferenceLabel')}
                          aria-expanded={showVariableRef}
                          aria-controls="passage-dialog-variable-reference"
                        >
                          ?
                        </button>
                      </div>

                      {showSaveInput && (
                        <div
                          id="passage-dialog-template-save"
                          className="mb-2 flex items-center gap-2"
                        >
                          <input
                            id={TEMPLATE_SAVE_INPUT_ID}
                            type="text"
                            value={saveName}
                            onChange={e => setSaveName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                                e.preventDefault();
                                handleSaveTemplate();
                              }
                            }}
                            placeholder={t('copyOptionsDialog.templateNameLabel')}
                            aria-label={t('copyOptionsDialog.templateNameLabel')}
                            className="flex-1 px-2 py-1 border border-border rounded text-sm bg-surface"
                          />
                          <button
                            type="button"
                            disabled={!saveName.trim()}
                            onClick={handleSaveTemplate}
                            className="px-3 py-1 text-xs bg-accent text-text-on-accent rounded hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {t('passageDialog.save2')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowSaveInput(false);
                              setSaveName('');
                            }}
                            className="px-3 py-1 text-xs bg-background-tertiary rounded hover:bg-background-active transition-colors"
                          >
                            {t('passageDialog.cancel')}
                          </button>
                        </div>
                      )}

                      <textarea
                        id="passage-dialog-template-text"
                        value={templateText}
                        onChange={e => changeTemplateText(e.target.value)}
                        spellCheck={false}
                        rows={8}
                        className="w-full px-3 py-2 border border-border rounded text-xs font-mono bg-surface focus:outline-none focus:ring-2 focus:ring-accent"
                        placeholder='{{#each verses}}{{text}} {{/each}} ({{reference}}, {{version}})'
                      />

                      {showVariableRef && (
                        <div
                          id="passage-dialog-variable-reference"
                          className="mt-2 p-3 bg-accent-light border border-accent-soft rounded text-xs text-text-secondary space-y-1"
                        >
                          <div><code>{'{{reference}}'}</code> {t('passageDialog.varReference')}</div>
                          <div><code>{'{{book}}'}</code>, <code>{'{{chapter}}'}</code>, <code>{'{{verse}}'}</code>, <code>{'{{version}}'}</code></div>
                          <div><code>{'{{moduleAbbr}}'}</code>, <code>{'{{moduleName}}'}</code>, <code>{'{{verseCount}}'}</code></div>
                          <div><code>{'{{#each verses}}...{{/each}}'}</code> {t('passageDialog.varEachVerses')}</div>
                          <div style={{ paddingInlineStart: '12px' }}>
                            {t('passageDialog.varInside')} <code>{'{{verse}}'}</code>, <code>{'{{text}}'}</code>, <code>{'{{isChristWords}}'}</code>, <code>{'{{isParagraphStart}}'}</code>
                          </div>
                          <div style={{ paddingInlineStart: '12px' }}>
                            {t('passageDialog.varLoopMeta')} <code>{'{{@index}}'}</code>, <code>{'{{@first}}'}</code>, <code>{'{{@last}}'}</code>
                          </div>
                          <div><code>{'{{#each paragraphs}}...{{/each}}'}</code> {t('passageDialog.varEachParagraphs')} <code>verses</code>{t('passageDialog.varEachParagraphsEnd')}</div>
                          <div><code>{'{{#if var}}...{{else}}...{{/if}}'}</code></div>
                          <div><code>{'{{#unless var}}...{{/unless}}'}</code></div>
                          {/* The one helper a hand-written template cannot
                              reasonably do for itself: the passage's line count
                              is not known when the template is written. */}
                          <div>
                            <code>{'{{#blockquote}}...{{/blockquote}}'}</code> {t('passageDialog.varBlockquote')} <code>&gt;&nbsp;</code>{t('passageDialog.varBlockquoteEnd')}
                          </div>
                          <div className="pt-1 text-text-tertiary italic">
                            {t('passageDialog.varSeparatorUse')} <code>\n</code> {t('passageDialog.varSeparatorIn')} <code>{'{{separator "..."}}'}</code> {t('passageDialog.varSeparatorTail')}
                          </div>
                          <div className="text-text-tertiary italic">
                            {t('passageDialog.aMistypedHelperIsReportedHere')}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Preview fills the right column and scrolls inside itself, so
                    a long passage never lengthens the dialog. */}
                <div className="min-w-0 flex flex-col min-h-0">
                  <div className="flex items-center justify-between mb-2 shrink-0">
                    <h3
                      id="passage-dialog-preview-heading"
                      className="text-sm font-semibold text-text-heading"
                    >
                      {t('copyOptionsDialog.previewHeading')}
                    </h3>
                  </div>
                  {/* Scrollable, so it needs to be reachable and named for AT. */}
                  <div
                    role="region"
                    aria-labelledby="passage-dialog-preview-heading"
                    tabIndex={0}
                    data-testid="verse-expand-preview"
                    className="flex-1 min-h-[12rem] bg-surface-secondary border border-border rounded p-4 overflow-y-auto"
                  >
                    <div
                      // `text-base`, not the `text-sm` the rest of the dialog
                      // chrome uses: this is Bible text being read, not a label
                      // being scanned, and at 14px it was hard going. The box
                      // scrolls internally inside a fixed-height dialog, so a
                      // larger face costs no layout.
                      className={`text-base text-text-primary font-serif leading-relaxed ${
                        isCopy ? 'whitespace-pre-wrap' : ''
                      }`}
                      dangerouslySetInnerHTML={{ __html: previewHtml }}
                    />
                  </div>
                  {overCap && (
                    <p className="mt-2 text-xs text-text-secondary shrink-0">
                      {t('ui.noteEditor.expandLargeWarning', { count: activeVerses.length, })}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div
                role="status"
                data-testid="passage-reference-status"
                className="flex-1 flex items-center justify-center text-sm text-text-secondary text-center"
              >
                {statusMessage()}
              </div>
            )}
          </div>

          {/* Footer - pinned, so Cancel and the primary action are always
              reachable. */}
          <div
            className="px-6 py-4 border-t border-border flex items-center justify-between gap-3"
            data-popover-actions=""
          >
            {offerSkipFormatMenu ? (
              <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={skipMenu}
                  onChange={e => {
                    setSkipMenu(e.target.checked);
                    setSkipFormatMenu(e.target.checked);
                  }}
                  className="w-3.5 h-3.5"
                />
                {t('ui.passageInsert.skipMenu')}
              </label>
            ) : (
              <span />
            )}

            <div className="flex justify-end gap-3 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-text-secondary bg-background-tertiary rounded hover:bg-background-active transition-colors"
              >
                {t('copyOptionsDialog.cancelButton')}{' '}
                <span aria-hidden="true" className="text-xs text-text-tertiary">
                  {t('exportUtility.escHint')}
                </span>
              </button>
              {/* The hint is `aria-hidden` so the accessible name stays the
                  bare verb - "Copy", "Insert", "Apply" - which is what the
                  action is, and what a screen reader should announce. */}
              <button
                type="button"
                onClick={commit}
                disabled={!canCommit}
                className="px-4 py-2 text-sm font-medium text-text-on-accent bg-accent rounded hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {primaryLabel}{' '}
                <span aria-hidden="true" className="text-xs opacity-80">
                  {t('copyOptionsDialog.enterHint')}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </PopupPortal>
  );
};

export default PassageDialog;
