/**
 * The Bible toolbar's "Keywords" control (task 0065): a toggle for keyword marks in this pane's tab with a count
 * badge, and a popover holding the shared `KeywordLegend` (row toggles, prev/next through occurrences,
 * suggestions), the colour-safe setting and the entry points to the mark editor and "Manage sets".
 *
 * Clicking the button turns marks on; once on, it (and the chevron at any time) opens the popover. The legend's
 * own switch turns marks off, as does Ctrl+Shift+K.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { KeywordLegend } from '@bible/ui';
import { suggestKeywords, type ChapterInput } from '@bible/core/browser';
import { useI18n } from '../../contexts/useI18n';
import { useOverlayDismissal } from '../../hooks/useOverlayDismissal';
import { useKeywordMarkStore } from '../../stores/useKeywordMarkStore';
import { DEFAULT_TAB_STATE, legendRowsFor } from '../../extensions/keywordMarkLayer';
import { stepIndex, scrollToOccurrence } from '../../utils/keywordStep';
import { suggestionToWord, toSharedRows, toSharedSuggestions } from '../../utils/keywordLegendModel';
import ToolbarPopover from '../bible/ToolbarPopover';
import { KeywordEditorDialog, ManageSetsDialog, type EditTarget } from './KeywordDialogs';
import { legendLabels } from './keywordLabels';

const KeywordsButton: React.FC<{ tabId: string }> = ({ tabId }) => {
  const { t } = useI18n();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [managing, setManaging] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const stepped = useRef(new Map<string, number>());

  const tab = useKeywordMarkStore((s) => s.tabs[tabId]) ?? DEFAULT_TAB_STATE;
  const marks = useKeywordMarkStore((s) => s.chapters[tabId]);
  const colorSafe = useKeywordMarkStore((s) => s.colorSafe);
  const setColorSafe = useKeywordMarkStore((s) => s.setColorSafe);
  const toggleTab = useKeywordMarkStore((s) => s.toggleTab);
  const toggleMark = useKeywordMarkStore((s) => s.toggleMark);
  const addMarkFromWord = useKeywordMarkStore((s) => s.addMarkFromWord);

  const storeRows = useMemo(() => (marks ? legendRowsFor(marks, tab.hiddenMarkIds) : []), [marks, tab.hiddenMarkIds]);
  const rows = useMemo(() => {
    const setCount = new Set(storeRows.map((r) => r.setId)).size;
    return toSharedRows(storeRows, { showSetNames: setCount > 1, hasInterlinear: !!marks?.input.interlinear });
  }, [storeRows, marks]);
  const total = useMemo(() => storeRows.reduce((n, r) => n + (r.hidden ? 0 : r.hits), 0), [storeRows]);

  const rawSuggestions = useMemo(
    () => (open && marks ? suggestKeywords(marks.input as ChapterInput) : []),
    [open, marks],
  );
  const suggestions = useMemo(() => toSharedSuggestions(rawSuggestions), [rawSuggestions]);

  const close = useCallback(() => setOpen(false), []);
  useOverlayDismissal(open, close);

  const step = (markId: string, dir: 'next' | 'prev') => {
    const occ = useKeywordMarkStore.getState().getOccurrences(tabId, markId); // allow-getstate: event handler
    if (occ.length === 0) return;
    const idx = stepIndex(stepped.current.get(markId) ?? -1, occ.length, dir);
    stepped.current.set(markId, idx);
    const root = anchorRef.current?.closest('[data-testid="bible-pane"]') ?? document;
    scrollToOccurrence(root, occ[idx]);
    const label = rows.find((r) => r.id === markId)?.label ?? '';
    setAnnouncement(t('keywords.legend.announce', { label, verse: occ[idx].verseId % 1000, index: idx + 1, total: occ.length }));
  };

  const editRow = (markId: string) => {
    const row = storeRows.find((r) => r.markId === markId);
    if (row) { setOpen(false); setEditing({ mark: row.mark, setId: row.setId }); }
  };

  const acceptSuggestion = (key: string) => {
    const s = suggestionToWord(rawSuggestions[Number(key)]);
    if (s) void addMarkFromWord(tabId, s.word, s.kind);
  };

  const label = t('keywords.toolbar.button');
  const cell = { borderInlineEnd: '2px solid var(--theme-border-primary)', borderRadius: 0 } as const;

  return (
    <>
      <div className="relative flex items-stretch" ref={anchorRef} data-testid="keywords-control" style={cell}>
        <button
          type="button"
          onClick={() => (tab.enabled ? setOpen((o) => !o) : toggleTab(tabId))}
          onMouseDown={(e) => e.stopPropagation()}
          className={`flex items-center text-xs font-medium transition-colors ${
            tab.enabled ? 'bg-accent text-text-on-accent' : 'text-text-secondary hover:bg-background-active'
          }`}
          style={{ borderRadius: 0, padding: '8px 10px' }}
          title={t('keywords.toolbar.title')}
          aria-pressed={tab.enabled}
          aria-haspopup={tab.enabled ? 'dialog' : undefined}
          aria-expanded={tab.enabled ? open : undefined}
          data-testid="keywords-toggle"
        >
          {label}
          {tab.enabled && (
            <span
              className="ms-1.5 px-1.5 rounded-full text-[10px] leading-4 bg-surface-primary text-text-primary"
              data-testid="keywords-count"
              aria-label={t('keywords.toolbar.count', { count: total })}
            >
              {total}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          onMouseDown={(e) => e.stopPropagation()}
          className={`flex items-center px-1 transition-colors ${
            tab.enabled ? 'bg-accent text-text-on-accent' : 'text-text-secondary hover:bg-background-active'
          }`}
          style={{ borderRadius: 0 }}
          title={t('keywords.toolbar.options')}
          aria-label={t('keywords.toolbar.options')}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid="keywords-options"
        >
          <svg className="w-3 h-3" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {open && (
          <ToolbarPopover
            anchorRef={anchorRef}
            align="start"
            minWidth={300}
            role="dialog"
            aria-label={t('keywords.legend.title')}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="p-2" data-testid="keywords-popover">
              <KeywordLegend
                enabled={tab.enabled}
                onToggleEnabled={() => toggleTab(tabId)}
                rows={rows}
                onToggleRow={(id) => toggleMark(tabId, id)}
                onStep={step}
                onAdd={() => { setOpen(false); setEditing({}); }}
                onEdit={editRow}
                onManageSets={() => { setOpen(false); setManaging(true); }}
                suggestions={suggestions}
                onAcceptSuggestion={acceptSuggestion}
                interlinearNote={marks?.result.needsInterlinear ? t('keywords.legend.needsInterlinear') : null}
                announcement={announcement}
                labels={legendLabels(t)}
              />
              <label className="flex items-center gap-2 text-xs mt-2 px-1">
                <input type="checkbox" checked={colorSafe} onChange={(e) => setColorSafe(e.target.checked)} data-testid="keywords-color-safe" />
                {t('keywords.settings.colorSafe')}
              </label>
            </div>
          </ToolbarPopover>
        )}
      </div>
      {editing && <KeywordEditorDialog tabId={tabId} target={editing} onClose={() => setEditing(null)} />}
      {managing && <ManageSetsDialog onClose={() => setManaging(false)} />}
    </>
  );
};

export default KeywordsButton;
