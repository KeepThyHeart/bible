import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { DocSection } from './types';

export interface ScrollSpyApi {
  activeSectionId: string;
  setActiveSectionId: (id: string) => void;
  sectionRefs: RefObject<Record<string, HTMLDivElement | null>>;
  scrollToSection: (sectionId: string) => void;
}

/**
 * Tracks which documentation section is currently in view as the user scrolls,
 * and provides a click-scroll helper that temporarily suppresses the observer
 * so smooth-scrolling doesn't fight the active-tab state.
 */
export function useScrollSpy(
  containerRef: RefObject<HTMLElement | null>,
  sections: DocSection[],
  initialId: string,
): ScrollSpyApi {
  const [activeSectionId, setActiveSectionId] = useState<string>(initialId);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const isClickScrolling = useRef(false);
  const clickScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToSection = useCallback((sectionId: string) => {
    isClickScrolling.current = true;
    if (clickScrollTimer.current) {
      clearTimeout(clickScrollTimer.current);
    }
    setActiveSectionId(sectionId);
    const el = sectionRefs.current[sectionId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    clickScrollTimer.current = setTimeout(() => {
      isClickScrolling.current = false;
    }, 800);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (isClickScrolling.current) return;

      const containerRect = container.getBoundingClientRect();
      let currentId = sections[0]?.id ?? '';

      for (const section of sections) {
        const el = sectionRefs.current[section.id];
        if (el) {
          const elRect = el.getBoundingClientRect();
          if (elRect.top - containerRect.top <= 80) {
            currentId = section.id;
          }
        }
      }

      if (currentId !== activeSectionId) {
        setActiveSectionId(currentId);
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [containerRef, sections, activeSectionId]);

  return { activeSectionId, setActiveSectionId, sectionRefs, scrollToSection };
}
