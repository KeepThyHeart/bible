import { useMemo } from 'react';
import { DocSection } from './types';

/** Filter documentation sections by a free-text search query. */
export function useDocSearch(sections: DocSection[], query: string): DocSection[] {
  return useMemo(() => {
    if (!query.trim()) return sections;

    const q = query.toLowerCase();
    return sections.filter((section) => {
      if (section.title.toLowerCase().includes(q)) return true;
      return section.content.some((block) => {
        if ('text' in block && block.text.toLowerCase().includes(q)) return true;
        if ('items' in block && block.items.some((item) => item.toLowerCase().includes(q)))
          return true;
        if (
          'rows' in block &&
          block.rows.some((row) => row.some((cell) => cell.toLowerCase().includes(q)))
        )
          return true;
        return false;
      });
    });
  }, [sections, query]);
}
