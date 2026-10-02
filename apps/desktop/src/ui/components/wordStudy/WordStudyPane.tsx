import React, { useCallback, useEffect, useMemo } from 'react';
import { WordStudyView } from '@bible/ui';
import type { WordStudyFilters } from '@bible/ui';
import type { WordGroup, WordOccurrenceItem } from '@bible/core/browser';
import { useI18n } from '../../contexts/useI18n';
import { DEFAULT_PANEL_ID } from '../../stores/helpers/panelStateHelpers';
import { useWordStudyStore, createDefaultWordStudyPanelState } from '../../stores/useWordStudyStore';
import { navigateToVerseInPrimary } from '../../stores/crossStoreBridge';
import { useSearchStore } from '../../stores/useSearchStore';
import { localizedBookNames } from '../../constants/bibleBooks';
import { openStrongsInDictionary } from '../bible/openStrongsInDictionary';
import { VerseIdHelper } from '@bible/core';
import { useWordStudyLabels } from './useWordStudyLabels';

interface WordStudyPaneProps {
  panelId?: string;
}

/** The Word Study pane: `WordStudyView` wired to `useWordStudyStore` for one dockview panel. */
const WordStudyPane: React.FC<WordStudyPaneProps> = ({ panelId: propPanelId }) => {
  const panelId = propPanelId ?? DEFAULT_PANEL_ID;
  const { t, localizer } = useI18n();
  const labels = useWordStudyLabels();
  const bookNames = useMemo(() => localizedBookNames(localizer), [localizer]);

  const stored = useWordStudyStore((s) => s.panels.get(panelId));
  const ps = useMemo(() => stored ?? createDefaultWordStudyPanelState(), [stored]);
  const savedGroups = useWordStudyStore((s) => s.savedGroups);

  useEffect(() => {
    const store = useWordStudyStore.getState(); // allow-getstate: mount effect - actions are stable
    store.initPanel(panelId);
    void store.loadGroups();
    void store.ensureLoaded(panelId);
    return () => useWordStudyStore.getState().detachPanel(panelId); // allow-getstate: unmount cleanup
  }, [panelId]);

  // Bound actions: `getState()` inside handlers keeps their identity stable.
  const act = useMemo(() => ({
    setQuery: (q: string) => useWordStudyStore.getState().setQuery(panelId, q),
    submit: (q: string) => void useWordStudyStore.getState().submitQuery(panelId, q),
    pick: (strongs: string) => void useWordStudyStore.getState().pickCandidate(panelId, strongs),
    setModule: (m: string) => void useWordStudyStore.getState().setModule(panelId, m),
    setMode: (m: 'head' | 'phrase') => void useWordStudyStore.getState().setRenderingMode(panelId, m),
    setFilters: (f: WordStudyFilters) => void useWordStudyStore.getState().setFilters(panelId, f),
    loadMore: () => void useWordStudyStore.getState().loadMore(panelId),
    back: () => void useWordStudyStore.getState().goBack(panelId),
    forward: () => void useWordStudyStore.getState().goForward(panelId),
    edit: (g: WordGroup | null) => useWordStudyStore.getState().setEditingGroup(panelId, g),
    save: (g: WordGroup) => void useWordStudyStore.getState().saveGroup(panelId, g),
    remove: (id: string) => void useWordStudyStore.getState().deleteGroup(panelId, id),
    openGroup: (group: WordGroup) => void useWordStudyStore.getState().study(panelId, { kind: 'group', group }),
    selectStrongs: (strongs: string) => void useWordStudyStore.getState().study(panelId, { kind: 'strongs', strongs }),
  }), [panelId]);

  const formatBook = useCallback((book: number) => bookNames[book] ?? String(book), [bookNames]);
  const formatReference = useCallback((verseId: number) => {
    const { bookNumber, chapter, verse } = VerseIdHelper.parse(verseId);
    return `${formatBook(bookNumber)} ${chapter}:${verse}`;
  }, [formatBook]);
  const openOccurrence = useCallback((item: WordOccurrenceItem) => navigateToVerseInPrimary(item.verseId), []);

  const strongs = ps.subject?.kind === 'strongs' ? ps.subject.strongs : null;
  const canGoBack = ps.trailIndex > 0;
  const canGoForward = ps.trailIndex >= 0 && ps.trailIndex < ps.trail.length - 1;

  return (
    <div className="h-full flex flex-col" data-testid="word-study-pane">
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '4px 8px', borderBottom: '1px solid var(--theme-border-primary)', flexShrink: 0 }}
      >
        <button className="control-nav-button" data-testid="word-study-back" onClick={act.back} disabled={!canGoBack} title={t('ui.paneNav.goBack')}>&lt;</button>
        <button className="control-nav-button" data-testid="word-study-forward" onClick={act.forward} disabled={!canGoForward} title={t('ui.paneNav.goForward')}>&gt;</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {!ps.subject && !ps.loading && ps.candidates.length === 0 && (
          <p className="text-text-secondary text-sm mb-2" data-testid="word-study-empty">{t('wordStudy.emptyPrompt')}</p>
        )}
        <WordStudyView
          overview={ps.overview}
          loading={ps.loading}
          error={ps.error}
          occurrences={ps.occurrences}
          occurrencesLoading={ps.occurrencesLoading}
          filters={ps.filters}
          onFiltersChange={act.setFilters}
          renderingMode={ps.options.renderingMode}
          onRenderingModeChange={act.setMode}
          onModuleChange={act.setModule}
          onSelectStrongs={act.selectStrongs}
          onOpenOccurrence={openOccurrence}
          onLoadMore={act.loadMore}
          formatBook={formatBook}
          formatReference={formatReference}
          onSearchAll={strongs ? () => { void useSearchStore.getState().searchStrongsNumber(strongs); } : undefined} // allow-getstate: event handler
          onOpenInDictionary={strongs ? () => { void openStrongsInDictionary(strongs); } : undefined}
          query={ps.query}
          onQueryChange={act.setQuery}
          onSubmitQuery={act.submit}
          candidates={ps.candidates}
          onPickCandidate={act.pick}
          groups={savedGroups}
          onOpenGroup={act.openGroup}
          onSaveGroup={act.save}
          onDeleteGroup={act.remove}
          editingGroup={ps.editingGroup}
          onEditGroup={act.edit}
          labels={labels}
        />
      </div>
    </div>
  );
};

export default WordStudyPane;
