import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../contexts/useI18n';
import { useLookUpStore } from '../../stores/useLookUpStore';
import { LookUpResults } from './LookUpResults';

const DEBOUNCE_MS = 250;

/**
 * The Dictionary Overview's main search: a word (or a Strong's number) looked up in every installed
 * dictionary at once, with the matching entries listed underneath, grouped by dictionary.
 *
 * The box shares `useLookUpStore` with the verse menu's "Look up", so that path lands here with the
 * word already in the box. Typing is debounced; Enter searches straight away; clearing the box clears
 * the results.
 */
const DictionaryWordSearch: React.FC<{
  onOpenEntry: (abbreviation: string, name: string, key: string) => void;
}> = ({ onOpenEntry }) => {
  const { t } = useI18n();
  const queryText = useLookUpStore(s => s.query?.text ?? '');
  const [value, setValue] = useState(queryText);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // A look-up started elsewhere (the verse menu) shows its word here.
  useEffect(() => {
    setValue(current => (current.trim() === queryText ? current : queryText));
  }, [queryText]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const search = (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const store = useLookUpStore.getState(); // allow-getstate: event handler
    if (!text.trim()) store.clear();
    else void store.run({ text });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    if (!next.trim()) {
      search('');
      return;
    }
    timer.current = setTimeout(() => search(next), DEBOUNCE_MS);
  };

  const placeholder = t('libraryHome.wordSearchPlaceholder');

  return (
    <div className="mb-4">
      <form
        role="search"
        onSubmit={e => { e.preventDefault(); search(value); }}
        className="relative mb-3"
      >
        <svg
          className="pointer-events-none absolute inset-y-0 start-3 my-auto w-5 h-5 text-text-secondary"
          aria-hidden="true"
          focusable="false"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="7" strokeWidth={2} />
          <path strokeLinecap="round" strokeWidth={2} d="M20 20l-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full ps-10 pe-3 py-2 text-lg rounded border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
          data-testid="library-word-search"
        />
      </form>
      <LookUpResults onOpenEntry={onOpenEntry} />
    </div>
  );
};

export default DictionaryWordSearch;
