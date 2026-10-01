import { Extension } from '@tiptap/core';

/**
 * Per-block text direction for the notes editor (task 0076).
 *
 * Every block renders a `dir` attribute: the author's explicit choice
 * (`ltr` / `rtl`) when there is one, otherwise `auto`, which makes the browser
 * pick the direction from the block's first strong character - so an Arabic
 * paragraph in an English note (or the reverse) lines up correctly without the
 * author doing anything. Only an explicit choice is stored in the document; an
 * `auto` block carries `dir: null` and re-renders as `dir="auto"`.
 *
 * Content direction, not chrome: the toolbar's LTR/RTL buttons do not mirror.
 */

export type BlockDirection = 'ltr' | 'rtl';

/** Block node types that carry the attribute. */
export const TEXT_DIRECTION_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'listItem',
  'bulletList',
  'orderedList',
  'taskList',
  'taskItem',
] as const;

/** `ltr`/`rtl` pass through; anything else (including `auto`) is "no explicit choice". */
export function parseBlockDirection(value: string | null | undefined): BlockDirection | null {
  return value === 'ltr' || value === 'rtl' ? value : null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textDirection: {
      /** Force every selected block to `ltr` or `rtl`. */
      setBlockDirection: (direction: BlockDirection) => ReturnType;
      /** Return every selected block to automatic (per-paragraph) detection. */
      unsetBlockDirection: () => ReturnType;
    };
  }
}

export const TextDirection = Extension.create<{ types: readonly string[] }>({
  name: 'textDirection',

  addOptions() {
    return { types: TEXT_DIRECTION_TYPES };
  },

  addGlobalAttributes() {
    return [
      {
        types: [...this.options.types],
        attributes: {
          dir: {
            default: null,
            parseHTML: (element) => parseBlockDirection(element.getAttribute('dir')),
            renderHTML: (attributes) => ({ dir: attributes.dir ?? 'auto' }),
          },
        },
      },
    ];
  },

  addCommands() {
    const apply =
      (direction: BlockDirection | null) =>
      ({ tr, state, dispatch }: { tr: any; state: any; dispatch: any }) => {
        const types = new Set<string>(this.options.types);
        const { from, to } = state.selection;
        let changed = false;
        state.doc.nodesBetween(from, to, (node: any, pos: number) => {
          if (types.has(node.type.name) && node.attrs.dir !== direction) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, dir: direction });
            changed = true;
          }
        });
        if (changed && dispatch) dispatch(tr);
        return true;
      };
    return {
      setBlockDirection: (direction: BlockDirection) => apply(direction),
      unsetBlockDirection: () => apply(null),
    };
  },

  addKeyboardShortcuts() {
    // Mod-Shift-l/e/r/j belong to TextAlign (alignment, not direction), and
    // Mod-Alt-0..3 to headings, so Mod-Alt-l / Mod-Alt-r are free.
    return {
      'Mod-Alt-l': () => this.editor.commands.setBlockDirection('ltr'),
      'Mod-Alt-r': () => this.editor.commands.setBlockDirection('rtl'),
    };
  },
});

/** The explicit direction of the block holding the selection start, or null for auto. */
export function currentBlockDirection(editor: {
  state: { selection: { $from: any } };
}): BlockDirection | null {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    const dir = $from.node(d).attrs?.dir;
    if (dir === 'ltr' || dir === 'rtl') return dir;
    if (d > 0 && TEXT_DIRECTION_TYPES.includes($from.node(d).type.name)) {
      // Innermost direction-bearing block decides; it is auto here.
      return null;
    }
  }
  return null;
}
