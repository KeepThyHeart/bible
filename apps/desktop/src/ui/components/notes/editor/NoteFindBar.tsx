import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useI18n } from '../../../contexts/useI18n';
import { findNoteMatches } from './noteFindRanges';

interface NoteFindBarProps {
  editor: Editor;
  onClose: () => void;
}

/** Small find bar for the notes editor; reuses the main find bar's strings. */
const NoteFindBar: React.FC<NoteFindBarProps> = ({ editor, onClose }) => {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [current, setCurrent] = useState(0);
  // Bumped on every document change so the count stays right while typing.
  const [docVersion, setDocVersion] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const bump = () => setDocVersion(v => v + 1);
    editor.on('update', bump);
    return () => {
      editor.off('update', bump);
      editor.commands.setNoteFind({ query: '', current: 0 });
    };
  }, [editor]);

  const matches = useMemo(
    () => findNoteMatches(editor.state.doc, query, caseSensitive),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, query, caseSensitive, docVersion],
  );
  const index = matches.length ? ((current % matches.length) + matches.length) % matches.length : 0;

  useEffect(() => {
    editor.commands.setNoteFind({ query, caseSensitive, current: index });
    const m = matches[index];
    if (m) {
      // Scroll without stealing focus from the find input.
      const { view } = editor;
      const dom = view.domAtPos(m.from).node;
      const el = dom.nodeType === Node.TEXT_NODE ? dom.parentElement : (dom as HTMLElement);
      el?.scrollIntoView?.({ block: 'center' });
    }
  }, [editor, query, caseSensitive, index, matches]);

  const step = (d: number) => matches.length && setCurrent(index + d);

  return (
    <div
      className="flex items-center gap-2 px-3 py-1 border-b border-border bg-background-warm"
      role="search"
      aria-label={t('ui.findBar.placeholder')}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        } else if (e.key === 'Enter' || e.key === 'F3') {
          e.preventDefault();
          step(e.shiftKey ? -1 : 1);
        }
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); setCurrent(0); }}
        placeholder={t('ui.findBar.placeholder')}
        aria-label={t('ui.findBar.placeholder')}
        className="w-48 px-2 py-1 text-sm border border-border-secondary rounded focus:outline-none focus:ring-2 focus:ring-accent"
      />
      <span role="status" aria-live="polite" className="text-sm text-text-secondary min-w-[4rem] text-center">
        {query ? `${matches.length ? index + 1 : 0} / ${matches.length}` : ''}
      </span>
      <button type="button" onClick={() => step(-1)} disabled={!matches.length}
        className="p-1 rounded hover:bg-background-hover disabled:opacity-40"
        title={t('ui.findBar.previousMatch')} aria-label={t('ui.findBar.previousMatch')}>
        <span aria-hidden="true">&#8593;</span>
      </button>
      <button type="button" onClick={() => step(1)} disabled={!matches.length}
        className="p-1 rounded hover:bg-background-hover disabled:opacity-40"
        title={t('ui.findBar.nextMatch')} aria-label={t('ui.findBar.nextMatch')}>
        <span aria-hidden="true">&#8595;</span>
      </button>
      <button type="button" onClick={() => { setCaseSensitive(c => !c); setCurrent(0); }}
        className={`p-1 rounded text-sm font-mono ${caseSensitive ? 'bg-accent-soft text-accent-strong' : 'hover:bg-background-hover text-text-secondary'}`}
        title={t('ui.findBar.matchCase')} aria-label={t('ui.findBar.matchCase')} aria-pressed={caseSensitive}>
        <span aria-hidden="true">Aa</span>
      </button>
      <button type="button" onClick={onClose}
        className="p-1 rounded hover:bg-background-hover"
        title={t('ui.findBar.close')} aria-label={t('ui.findBar.close')}>
        <span aria-hidden="true">&#10005;</span>
      </button>
    </div>
  );
};

export default NoteFindBar;
