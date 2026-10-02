import type { WordStudyOverview } from '@bible/core/browser';
import { fillTemplate, mergeWordStudyLabels } from './wordStudyLabels';
import type { WordStudyLabels } from './wordStudyLabels';

export interface WordStudyHeaderProps {
  overview: WordStudyOverview;
  onModuleChange: (module: string) => void;
  onSearchAll?: () => void;
  onOpenInDictionary?: () => void;
  labels?: Partial<WordStudyLabels>;
  id?: string;
}

export function WordStudyHeader({ overview, onModuleChange, onSearchAll, onOpenInDictionary, labels, id = 'kth-ws' }: WordStudyHeaderProps) {
  const l = mergeWordStudyLabels(labels);
  const { subject, entry, modules, totals, notice } = overview;
  const noticeText =
    notice === 'no-module' ? l.noticeNoModule : notice === 'not-tagged' ? l.noticeNotTagged : notice === 'no-occurrences' ? l.noticeNoOccurrences : '';
  const selectId = `${id}-module`;
  return (
    <header className="kth-ws-header">
      <h2 className="kth-ws-header__title">{subject.label}</h2>
      {subject.kind === 'strongs' && (
        <p className="kth-ws-header__original">
          {entry?.word && <span className="kth-ws-header__word" lang={subject.language === 'Hebrew' ? 'he' : 'grc'}>{entry.word}</span>}
          {entry?.translit && <span className="kth-ws-header__translit">{entry.translit}</span>}
          {entry?.pronunciation && <span className="kth-ws-header__pron">{entry.pronunciation}</span>}
          {subject.strongs && <span className="kth-ws-header__strongs">{fillTemplate(l.strongsNumber, { strongs: subject.strongs })}</span>}
        </p>
      )}
      {noticeText ? (
        <p className="kth-ws-notice" role="status">{noticeText}</p>
      ) : (
        <p className="kth-ws-header__totals">{fillTemplate(l.totals, { occurrences: totals.occurrences, verses: totals.verses })}</p>
      )}
      <div className="kth-ws-header__actions">
        {modules.length > 0 && (
          <>
            <label className="kth-ws-header__module-label" htmlFor={selectId}>{l.moduleLabel}</label>
            <select
              id={selectId}
              className="kth-input kth-ws-header__module"
              value={overview.module ?? ''}
              onChange={(e) => onModuleChange(e.currentTarget.value)}
            >
              {overview.module === undefined && <option value="" disabled>-</option>}
              {modules.map((m) => (
                <option key={m.module} value={m.module}>{m.module}{m.name && m.name !== m.module ? ` - ${m.name}` : ''}</option>
              ))}
            </select>
          </>
        )}
        {onSearchAll && <button type="button" className="kth-btn kth-btn--sm" onClick={onSearchAll}>{l.searchAll}</button>}
        {onOpenInDictionary && <button type="button" className="kth-btn kth-btn--sm" onClick={onOpenInDictionary}>{l.openInDictionary}</button>}
      </div>
    </header>
  );
}
