import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import CharacterCount from '@tiptap/extension-character-count';
import EditorToolbar, { type NoteExportActions } from './EditorToolbar';
import { verseReferencePlugin } from './VerseReferencePlugin';
import { FontSize } from './FontSizeExtension';
import { createSlashCommandsExtension } from './SlashCommands';
import VersePreviewTooltip from '../../VersePreviewTooltip';
import NoteEditorVerseMenu from './NoteEditorVerseMenu';
import VerseExpandPopover from './VerseExpandPopover';
import { getVerseReferenceRanges } from './VerseReferencePlugin';
import { findRangeContainingPos, findRangeAtCaret, type VerseRefRange } from './verseReferenceRanges';
import { findExpansionRange, type ExpansionRange } from './verseExpansionRanges';
import VerseExpansionMark, { newExpansionId } from './VerseExpansionMark';
import VerseExpandTabExtension, { type VerseExpandRequest } from './VerseExpandTabExtension';
import {
  getActiveTranslation,
  fetchVersesForReference,
  replaceRangeWithHtml,
  insertBlockAfter,
  type ExpandFailureReason,
} from '../../../services/verseExpansionService';
import { ReferenceParser } from '@bible/core';
import type { PassageInsertOptions } from '../../../services/copyFormats';
import type { CachedVerse } from '../../../services/verseFetchCache';
import { VerseIdHelper } from '@bible/core';
import { useI18n } from '../../../contexts/useI18n';

