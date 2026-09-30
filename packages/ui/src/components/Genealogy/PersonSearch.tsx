/** PersonSearch: a text input with a listbox of matching people (`graph.search()`); picking fires `onPick(personId)`. */
import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { GenealogyGraph } from '@bible/core/browser';
import { fill } from './util';

export interface PersonSearchLabels {
  label: string;
  placeholder: string;
  listbox: string;
  noResults: string;
  /** Live-region text; `{count}` is replaced. */
  count: string;
  /** Beside a name to tell namesakes apart; `{tribe}` is replaced. */
  tribeOf: string;
}

export const DEFAULT_PERSON_SEARCH_LABELS: PersonSearchLabels = {
  label: 'Find a person',
  placeholder: 'Search by name',
  listbox: 'Matching people',
  noResults: 'No matching people',
  count: '{count} matches',
  tribeOf: 'Tribe of {tribe}',
};

export interface PersonSearchProps {
  graph: GenealogyGraph;
  onPick: (personId: string) => void;
  labels?: Partial<PersonSearchLabels>;
  /** Shown beside a name to tell namesakes apart. */
  formatVerse?: (verseId: number) => string;
  limit?: number;
  id?: string;
}

/** Short descriptor from a person's notes ("Son of Israel"): the sentence after the era, if any. */
function gloss(notes: string | undefined): string | undefined {
  const last = notes?.split('. ').slice(1).join('. ').trim();
  return last && last.length <= 40 ? last : undefined;
}

export function PersonSearch({ graph, onPick, labels: overrides, formatVerse, limit = 8, id: idProp }: PersonSearchProps) {
  const labels = { ...DEFAULT_PERSON_SEARCH_LABELS, ...overrides };
  const auto = useId();
  const id = idProp ?? auto;
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => graph.search(text, limit), [graph, text, limit]);
  const showList = open && text.trim() !== '';
  // People who share a name in this list get a short descriptor, so no two rows read alike.
  const nameCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of results) m.set(p.name, (m.get(p.name) ?? 0) + 1);
    return m;
  }, [results]);

  const pick = (personId: string) => {
    onPick(personId);
    setOpen(false);
    setText('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { setOpen(true); setActive((a) => Math.min(a + 1, results.length - 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setActive((a) => Math.max(a - 1, 0)); e.preventDefault(); }
    else if (e.key === 'Enter' && showList && results[active]) { pick(results[active].id); e.preventDefault(); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className="kth-genealogy-search">
      <input
        type="text"
        role="combobox"
        className="kth-input kth-genealogy-search__input"
        aria-label={labels.label}
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={showList && results[active] ? `${id}-opt-${active}` : undefined}
        placeholder={labels.placeholder}
        value={text}
        onChange={(e) => { setText(e.currentTarget.value); setActive(0); setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      <ul id={`${id}-listbox`} role="listbox" aria-label={labels.listbox} className="kth-genealogy-search__list" hidden={!showList}>
        {results.map((p, i) => (
          <li
            key={p.id}
            id={`${id}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            className="kth-genealogy-search__option"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(p.id)}
          >
            {p.name}
            {(() => {
              const hint = [
                (nameCount.get(p.name) ?? 0) > 1 ? gloss(p.notes) : undefined,
                p.tribe ? fill(labels.tribeOf, { tribe: p.tribe.charAt(0).toUpperCase() + p.tribe.slice(1) }) : undefined,
                formatVerse && p.firstRef !== undefined ? formatVerse(p.firstRef) : undefined,
              ].filter(Boolean).join(' · ');
              return hint ? <span className="kth-genealogy-search__hint">{' '}{hint}</span> : null;
            })()}
          </li>
        ))}
        {showList && results.length === 0 && <li className="kth-genealogy-search__none" role="presentation">{labels.noResults}</li>}
      </ul>
      <p className="kth-visually-hidden" role="status">{showList ? fill(labels.count, { count: results.length }) : ''}</p>
    </div>
  );
}
