import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findNoteMatches, type NoteFindRange } from './noteFindRanges';

export interface NoteFindState {
  query: string;
  caseSensitive: boolean;
  current: number;
}

export const noteFindKey = new PluginKey<NoteFindState>('noteFind');

/** Current matches for the editor's state (empty when find is idle). */
export function getNoteFindMatches(state: Parameters<typeof noteFindKey.getState>[0]): NoteFindRange[] {
  const s = noteFindKey.getState(state);
  return s ? findNoteMatches(state.doc, s.query, s.caseSensitive) : [];
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    noteFind: {
      setNoteFind: (find: Partial<NoteFindState>) => ReturnType;
    };
  }
}

/**
 * Find-in-note (Ctrl+F in the notes pane). Matches are painted as decorations
 * (`note-find-match`, `note-find-match-current`), so they never enter the
 * saved HTML. The query/current index live in plugin state, set by the
 * `setNoteFind` command via transaction meta.
 */
export const NoteFind = Extension.create({
  name: 'noteFind',
  addCommands() {
    return {
      setNoteFind:
        find =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(noteFindKey, find));
          return true;
        },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<NoteFindState>({
        key: noteFindKey,
        state: {
          init: () => ({ query: '', caseSensitive: false, current: 0 }),
          apply: (tr, prev) => {
            const meta = tr.getMeta(noteFindKey) as Partial<NoteFindState> | undefined;
            return meta ? { ...prev, ...meta } : prev;
          },
        },
        props: {
          decorations(state) {
            const s = noteFindKey.getState(state);
            if (!s || !s.query) return null;
            const matches = findNoteMatches(state.doc, s.query, s.caseSensitive);
            if (matches.length === 0) return null;
            const cur = ((s.current % matches.length) + matches.length) % matches.length;
            return DecorationSet.create(
              state.doc,
              matches.map((m, i) =>
                Decoration.inline(m.from, m.to, {
                  class: i === cur ? 'note-find-match note-find-match-current' : 'note-find-match',
                }),
              ),
            );
          },
        },
      }),
    ];
  },
});