interface NoteEditorProps {
  value: string;
  onChange: (content: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  /**
   * Print / PDF / Word / Markdown, passed straight through to the toolbar.
   * Only the notes pane can supply them - they act on the *file* the editor's
   * content belongs to, which the editor itself knows nothing about.
   */
  exportActions?: NoteExportActions;
}

/** Re-parses the reference stored on an expansion so it can be re-fetched. */
const referenceParser = new ReferenceParser();

/**
 * Why a Tab expansion did not happen. Tab claims the key synchronously, before
 * the verse fetch resolves, so a refusal has to be said out loud or it reads
 * as a dead keypress.
 */
function expandNoticeText(
  t: (key: string, params?: Record<string, unknown>) => string,
  notice: { reason: ExpandFailureReason; referenceText: string; verseCount?: number },
): string {
  switch (notice.reason) {
    case 'too-large':
      return t(
        'ui.noteEditor.expandTooLarge',
        { reference: notice.referenceText, count: notice.verseCount ?? 0 },
      );
    case 'not-found':
      return t('ui.noteEditor.expandNotFound', { reference: notice.referenceText, });
    case 'no-translation':
      return t('ui.noteEditor.expandNoTranslation');
    default:
      return t('ui.noteEditor.expandFailed', { reference: notice.referenceText, });
  }
}

// "Soft tab" inserted by the Tab key (see `handleEditorContainerKeyDown`). A
// literal U+0009 tab character round-trips through the saved HTML fine, but
// default `white-space: normal` collapses it to a single space visually - a
// run of non-breaking spaces is what actually renders as an indent, and
// (being ordinary characters) survives save/load through the .bn HTML content
// exactly like any other text.
const SOFT_TAB = '    ';

/**
 * Gap between a detected reference and the preview popup anchored under it.
 *
 * `usePopupPosition`'s 20px default is sized for a popup anchored to the mouse
 * *pointer*, where the popup has to clear the cursor glyph. Anchored to the
 * reference's own bounding box that same 20px is a dead band: leaving the
 * reference fires `mouseout` and starts the close timer, and the pointer then
 * has 20 unowned pixels to cross before the popup's `onMouseEnter` can cancel
 * it. 4px is visually attached and crossable in a single pointer move.
 */
const REFERENCE_POPUP_GAP = 4;

/**
 * Grace period between leaving a reference and hiding its preview. Long enough
 * to reach the popup and let its `onMouseEnter` cancel the timer, short enough
 * that a popup left behind by a passing pointer does not linger.
 */
const HOVER_CLOSE_DELAY_MS = 220;

const NoteEditor: React.FC<NoteEditorProps> = ({
  value,
  onChange,
  placeholder,
  readOnly = false,
  exportActions
}) => {
  const { t } = useI18n();
  const resolvedPlaceholder = placeholder ?? t('ui.noteEditor.placeholder');
  const isInternalUpdate = useRef(false);
  // The toolbar button and the slash commands open the same dialog Tab does,
  // in its "ask me which passage" mode - see `VerseExpandPopover`. The mode
  // only chooses which format it opens on.
  const [passagePrompt, setPassagePrompt] = useState<{
    formatId: string;
    /**
     * Minted when the dialog opens, not at render time - `newExpansionId()`
     * in the JSX would hand it a different id on every re-render, and the id
     * is what makes the inserted passage re-formattable afterwards.
     */
    expansionId: string;
  } | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [tooltipState, setTooltipState] = useState<{
    visible: boolean;
    verseId: number;
    endVerseId?: number;
    position: { x: number; y: number };
  }>({ visible: false, verseId: 0, position: { x: 0, y: 0 } });

  // Right-click-a-reference state. The PM range is snapshotted when the menu
  // opens rather than re-derived on click: the document can change underneath
  // a menu that is already on screen, and a stale range would replace the
  // wrong text.
  const [verseMenu, setVerseMenu] = useState<{
    /** Set when the click was on a detected, not-yet-expanded reference. */
    range?: VerseRefRange;
    /**
     * Set when the click was on a passage that has already been expanded.
     * The two are mutually exclusive: the menu offers expansion actions for
     * the first and re-format for the second.
     */
    expansion?: { expansionId: string; reference: string };
    position: { x: number; y: number };
  } | null>(null);
  // The format picker is a centered modal, not an anchored popover, so no
  // trigger coordinates are carried here - see `VerseExpandPopover`.
  const [expandState, setExpandState] = useState<{
    range: VerseRefRange;
    verses: CachedVerse[];
    translation: string;
    /** Set when re-formatting an expansion that is already in the document. */
    existing?: ExpansionRange;
    initialFormatId?: string;
    initialOptions?: PassageInsertOptions;
    /**
     * Where the passage goes, for the Tab path. `'after-block'` leaves the
     * reference in its sentence and adds the passage in a new paragraph
     * below; the right-click path always replaces and leaves this unset.
     */
    placement?: 'replace' | 'after-block';
    blockEnd?: number;
    /**
     * Minted when the picker opens, not at render time - `newExpansionId()`
     * in the JSX would hand the popover a different id on every re-render.
     */
    expansionId?: string;
  } | null>(null);
  const [expandNotice, setExpandNotice] = useState<{
    reason: ExpandFailureReason;
    referenceText: string;
    verseCount?: number;
  } | null>(null);
  // Preview of the reference the caret is on, anchored under the reference
  // itself (not the caret) so it never covers what is being typed.
  const [caretPreview, setCaretPreview] = useState<{
    verseId: number;
    endVerseId?: number;
    position: { x: number; y: number };
  } | null>(null);

  /**
   * Tab found a reference: fetch it and open the format picker over it.
   *
   * The fetch lives here rather than in the keymap because a keymap has to
   * decide synchronously whether it is claiming the key - it can report "there
   * is a reference here", but not "and it resolved to 3 verses". Every refusal
   * therefore has to be announced (`expandNotice`), or Tab reads as a dead
   * keypress.
   *
   * Stable across renders (`[]`): the extension list captures this callback
   * when the editor is created and never re-reads it, and everything it
   * touches is a setter, a ref, or a module function.
   */
  const handleTabExpandRequest = useCallback(async (request: VerseExpandRequest) => {
    if (!editorRef.current) return;

    const translation = getActiveTranslation();
    if (!translation) {
      setExpandNotice({ reason: 'no-translation', referenceText: request.range.text });
      return;
    }

    let verses: CachedVerse[] | null;
    try {
      verses = await fetchVersesForReference(request.range.ref, translation);
    } catch {
      setExpandNotice({ reason: 'fetch-failed', referenceText: request.range.text });
      return;
    }
    if (!verses || verses.length === 0) {
      setExpandNotice({ reason: 'not-found', referenceText: request.range.text });
      return;
    }

    setExpandState({
      range: request.range,
      verses,
      translation,
      placement: request.placement,
      blockEnd: request.blockEnd,
      expansionId: request.expansionId,
    });
  }, []);

  // "Passage (block)" - the whole passage as one quotation.
  const openPassageBlock = useCallback(() => {
    setPassagePrompt({ formatId: 'blockquote', expansionId: newExpansionId() });
  }, []);

  // "Passage (verse-by-verse)" - a heading per verse with the verse quoted
  // beneath it. Comment placeholders are also available, as a checkbox on
  // the format itself.
  const openPassageVerses = useCallback(() => {
    setPassagePrompt({ formatId: 'heading-per-verse', expansionId: newExpansionId() });
  }, []);

  const insertImageFromFile = useCallback(async () => {
    try {
      const dataUrl = await window.electron.ipcRenderer.invoke('file-notes:pick-image');
      if (dataUrl && editorRef.current) {
        editorRef.current.chain().focus().setImage({ src: dataUrl }).run();
      }
    } catch {
      // Fall back to URL prompt if IPC fails
      const url = prompt(t('ui.noteEditor.imageUrlPrompt'));
      if (url) {
        editorRef.current?.chain().focus().setImage({ src: url }).run();
      }
    }
  }, [t]);

  // Memoize the slash commands extension so it's stable across re-renders
  const slashCommandsExtension = React.useMemo(
    () =>
      createSlashCommandsExtension(
        {
          onInsertPassageBlock: openPassageBlock,
          onInsertPassageVerses: openPassageVerses,
          onInsertImage: insertImageFromFile,
        },
        t,
      ),
    [openPassageBlock, openPassageVerses, insertImageFromFile, t],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        codeBlock: false,
        code: false,
      }),
      Underline,
      Highlight.configure({
        multicolor: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'verse-link',
        },
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: resolvedPlaceholder }),
      Typography,
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      Subscript,
      Superscript,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      CharacterCount,
      VerseExpansionMark,
      VerseExpandTabExtension.configure({
        onExpandRequest: request => {
          void handleTabExpandRequest(request);
        },
        markupLabels: {
          verseHeading: t('ui.passageInsert.verseHeading'),
          commentPlaceholder: t('ui.passageInsert.commentPlaceholderText'),
        },
        onExpandFailed: (reason, referenceText, verseCount) => {
          // Tab claims the key before the fetch resolves, so a refusal would
          // otherwise be a keypress that visibly does nothing.
          setExpandNotice({ reason, referenceText, verseCount });
        },
      }),
      slashCommandsExtension,
    ],
    content: value || '',
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      if (!isInternalUpdate.current) {
        const html = editor.getHTML();
        onChange(html);
      }
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-full',
        // Note body font-size follows the Typography section's "Study text"
        // slider (--study-font-size) and the "Global Font Scale" slider
        // (--global-font-scale), the same two variables every other content
        // pane's `.pane-content-*` rule multiplies together in globals.css -
        // a bare 16px here would never move no matter what the user set the
        // font preferences to. The `16px` fallback matches
        // DEFAULT_TYPOGRAPHY.studyFontSize so an un-hydrated document root
        // (e.g. in tests) still renders at the correct default.
        // font-family/line-height are intentionally left as-is (out of
        // scope here).
        style: 'font-family: Georgia, serif; font-size: calc(var(--study-font-size, 16px) * var(--global-font-scale, 1)); line-height: 1.7;',
      },
    },
  });

  // Store a ref to the editor for use in callbacks
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Register the verse reference detection plugin
  useEffect(() => {
    if (editor && !readOnly) {
      editor.registerPlugin(verseReferencePlugin);
      return () => {
        editor.unregisterPlugin(verseReferencePlugin.spec.key!);
      };
    }
    return undefined;
  }, [editor, readOnly]);

  // Verse reference hover -> show VersePreviewTooltip
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const handleMouseOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('.verse-ref-detected') as HTMLElement | null;
      if (!target) return;

      const book = parseInt(target.getAttribute('data-book') || '', 10);
      const chapter = parseInt(target.getAttribute('data-chapter') || '', 10);
      const verse = parseInt(target.getAttribute('data-verse') || '', 10) || 1;
      const endChapter = parseInt(target.getAttribute('data-end-chapter') || '', 10);
      const endVerse = parseInt(target.getAttribute('data-end-verse') || '', 10);

      if (isNaN(book) || isNaN(chapter)) return;

      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);

      const verseId = VerseIdHelper.calculate(book, chapter, verse);
      let endVerseId: number | undefined;
      if (!isNaN(endVerse) && endVerse > 0) {
        const ec = !isNaN(endChapter) && endChapter > 0 ? endChapter : chapter;
        endVerseId = VerseIdHelper.calculate(book, ec, endVerse);
      }

      // Anchored to the reference's own box, not the pointer. A
      // pointer-anchored popup lands wherever in the line the cursor happened
      // to be (typically below the *middle* of the text, hence "too low"), and
      // it moves under the pointer as it drifts. The element's rect is stable
      // and sits flush under the word being previewed.
      const rect = target.getBoundingClientRect();
      const next = {
        visible: true,
        verseId,
        endVerseId,
        position: { x: rect.left, y: rect.bottom },
      };
      setTooltipState(prev =>
        prev.visible &&
        prev.verseId === next.verseId &&
        prev.endVerseId === next.endVerseId &&
        prev.position.x === next.position.x &&
        prev.position.y === next.position.y
          ? prev
          : next,
      );
    };

    const handleMouseOut = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('.verse-ref-detected');
      if (!target) return;

      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = setTimeout(() => {
        setTooltipState(prev => ({ ...prev, visible: false }));
      }, HOVER_CLOSE_DELAY_MS);
    };

    // Re-formatting an already-expanded passage is offered from the
    // right-click menu, where the other passage actions already are and
    // where the user has asked for it - not a chip that appears on hover,
    // which would be a poor fit: it would have no `mouseout` to clear it, so
    // it would hang around over the text long after the pointer had left,
    // and an affordance that appears merely because the pointer crossed a
    // passage interrupts reading.

    container.addEventListener('mouseover', handleMouseOver);
    container.addEventListener('mouseout', handleMouseOut);
    return () => {
      container.removeEventListener('mouseover', handleMouseOver);
      container.removeEventListener('mouseout', handleMouseOut);
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  // Tab-trap state for the "Escape, then Tab" focus-out convention (documented
  // in notes-writing.md): by default, Tab/Shift+Tab indent/outdent the current
  // line instead of moving focus, so keyboard users can indent like in any
  // text editor. Pressing Escape "arms" a one-shot exception - the very next
  // Tab press moves focus out of the editor instead of indenting, and the arm
  // resets on any other keypress. This mirrors the common code-editor
  // "Escape then Tab" pattern for keyboard-only users who need to leave the
  // field.
  const tabEscapeArmedRef = useRef(false);

  const handleEditorContainerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!editor || readOnly) return;

      if (e.key === 'Escape') {
        tabEscapeArmedRef.current = true;
        return;
      }
      if (e.key !== 'Tab') {
        // Any other key cancels a pending escape-hatch.
        tabEscapeArmedRef.current = false;
        return;
      }
      if (e.defaultPrevented) {
        // ProseMirror/TipTap already handled this Tab. This handler is a React
        // bubble-phase listener on the wrapper div, so it runs *after* the
        // editor's own keydown listener. Until the verse-expansion keymap
        // existed it was protected only by coincidence - its
        // isActive('listItem' | 'tableCell' | ...) checks happened to be true
        // exactly when TipTap had already consumed Tab. An expansion fires in
        // a plain paragraph, where none of those are true, so without this
        // guard the soft tab below would append four non-breaking spaces
        // after every expanded passage - into content saved to .bn files.
        return;
      }
      if (tabEscapeArmedRef.current) {
        // Escape armed the exit hatch: let this Tab move focus normally.
        tabEscapeArmedRef.current = false;
        return;
      }
      if (
        editor.isActive('listItem') ||
        editor.isActive('taskItem') ||
        editor.isActive('tableCell') ||
        editor.isActive('tableHeader')
      ) {
        // Defer to TipTap's own Tab handling: list sink/lift-list-item and
        // table next/previous-cell navigation are both bound to Tab already
        // and should keep working as-is.
        return;
      }

      e.preventDefault();
      if (e.shiftKey) {
        // Outdent: remove up to one SOFT_TAB worth of trailing non-breaking
        // spaces immediately before the cursor, if any are there.
        const { state } = editor;
        const { $from } = state.selection;
        const lineStart = $from.start();
        const textBefore = state.doc.textBetween(lineStart, $from.pos, '\n', '\n');
        const match = textBefore.match(/ +$/);
        if (match) {
          const removeLen = Math.min(match[0].length, SOFT_TAB.length);
          editor.chain().focus().deleteRange({ from: $from.pos - removeLen, to: $from.pos }).run();
        }
      } else {
        editor.chain().focus().insertContent(SOFT_TAB).run();
      }
    },
    [editor, readOnly],
  );

  // Typing a reference shows a preview of the verse it resolves to, so the
  // user can check it before pressing Tab. `Jn 3:1` on the way to `3:16` is a
  // real verse and Tab would expand it, which is exactly what this catches.
  //
  // Anchored to the reference's own decoration element rather than the caret:
  // the decoration is a real DOM node with a bounding rect, so this needs
  // neither `coordsAtPos` (which returns garbage in jsdom) nor a second
  // positioning system, and the popup sits under the reference where it
  // cannot obscure the text being typed.
  useEffect(() => {
    if (!editor || readOnly) return undefined;

    const update = () => {
      const { state } = editor;
      if (!state.selection.empty) {
        setCaretPreview(null);
        return;
      }
      const range = findRangeAtCaret(getVerseReferenceRanges(state), state.selection.$head.pos);
      if (!range || !range.ref.book || !range.ref.chapter) {
        setCaretPreview(null);
        return;
      }

      // `domAtPos` walks the DOM<->document mapping and needs no layout.
      const at = editor.view.domAtPos(range.from);
      const node = at.node.nodeType === Node.TEXT_NODE ? at.node.parentElement : (at.node as HTMLElement);
      const el = node?.closest('.verse-ref-detected') as HTMLElement | null;
      if (!el) {
        setCaretPreview(null);
        return;
      }

      const rect = el.getBoundingClientRect();
      const verseId = VerseIdHelper.calculate(range.ref.book, range.ref.chapter, range.ref.verse ?? 1);
      const endVerseId = range.ref.endVerse
        ? VerseIdHelper.calculate(
            range.ref.book,
            range.ref.endChapter ?? range.ref.chapter,
            range.ref.endVerse,
          )
        : undefined;
      setCaretPreview({ verseId, endVerseId, position: { x: rect.left, y: rect.bottom } });
    };

    const timer = { id: null as ReturnType<typeof setTimeout> | null };
    const debounced = () => {
      if (timer.id) clearTimeout(timer.id);
      timer.id = setTimeout(update, 250);
    };

    editor.on('selectionUpdate', debounced);
    editor.on('update', debounced);
    editor.on('blur', () => setCaretPreview(null));
    return () => {
      if (timer.id) clearTimeout(timer.id);
      editor.off('selectionUpdate', debounced);
      editor.off('update', debounced);
    };
  }, [editor, readOnly]);

  // The refusal notice is informational, not an error the user has to dismiss.
  useEffect(() => {
    if (!expandNotice) return undefined;
    const timer = setTimeout(() => setExpandNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [expandNotice]);

  const handleCloseTooltip = useCallback(() => {
    setTooltipState(prev => ({ ...prev, visible: false }));
  }, []);

  const handleTooltipMouseEnter = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  // "Go to verse" in the preview: the same navigation Alt+Click performs, as
  // an explicit affordance. `useVerseNavigationListeners` in the notes pane
  // owns the listener, so this stays a plain window event like the plugin's.
  const handleGoToVerse = useCallback(() => {
    const { bookNumber, chapter, verse } = VerseIdHelper.parse(tooltipState.verseId);
    setTooltipState(prev => ({ ...prev, visible: false }));
    window.dispatchEvent(
      new CustomEvent('navigate-to-verse', {
        detail: { book: String(bookNumber), chapter: String(chapter), verse: String(verse || 1) },
      }),
    );
  }, [tooltipState.verseId]);

  /** Dispatch the same navigation events the reference plugin's clicks do. */
  const navigateToRange = useCallback((range: VerseRefRange, newPanel: boolean) => {
    const { book, chapter, verse } = range.ref;
    if (!book || !chapter) return;
    window.dispatchEvent(
      new CustomEvent(newPanel ? 'navigate-to-verse-new-tab' : 'navigate-to-verse', {
        detail: {
          book: String(book),
          chapter: String(chapter),
          verse: String(verse ?? 1),
          referenceText: range.text,
        },
      }),
    );
  }, []);

  // Right-click over a detected reference - or over a passage already
  // expanded from one - opens the verse menu. Anywhere else in the editor is
  // left alone: there is no native renderer context menu in this app, so
  // preventDefault() here costs nothing, but claiming every right-click would.
  const handleEditorContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!editor || readOnly) return;
      const target = e.target as HTMLElement;

      const refEl = target.closest('.verse-ref-detected') as HTMLElement | null;
      if (refEl) {
        // posAtDOM walks the DOM->document mapping and needs no layout, unlike
        // posAtCoords - which is why this path is testable in jsdom at all.
        const pos = editor.view.posAtDOM(refEl, 0);
        const range = findRangeContainingPos(getVerseReferenceRanges(editor.state), pos);
        if (!range) return;

        e.preventDefault();
        setVerseMenu({ range, position: { x: e.clientX, y: e.clientY } });
        return;
      }

      const expansionEl = target.closest('.verse-expansion') as HTMLElement | null;
      if (!expansionEl) return;
      const expansionId = expansionEl.getAttribute('data-expansion-id');
      if (!expansionId) return;

      // An expanded passage is ordinary editable text - the user may have
      // typed a parenthetical into it. Re-formatting replaces the whole
      // passage, so once it has been edited the offer is withdrawn rather than
      // silently discarding their words. Expanding again from the reference is
      // still available if they want a clean copy.
      const live = findExpansionRange(editor.state.doc, expansionId);
      if (!live || live.isEdited) return;

      e.preventDefault();
      setVerseMenu({
        expansion: { expansionId, reference: live.reference },
        position: { x: e.clientX, y: e.clientY },
      });
    },
    [editor, readOnly],
  );

  const handleExpandRequest = useCallback(async () => {
    const range = verseMenu?.range;
    if (!range) return;
    const translation = getActiveTranslation();
    if (!translation) return;

    const verses = await fetchVersesForReference(range.ref, translation);
    if (!verses || verses.length === 0) return;

    setExpandState({ range, verses, translation });
  }, [verseMenu]);

  const handleExpandInsert = useCallback(
    (html: string) => {
      const state = expandState;
      setExpandState(null);
      if (!editor || !state) return;

      if (state.existing) {
        // Re-formatting: the expansion's live extent is looked up again rather
        // than reusing the positions captured when the popover opened, since
        // the document may have changed while it was open.
        const current = findExpansionRange(editor.state.doc, state.existing.expansionId);
        if (!current) return;
        replaceRangeWithHtml(editor, current.replaceFrom, current.replaceTo, html);
        return;
      }

      // Tab on a reference inside a sentence keeps the sentence: the passage
      // goes in a paragraph below it rather than over it.
      if (state.placement === 'after-block' && state.blockEnd !== undefined) {
        insertBlockAfter(editor, state.blockEnd, html);
        return;
      }

      replaceRangeWithHtml(editor, state.range.from, state.range.to, html);
    },
    [editor, expandState],
  );

  /** Open the format picker on an expansion that is already in the document. */
  const handleReformatRequest = useCallback(async () => {
    const target = verseMenu?.expansion;
    if (!editor || !target) return;

    const existing = findExpansionRange(editor.state.doc, target.expansionId);
    if (!existing) return;

    const translation = getActiveTranslation();
    if (!translation) return;

    const parsed = referenceParser.parse(existing.reference);
    if (!parsed.isValid) return;

    const verses = await fetchVersesForReference(parsed, translation);
    if (!verses || verses.length === 0) return;

    setExpandState({
      // `range` is unused on the re-format path (the extent comes from
      // `existing`), but the popover's shape wants a reference to label with.
      range: { from: existing.from, to: existing.to, text: existing.reference, ref: parsed },
      verses,
      translation,
      existing,
      initialFormatId: existing.formatId || undefined,
      initialOptions: existing.options ?? undefined,
    });
  }, [editor, verseMenu]);

  // Update editor content when value prop changes externally
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      isInternalUpdate.current = true;
      editor.commands.setContent(value || '');
      isInternalUpdate.current = false;
    }
  }, [value, editor]);

  // Update editable state when readOnly changes
  useEffect(() => {
    if (editor) {
      editor.setEditable(!readOnly);
    }
  }, [readOnly, editor]);

  const handlePassageInsert = useCallback(
    (html: string) => {
      setPassagePrompt(null);
      if (editor) {
        editor.chain().focus().insertContent(html).run();
      }
    },
    [editor],
  );

  return (
    <div className="note-editor h-full flex flex-col">
      {/* Toolbar (only show when not read-only) */}
      {!readOnly && (
        <EditorToolbar
          editor={editor}
          onInsertPassage={openPassageBlock}
          onInsertImage={insertImageFromFile}
          exportActions={exportActions}
        />
      )}

      {/* Editor content */}
      <div
        ref={editorContainerRef}
        className="flex-1 overflow-auto p-4"
        onKeyDown={handleEditorContainerKeyDown}
        onContextMenu={handleEditorContextMenu}
      >
        <EditorContent
          editor={editor}
          className="h-full"
        />
      </div>

      {/* Verse Preview Tooltip */}
      {tooltipState.visible && (
        <VersePreviewTooltip
          verseId={tooltipState.verseId}
          endVerseId={tooltipState.endVerseId}
          position={tooltipState.position}
          offsetY={REFERENCE_POPUP_GAP}
          onClose={handleCloseTooltip}
          onMouseEnter={handleTooltipMouseEnter}
          onGoToVerse={handleGoToVerse}
          hint={t('versePreviewTooltip.hintAltCtrlClick')}
        />
      )}

      {/* Right-click menu over a detected reference, or over an expansion */}
      {verseMenu && (
        <NoteEditorVerseMenu
          referenceText={verseMenu.range?.text ?? verseMenu.expansion?.reference ?? ''}
          position={verseMenu.position}
          onClose={() => setVerseMenu(null)}
          onExpand={verseMenu.range ? () => { void handleExpandRequest(); } : undefined}
          onGoToVerse={
            verseMenu.range ? () => navigateToRange(verseMenu.range!, false) : undefined
          }
          onOpenInNewPanel={
            verseMenu.range ? () => navigateToRange(verseMenu.range!, true) : undefined
          }
          onReformat={verseMenu.expansion ? () => { void handleReformatRequest(); } : undefined}
        />
      )}

      {/* Preview of the reference being typed. Hover wins if both apply, so
          the two popups never stack. */}
      {caretPreview && !tooltipState.visible && !expandState && (
        <VersePreviewTooltip
          verseId={caretPreview.verseId}
          endVerseId={caretPreview.endVerseId}
          position={caretPreview.position}
          offsetY={REFERENCE_POPUP_GAP}
          onClose={() => setCaretPreview(null)}
          hint={t('ui.noteEditor.tabToExpand')}
        />
      )}

      {/* Format picker - for a new expansion, or re-formatting an existing one */}
      {expandState && (
        <VerseExpandPopover
          referenceText={expandState.range.text}
          verses={expandState.verses}
          translation={expandState.translation}
          onCancel={() => setExpandState(null)}
          onInsert={handleExpandInsert}
          expansionId={
            expandState.existing?.expansionId ?? expandState.expansionId ?? newExpansionId()
          }
          initialFormatId={expandState.initialFormatId}
          initialOptions={expandState.initialOptions}
          isReformat={Boolean(expandState.existing)}
          asBlock={expandState.placement === 'after-block'}
        />
      )}

      {/* Why a Tab press did nothing */}
      {expandNotice && (
        <div
          role="status"
          className="text-xs px-3 py-1.5 rounded shadow-lg border border-border-secondary bg-surface"
          style={{ position: 'fixed', bottom: 12, insetInlineStart: 12, zIndex: 9998 }}
        >
          {expandNoticeText(t, expandNotice)}
          <button
            type="button"
            className="ms-2 text-text-secondary"
            onClick={() => setExpandNotice(null)}
          >
            &times;
          </button>
        </div>
      )}

      {/* Passage insertion dialog (triggered by slash commands or toolbar) */}
      {/* "+ Bible Passage" and the slash commands: the same dialog Tab opens,
          with a reference field on top. */}
      {passagePrompt && (
        <VerseExpandPopover
          promptForReference
          referenceText=""
          verses={[]}
          translation={getActiveTranslation() ?? ''}
          initialFormatId={passagePrompt.formatId}
          expansionId={passagePrompt.expansionId}
          onCancel={() => setPassagePrompt(null)}
          onInsert={handlePassageInsert}
        />
      )}
    </div>
  );
};

export default NoteEditor;
