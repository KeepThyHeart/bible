/** TimelineSearch: a combobox over the store's search; typing also dims non-matching marks. */
import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { formatSpan } from '@bible/core/browser';
import type { TimelineStore } from '@bible/core/browser';
import { useTimelineStore } from './useTimelineStore';
import type { TimelinePanelLabels } from './labels';

export interface TimelineSearchProps {
  store: TimelineStore;
  labels: Pick<TimelinePanelLabels, 'search' | 'searchResults' | 'noResults'>;
}

export function TimelineSearch({ store, labels }: TimelineSearchProps) {
  const state = useTimelineStore(store);
  const uid = useId();
  const listId = `${uid}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const query = state.query;
  // Results depend on the query and the chronology (dates), not the view.
  const results = useMemo(() => store.search(query), [store, query, state.chronologyId]);
  const showList = open && query.trim() !== '';
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));
  const optionId = (i: number) => `${uid}-opt-${i}`;

  const choose = (index: number) => {
    const hit = results[index];
    if (!hit) return;
    store.focusItem(hit.item.id);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!showList) setOpen(true);
      else setActive((activeIndex + 1) % Math.max(results.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!showList) setOpen(true);
      else setActive((activeIndex - 1 + results.length) % Math.max(results.length, 1));
    } else if (e.key === 'Enter') {
      if (showList && results.length > 0) {
        e.preventDefault();
        choose(activeIndex);
      }
    } else if (e.key === 'Escape') {
      if (showList) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    }
  };

  return (
    <div className="kth-timeline-search">
      <input
        className="kth-input"
        type="search"
        role="combobox"
        aria-label={labels.search}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results.length > 0 ? optionId(activeIndex) : undefined}
        placeholder={labels.search}
        value={query}
        onChange={(e) => {
          store.setQuery(e.currentTarget.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={labels.searchResults}
        className="kth-timeline-search__list"
        hidden={!showList}
        // Keep input focus when pressing an option.
        onMouseDown={(e) => e.preventDefault()}
      >
        {showList && results.length === 0 && (
          <li className="kth-timeline-search__empty" role="status">{labels.noResults}</li>
        )}
        {showList && results.map((r, i) => (
          <li
            key={r.item.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === activeIndex}
            className="kth-timeline-search__option"
            onClick={() => choose(i)}
          >
            <span>{r.item.title}</span>
            <span className="kth-timeline-search__date">{formatSpan(r.date.start, r.date.end, r.date.precision, r.date.circa)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
