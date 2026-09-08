import React, { useState, useRef, useEffect, useCallback } from 'react';
import TopicListItem from './TopicListItem';
import { useI18n } from '../../contexts/useI18n';
import { unwrap } from '../../services/ipcResult';

interface TopicSearchResult {
  topic_id: number;
  name: string;
  parent_path?: string;
  source_abbreviation: string;
  source_name: string;
  verse_count: number;
}

interface TopicSearchBarProps {
  onSelectTopic: (abbreviation: string, topicId: number) => void;
  placeholder?: string;
  sources?: string[];
}

/**
 * Debounced search bar for topical indexes with dropdown results.
 * Used in both Study Pane (opens Topics Pane) and Topics Pane (navigates internally).
 */
const TopicSearchBar: React.FC<TopicSearchBarProps> = ({
  onSelectTopic,
  placeholder,
  sources,
}) => {
  const { t } = useI18n();
  const effectivePlaceholder = placeholder ?? t('topicSearchBar.placeholder');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TopicSearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const search = useCallback(async (searchQuery: string) => {
    if (searchQuery.trim().length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    try {
      const res = await unwrap(window.electron.topical.searchTopics(searchQuery, sources));
      setResults(res);
      setIsOpen(res.length > 0);
      setSelectedIndex(0);
    } catch (error) {
      console.error('Topic search error:', error);
    }
  }, [sources]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 200);
  };

  const handleSelect = (result: TopicSearchResult) => {
    onSelectTopic(result.source_abbreviation, result.topic_id);
    setQuery('');
    setResults([]);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = () => setIsOpen(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  return (
    <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        data-testid="topic-search-input"
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (results.length > 0) setIsOpen(true); }}
        placeholder={effectivePlaceholder}
        style={{
          width: '100%',
          padding: '6px 10px',
          fontSize: '13px',
          border: '1px solid var(--theme-border-primary)',
          borderRadius: '6px',
          backgroundColor: 'var(--theme-bg-primary)',
          color: 'var(--theme-text-primary)',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
      {isOpen && results.length > 0 && (
        <div data-testid="topic-search-results" style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          zIndex: 100,
          maxHeight: '250px',
          overflowY: 'auto',
          backgroundColor: 'var(--theme-bg-primary)',
          border: '1px solid var(--theme-border-primary)',
          borderRadius: '6px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          marginTop: '2px',
        }}>
          {results.map((result, index) => (
            <div
              key={`${result.source_abbreviation}-${result.topic_id}`}
              style={{
                backgroundColor: index === selectedIndex ? 'var(--theme-tab-bg-hover, rgba(0,0,0,0.05))' : 'transparent',
              }}
            >
              <TopicListItem
                topicName={result.name}
                parentPath={result.parent_path}
                source={result.source_name}
                verseCount={result.verse_count}
                onClick={() => handleSelect(result)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TopicSearchBar;
