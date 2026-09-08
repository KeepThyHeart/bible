import { useEffect, useState } from 'react';
import { bookAPI } from '../../../services/electronAPI';
import { BookSection, BookTab } from '../../../stores/useBookStore';
import { NavSectionInfo } from '../sectionTreeRenderers';

/**
 * Loads next/previous section info for the active tab whenever the current section changes.
 */
export function useNavSectionInfo(activeTab: BookTab | undefined, currentSection: BookSection | null) {
  const [nextSectionInfo, setNextSectionInfo] = useState<NavSectionInfo | null>(null);
  const [prevSectionInfo, setPrevSectionInfo] = useState<NavSectionInfo | null>(null);

  useEffect(() => {
    const loadNavSections = async () => {
      if (!activeTab || !currentSection?.section_id) {
        setNextSectionInfo(null);
        setPrevSectionInfo(null);
        return;
      }

      try {
        const next = await bookAPI.getNextSection(activeTab.abbreviation, currentSection.section_id);
        if (next && next.section_id) {
          setNextSectionInfo({
            section_id: next.section_id,
            title: next.title,
            section_number: next.section_number,
          });
        } else {
          setNextSectionInfo(null);
        }

        const prev = await bookAPI.getPreviousSection(activeTab.abbreviation, currentSection.section_id);
        if (prev && prev.section_id) {
          setPrevSectionInfo({
            section_id: prev.section_id,
            title: prev.title,
            section_number: prev.section_number,
          });
        } else {
          setPrevSectionInfo(null);
        }
      } catch (error) {
        console.error('Error loading navigation sections:', error);
        setNextSectionInfo(null);
        setPrevSectionInfo(null);
      }
    };

    loadNavSections();
  }, [activeTab, currentSection]);

  return { nextSectionInfo, prevSectionInfo };
}
