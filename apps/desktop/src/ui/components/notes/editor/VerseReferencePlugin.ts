/**
 * TipTap plugin that auto-detects Bible verse references in text
 * and renders them as highlighted, clickable decorations.
 *
 * The scan itself lives in `verseReferenceRanges.ts` and produces typed
 * `VerseRefRange[]`; this plugin keeps that array in its state alongside the
 * decorations built from it, and exposes it via `getVerseReferenceRanges()`.
 * Consumers that need to answer "is there a reference at this position?"
 * (right-click expansion, caret preview) read the ranges rather than digging
 * into DecorationSet internals.
 */
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findVerseReferenceRanges, type VerseRefRange } from './verseReferenceRanges';

interface VerseRefPluginState {
  decorations: DecorationSet;
  ranges: VerseRefRange[];
}

const verseRefPluginKey = new PluginKey<VerseRefPluginState>('verseReferenceHighlight');

function buildState(doc: ProseMirrorNode): VerseRefPluginState {
  const ranges = findVerseReferenceRanges(doc);

  const decorations = ranges.map(range =>
    Decoration.inline(range.from, range.to, {
      class: 'verse-ref-detected',
      title: range.text,
      'data-verse-ref': range.text,
      'data-book': String(range.ref.book ?? ''),
      'data-chapter': String(range.ref.chapter ?? ''),
      'data-verse': String(range.ref.verse ?? ''),
      'data-end-chapter': String(range.ref.endChapter ?? ''),
      'data-end-verse': String(range.ref.endVerse ?? ''),
    }),
  );

  return { decorations: DecorationSet.create(doc, decorations), ranges };
}

/**
 * The verse references currently detected in the document, in document order.
 * Returns an empty array when the plugin is not registered (e.g. read-only
 * editors, which never register it).
 */
export function getVerseReferenceRanges(state: EditorState): VerseRefRange[] {
  return verseRefPluginKey.getState(state)?.ranges ?? [];
}

/**
 * ProseMirror plugin for verse reference detection.
 * Register this with TipTap via `editor.registerPlugin()` or as an extension.
 *
 * Features:
 * - Auto-detects verse references and applies dotted underline decoration
 * - Shows reference text as native tooltip on hover (title attribute)
 * - Ctrl+Click dispatches a 'navigate-to-verse' custom event for navigation
 */
export const verseReferencePlugin = new Plugin<VerseRefPluginState>({
  key: verseRefPluginKey,

  state: {
    init(_, { doc }) {
      return buildState(doc);
    },
    apply(tr, old) {
      // Positions can only move when the document changes, and when it does
      // the whole scan is redone anyway - so there is nothing to map.
      return tr.docChanged ? buildState(tr.doc) : old;
    },
  },

  props: {
    decorations(state) {
      return verseRefPluginKey.getState(state)?.decorations;
    },

    handleClick(_view, _pos, event) {
      // Ctrl+Click = open verse in new tab; Alt+Click = navigate in current tab
      const isNewTab = event.ctrlKey || event.metaKey;
      const isSameTab = event.altKey;
      if (!isNewTab && !isSameTab) return false;

      const target = event.target as HTMLElement;
      const refEl = target.closest('.verse-ref-detected') as HTMLElement | null;
      if (!refEl) return false;

      const book = refEl.getAttribute('data-book');
      const chapter = refEl.getAttribute('data-chapter');
      const verse = refEl.getAttribute('data-verse');
      const endChapter = refEl.getAttribute('data-end-chapter');
      const endVerse = refEl.getAttribute('data-end-verse');
      const refText = refEl.getAttribute('data-verse-ref');

      if (book && chapter) {
        const detail: Record<string, string> = {
          book,
          chapter,
          verse: verse || '1',
          referenceText: refText || '',
        };
        if (endChapter) detail.endChapter = endChapter;
        if (endVerse) detail.endVerse = endVerse;

        const eventName = isNewTab ? 'navigate-to-verse-new-tab' : 'navigate-to-verse';
        window.dispatchEvent(
          new CustomEvent(eventName, { detail })
        );
        return true;
      }

      return false;
    },
  },
});
