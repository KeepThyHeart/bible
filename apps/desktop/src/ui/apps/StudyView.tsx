import React from 'react';
import DockviewLayout from '../components/DockviewLayout';
import { useStudyLayoutBoot } from './useStudyLayoutBoot';

/** The Study app: the dockview workbench. Reads its boot values from `useStudyLayoutBoot`. */
export const StudyView: React.FC = () => {
  const savedLayout = useStudyLayoutBoot((s) => s.savedLayout);
  const layoutDecided = useStudyLayoutBoot((s) => s.layoutDecided);
  return <DockviewLayout savedLayout={savedLayout} layoutDecided={layoutDecided} />;
};

export default StudyView;
