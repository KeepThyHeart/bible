import type { WordStudyFamilyMember } from '@bible/core/browser';
import { mergeWordStudyLabels } from './wordStudyLabels';
import type { WordStudyLabels } from './wordStudyLabels';

export interface WordFamilyListProps {
  members: WordStudyFamilyMember[];
  onSelect: (strongs: string) => void;
  labels?: Partial<WordStudyLabels>;
}

export function WordFamilyList({ members, onSelect, labels }: WordFamilyListProps) {
  const l = mergeWordStudyLabels(labels);
  const relation = {
    self: l.relationSelf,
    parent: l.relationParent,
    child: l.relationChild,
    related: l.relationRelated,
  };
  return (
    <section className="kth-ws-family" aria-label={l.familyTitle}>
      <h3 className="kth-ws-section-title">{l.familyTitle}</h3>
      <ul className="kth-ws-family__list">
        {members.map((m) => {
          const isSelf = m.relationship === 'self';
          const body = (
            <>
              <span className="kth-ws-family__badge">{relation[m.relationship]}</span>
              {m.word && <span className="kth-ws-family__word">{m.word}</span>}
              {m.translit && <span className="kth-ws-family__translit">{m.translit}</span>}
              <span className="kth-ws-family__strongs">{m.strongs}</span>
              <span className="kth-ws-family__gloss">{m.gloss}</span>
              {m.occurrences !== undefined && <span className="kth-ws-family__count">{m.occurrences}</span>}
            </>
          );
          return (
            <li key={m.strongs} className="kth-ws-family__item">
              {isSelf ? (
                <div className="kth-ws-family__row kth-ws-family__row--self" aria-current="true">{body}</div>
              ) : (
                <button type="button" className="kth-ws-family__row" onClick={() => onSelect(m.strongs)}>{body}</button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
