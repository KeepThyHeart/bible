/**
 * The Study pane's "Weights, measures and money" section as a `studyPaneSections` slot entry:
 * adapts the slot props to `MeasuresStudySection`. The collapse key `measures` is persisted.
 */
import React from 'react';
import type { StudyPaneSectionProps } from '../host/slots';
import MeasuresStudySection from './MeasuresStudySection';

export const MeasuresStudyPaneSection: React.FC<StudyPaneSectionProps> = ({ verseId, sectionsCollapsed, toggleSection }) => (
  <MeasuresStudySection
    verseId={verseId}
    collapsed={!!sectionsCollapsed['measures']}
    onToggle={() => toggleSection('measures')}
  />
);
