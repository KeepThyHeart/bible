import { useId } from 'react';
import type { ReactNode } from 'react';
import type {
  WordGroup,
  WordKeyCandidate,
  WordOccurrenceItem,
  WordOccurrencePage,
  WordStudyOverview,
} from '@bible/core/browser';
import { fillTemplate, mergeWordStudyLabels } from './wordStudyLabels';
import type { WordStudyLabels } from './wordStudyLabels';
import { WordStudyHeader } from './WordStudyHeader';
import { RenderingChart } from './RenderingChart';
import { BookDistributionStrip } from './BookDistributionStrip';
import { WordFamilyList } from './WordFamilyList';
import { SemanticRangeSummary } from './SemanticRangeSummary';
import { OccurrenceRow } from './OccurrenceRow';
import { WordGroupEditor } from './WordGroupEditor';

export interface WordStudyFilters {
  book?: number;
  form?: string;
}

export interface WordStudyViewProps {
  overview: WordStudyOverview | null;
  loading?: boolean;
  error?: string;
  occurrences: WordOccurrencePage | null;
  occurrencesLoading?: boolean;
  filters: WordStudyFilters;
  onFiltersChange: (filters: WordStudyFilters) => void;
  renderingMode?: 'head' | 'phrase';
  onRenderingModeChange?: (mode: 'head' | 'phrase') => void;
  onModuleChange: (module: string) => void;
  onSelectStrongs: (strongs: string) => void;
  onOpenOccurrence: (item: WordOccurrenceItem) => void;
  onLoadMore: () => void;
  formatBook: (book: number) => string;
  formatReference: (verseId: number) => string;
  renderVerse?: (item: WordOccurrenceItem) => ReactNode;
  onSearchAll?: () => void;
  onOpenInDictionary?: () => void;
  /** Lookup box text (controlled). */
  query: string;
  onQueryChange: (query: string) => void;
  onSubmitQuery: (query: string) => void;
  candidates?: WordKeyCandidate[];
  onPickCandidate?: (strongs: string) => void;
  groups: WordGroup[];
  onOpenGroup: (group: WordGroup) => void;
  onSaveGroup: (group: WordGroup) => void;
  onDeleteGroup: (id: string) => void;
  /** The group in the editor; null or undefined hides it. A group with an empty id is a new one. */
  editingGroup?: WordGroup | null;
  onEditGroup: (group: WordGroup | null) => void;
  labels?: Partial<WordStudyLabels>;
}

