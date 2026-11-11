import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Store } from '../../../../stores/Store';

/**
 * Tells the selection popup when the notes editor's selection changes and
 * whether a mouse drag is still going on. Its `plugin` is one of
 * `notesStore.plugins`, so it needs no change to the editor itself.
 *
 * Kept apart from `notesStore` on purpose: selection moves on every arrow
 * key, and notesStore's subscribers (the whole Notes pane) should not
 * re-render for that.
 */
export class SelectionWatch extends Store {
  view: EditorView | null = null;
  /** True between a primary-button mousedown in the editor and the next mouseup anywhere. */
  dragging = false;

  private readonly onMouseUp = (): void => {
    document.removeEventListener('mouseup', this.onMouseUp, true);
    if (!this.dragging) return;
    this.dragging = false;
    this.notify();
  };

  readonly plugin = new Plugin({
    view: (view) => {
      this.view = view;
      return {
        update: (v, prev) => {
          this.view = v;
          if (v.state.doc !== prev.doc || !v.state.selection.eq(prev.selection)) this.notify();
        },
        destroy: () => {
          if (this.view === view) this.view = null;
          this.onMouseUp();
          this.notify();
        },
      };
    },
    props: {
      handleDOMEvents: {
        mousedown: (_view, event) => {
          if (event.button !== 0) return false;
          this.dragging = true;
          document.addEventListener('mouseup', this.onMouseUp, true);
          this.notify();
          return false;
        },
      },
    },
  });
}

export const selectionWatch = new SelectionWatch();
