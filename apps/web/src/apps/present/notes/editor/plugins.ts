import { baseKeymap } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { history, redo, undo } from 'prosemirror-history';
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import type { Plugin } from 'prosemirror-state';
import { blockIdPlugin } from './blockIds';
import { toggleBold, toggleItalic } from './commands';
import { notesSchema as s } from './schema';

export interface EditorCallbacks {
  /** Ctrl/Cmd+Enter: show the item at the caret (doc position). */
  onShowAtCaret?: (pos: number) => void;
}

export function buildInputRules(): Plugin {
  const rules: InputRule[] = [
    textblockTypeInputRule(/^(#{1,2})\s$/, s.nodes.heading, (m) => ({ level: m[1].length })),
    wrappingInputRule(/^\s*([-+*])\s$/, s.nodes.bullet_list),
    wrappingInputRule(
      /^(\d+)\.\s$/,
      s.nodes.ordered_list,
      (m) => ({ order: +m[1] }),
      (m, node) => node.childCount + node.attrs.order === +m[1],
    ),
    wrappingInputRule(/^\s*>\s$/, s.nodes.blockquote),
  ];
  return inputRules({ rules });
}

/**
 * Keys. Deliberately absent: Mod-k (the host's command box), Escape is
 * handled here only to blur. `blur` is the view's own so the arrow-key
 * shortcuts outside the editor start working again.
 */
export function buildKeymap(cbs: () => EditorCallbacks): Plugin {
  return keymap({
    'Mod-b': toggleBold,
    'Mod-i': toggleItalic,
    'Mod-z': undo,
    'Shift-Mod-z': redo,
    'Mod-y': redo,
    Enter: splitListItem(s.nodes.list_item),
    Tab: sinkListItem(s.nodes.list_item),
    'Shift-Tab': liftListItem(s.nodes.list_item),
    'Mod-Enter': (state) => {
      const handler = cbs().onShowAtCaret;
      if (!handler) return false;
      handler(state.selection.from);
      return true;
    },
    Escape: (_state, _dispatch, view) => {
      if (!view) return false;
      (view.dom as HTMLElement).blur();
      return true;
    },
  });
}

/** Core plugins; the host's own (decorations, row 8) are appended after. */
export function buildPlugins(cbs: () => EditorCallbacks, extra: Plugin[] = []): Plugin[] {
  return [
    buildInputRules(),
    buildKeymap(cbs),
    keymap(baseKeymap),
    history(),
    dropCursor(),
    gapCursor(),
    blockIdPlugin(),
    ...extra,
  ];
}