export function WordStudyView(props: WordStudyViewProps) {
  const {
    overview, loading, error, occurrences, occurrencesLoading, filters, onFiltersChange, renderingMode, onRenderingModeChange,
    onModuleChange, onSelectStrongs, onOpenOccurrence, onLoadMore, formatBook, formatReference, renderVerse, onSearchAll,
    onOpenInDictionary, query, onQueryChange, onSubmitQuery, candidates, onPickCandidate, groups, onOpenGroup, onSaveGroup,
    onDeleteGroup, editingGroup, onEditGroup,
  } = props;
  const l = mergeWordStudyLabels(props.labels);
  const uid = useId();
  const inputId = `${uid}-q`;
  const isStrongs = overview?.subject.kind === 'strongs';
  const hasFilter = filters.book !== undefined || filters.form !== undefined;
  const items = occurrences?.items ?? [];

  return (
    <div className="kth-ws">
      <form
        className="kth-ws-lookup"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) onSubmitQuery(query.trim());
        }}
      >
        <label className="kth-visually-hidden" htmlFor={inputId}>{l.lookupLabel}</label>
        <input id={inputId} className="kth-input" type="text" value={query} placeholder={l.lookupPlaceholder} onChange={(e) => onQueryChange(e.currentTarget.value)} />
        <button type="submit" className="kth-btn kth-btn--primary">{l.lookupSubmit}</button>
      </form>

      {candidates && candidates.length > 0 && (
        <section className="kth-ws-candidates" aria-label={l.candidatesTitle}>
          <h3 className="kth-ws-section-title">{l.candidatesTitle}</h3>
          <ul className="kth-ws-candidates__list">
            {candidates.map((c) => (
              <li key={c.strongs}>
                <button type="button" className="kth-ws-family__row" onClick={() => onPickCandidate?.(c.strongs)}>
                  <span className="kth-ws-family__strongs">{c.strongs}</span>
                  {c.word && <span className="kth-ws-family__word">{c.word}</span>}
                  {c.translit && <span className="kth-ws-family__translit">{c.translit}</span>}
                  <span className="kth-ws-family__gloss">{c.gloss}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="kth-ws-groups" aria-label={l.groupsTitle}>
        <div className="kth-ws-section-head">
          <h3 className="kth-ws-section-title">{l.groupsTitle}</h3>
          <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm" onClick={() => onEditGroup({ id: '', label: '', terms: [] })}>{l.newGroup}</button>
        </div>
        {groups.length > 0 && (
          <ul className="kth-ws-groups__list">
            {groups.map((g) => (
              <li key={g.id} className="kth-ws-groups__item">
                <button type="button" className="kth-ws-chip kth-ws-chip--button" onClick={() => onOpenGroup(g)}>{g.label}</button>
                <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm" aria-label={fillTemplate(l.editGroupNamed, { label: g.label })} title={fillTemplate(l.editGroupNamed, { label: g.label })} onClick={() => onEditGroup(g)}>...</button>
              </li>
            ))}
          </ul>
        )}
        {editingGroup && (
          <WordGroupEditor
            key={editingGroup.id || 'new'}
            group={editingGroup}
            onSave={onSaveGroup}
            onCancel={() => onEditGroup(null)}
            onDelete={onDeleteGroup}
            labels={props.labels}
          />
        )}
      </section>

      {error && <p className="kth-ws-notice kth-ws-notice--error" role="alert">{error}</p>}
      {loading && <p className="kth-ws-status" role="status">{l.loading}</p>}

      {overview && (
        <>
          <WordStudyHeader overview={overview} onModuleChange={onModuleChange} onSearchAll={onSearchAll} onOpenInDictionary={onOpenInDictionary} labels={props.labels} id={`${uid}-h`} />
          {overview.forms.length > 0 && (
            <RenderingChart
              groups={overview.forms}
              title={isStrongs ? l.renderingsTitle : l.formsTitle}
              selectedKey={filters.form}
              onSelect={(form) => onFiltersChange({ ...filters, form })}
              mode={renderingMode}
              onModeChange={isStrongs ? onRenderingModeChange : undefined}
              labels={props.labels}
            />
          )}
          {Object.keys(overview.bookCounts).length > 0 && (
            <BookDistributionStrip
              bookCounts={overview.bookCounts}
              selectedBook={filters.book}
              onSelect={(book) => onFiltersChange({ ...filters, book })}
              formatBook={formatBook}
              labels={props.labels}
            />
          )}
          {overview.semanticRange && <SemanticRangeSummary data={overview.semanticRange} lexiconRenderings={overview.entry?.lexiconRenderings} labels={props.labels} />}
          {overview.family.length > 0 && <WordFamilyList members={overview.family} onSelect={onSelectStrongs} labels={props.labels} />}
        </>
      )}

      {(overview || occurrences) && (
        <section className="kth-ws-occurrences" aria-label={l.occurrencesTitle} aria-busy={occurrencesLoading ? true : undefined}>
          <div className="kth-ws-section-head">
            <h3 className="kth-ws-section-title">{l.occurrencesTitle}</h3>
            {occurrences && <span className="kth-ws-occurrences__count">{fillTemplate(l.showing, { shown: items.length, total: occurrences.total })}</span>}
            {hasFilter && <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm" onClick={() => onFiltersChange({})}>{l.clearFilter}</button>}
          </div>
          {occurrences && items.length === 0 && !occurrencesLoading && <p className="kth-ws-status">{l.noOccurrences}</p>}
          <ul className="kth-ws-occurrences__list">
            {items.map((it, i) => (
              <li key={`${it.verseId}-${it.start}-${i}`}>
                <OccurrenceRow item={it} reference={formatReference(it.verseId)} onOpen={onOpenOccurrence} renderVerse={renderVerse} />
              </li>
            ))}
          </ul>
          {occurrencesLoading && <p className="kth-ws-status" role="status">{l.loading}</p>}
          {occurrences && items.length < occurrences.total && (
            <button type="button" className="kth-btn kth-ws-occurrences__more" disabled={occurrencesLoading} onClick={onLoadMore}>{l.loadMore}</button>
          )}
        </section>
      )}
    </div>
  );
}
