import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { redo, undo } from 'prosemirror-history';
import type { EditorView } from 'prosemirror-view';
import {
  cycleHeading,
  isBlockActive,
  isMarkActive,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleItalic,
  toggleOrderedList,
} from './commands';
import type { Command } from 'prosemirror-state';
import { focusFirstMenuItem, handleMenuKey, useExclusiveMenu } from '../../../lib/menuKeys';

export type InsertKind = 'verse' | 'hymn' | 'quote';

interface ToolbarProps {
  view: EditorView | null;
  /** Bumped by the editor on every state change so active states refresh. */
  tick: number;
  onInsertRequest?: (kind: InsertKind) => void;
}

/** Desktop/tablet only: phones get no rich-text editor (07-me). */
export function Toolbar({ view, tick, onInsertRequest }: ToolbarProps) {
  const { t } = useTranslation();
  const [insertOpen, setInsertOpen] = useState(false);
  const insertRoot = useRef<HTMLDivElement>(null);
  const insertButton = useRef<HTMLButtonElement>(null);
  const insertMenu = useRef<HTMLDivElement>(null);

  useExclusiveMenu('notes-insert-menu', insertOpen, () => setInsertOpen(false));
  useEffect(() => {
    if (!insertOpen) return undefined;
    focusFirstMenuItem(insertMenu.current);
    const away = (e: MouseEvent) => {
      if (insertRoot.current && !insertRoot.current.contains(e.target as Node)) setInsertOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [insertOpen]);
  const closeToButton = () => {
    setInsertOpen(false);
    insertButton.current?.focus();
  };
  void tick;
  const state = view?.state;

  const run = (cmd: Command) => () => {
    if (!view) return;
    cmd(view.state, view.dispatch, view);
    view.focus();
  };
  // Keep the editor's selection: a button press must not steal focus.
  const keep = (e: Event) => e.preventDefault();

  const btn = (
    key: string,
    label: string,
    content: preact.ComponentChildren,
    cmd: Command,
    active = false,
    extraClass = '',
  ) => (
    <button
      key={key}
      type="button"
      class={`notes-toolbar__btn ${extraClass}${active ? ' is-active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={keep}
      onClick={run(cmd)}
    >
      {content}
    </button>
  );

  return (
    <div class="notes-toolbar" role="toolbar" aria-label={t('present.editor.toolbar')}>
      {btn('b', t('present.editor.bold'), <b>B</b>, toggleBold, !!state && isMarkActive(state, 'bold'))}
      {btn('i', t('present.editor.italic'), <i>I</i>, toggleItalic, !!state && isMarkActive(state, 'italic'))}
      {btn('h', t('present.editor.heading'), <span>H</span>, cycleHeading, !!state && isBlockActive(state, 'heading'))}
      {btn(
        'ul',
        t('present.editor.bulletList'),
        <i class="fa-solid fa-list-ul" aria-hidden="true" />,
        toggleBulletList,
        !!state && isBlockActive(state, 'bullet_list'),
      )}
      {btn(
        'ol',
        t('present.editor.orderedList'),
        <i class="fa-solid fa-list-ol" aria-hidden="true" />,
        toggleOrderedList,
        !!state && isBlockActive(state, 'ordered_list'),
      )}
      {btn(
        'q',
        t('present.editor.quote'),
        <i class="fa-solid fa-quote-left" aria-hidden="true" />,
        toggleBlockquote,
        !!state && isBlockActive(state, 'blockquote'),
      )}
      <span class="notes-toolbar__sep" aria-hidden="true" />
      <div
        class="notes-toolbar__insert"
        ref={insertRoot}
        onFocusOut={(e) => {
          const next = e.relatedTarget as Node | null;
          if (insertOpen && next && !insertRoot.current?.contains(next)) setInsertOpen(false);
        }}
      >
        <button
          type="button"
          class="notes-toolbar__btn notes-toolbar__btn--wide"
          aria-haspopup="menu"
          aria-expanded={insertOpen}
          ref={insertButton}
          onMouseDown={keep}
          onClick={() => setInsertOpen(!insertOpen)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && insertOpen) closeToButton();
            else if (e.key === 'ArrowDown' && !insertOpen) { e.preventDefault(); setInsertOpen(true); }
          }}
        >
          {t('present.editor.insert')}
        </button>
        {insertOpen && (
          <div
            class="notes-toolbar__menu"
            role="menu"
            ref={insertMenu}
            onKeyDown={(e) => { handleMenuKey(e as unknown as KeyboardEvent, insertMenu.current, closeToButton); }}
          >
            {(['verse', 'hymn', 'quote'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                role="menuitem"
                class="notes-toolbar__menuitem"
                onMouseDown={keep}
                onClick={() => {
                  insertButton.current?.focus();
                  setInsertOpen(false);
                  onInsertRequest?.(kind);
                }}
              >
                {t(`present.editor.insert_${kind}`)}
              </button>
            ))}
          </div>
        )}
      </div>
      <span class="notes-toolbar__sep" aria-hidden="true" />
      {btn('undo', t('present.editor.undo'), <i class="fa-solid fa-rotate-left" aria-hidden="true" />, undo)}
      {btn('redo', t('present.editor.redo'), <i class="fa-solid fa-rotate-right" aria-hidden="true" />, redo)}
    </div>
  );
}
