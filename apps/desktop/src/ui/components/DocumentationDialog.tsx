/**
 * DocumentationDialog.tsx - Help > Documentation viewer
 *
 * Thin composition over the pieces in `./DocumentationDialog/`:
 *   - content.ts - sections + blocks (data)
 *   - Header.tsx - title, search input, close button
 *   - Sidebar.tsx - section nav + collapse toggle
 *   - ContentView.tsx - scrollable content area + footer
 *   - BlockRenderer.tsx - renders individual DocBlocks
 *   - useDocSearch - filters sections by query
 *   - useScrollSpy - tracks active section and smooth-scrolls on click
 *   - useDialogKeyboard - Escape / click-outside / Ctrl+F focus
 *
 * APP.TSX INTEGRATION:
 * Add the following to App.tsx to wire this dialog to the Help > Documentation menu item:
 *
 * 1. Import the component:
 *    import DocumentationDialog from './components/DocumentationDialog';
 *
 * 2. Add state:
 *    const [showDocumentation, setShowDocumentation] = useState(false);
 *
 * 3. In the useEffect that handles menu events, add:
 *    window.electron.menu.onDocumentation(() => setShowDocumentation(true));
 *
 * 4. Add the dialog component in JSX (after other dialogs):
 *    {showDocumentation && (
 *      <DocumentationDialog onClose={() => setShowDocumentation(false)} />
 *    )}
 */

import React, { useMemo, useRef, useState } from 'react';
import { useI18n } from '../contexts/useI18n';
import { buildDocumentation } from './DocumentationDialog/content';
import { DocumentationHeader } from './DocumentationDialog/Header';
import { DocumentationSidebar } from './DocumentationDialog/Sidebar';
import { DocumentationContentView } from './DocumentationDialog/ContentView';
import { useDocSearch } from './DocumentationDialog/useDocSearch';
import { useScrollSpy } from './DocumentationDialog/useScrollSpy';
import { useDialogKeyboard } from './DocumentationDialog/useDialogKeyboard';

export interface DocumentationDialogProps {
  onClose: () => void;
}

const DocumentationDialog: React.FC<DocumentationDialogProps> = ({ onClose }) => {
  const { t } = useI18n();
  const DOCUMENTATION = useMemo(() => buildDocumentation(t), [t]);

  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredSections = useDocSearch(DOCUMENTATION, searchQuery);

  const initialSectionId = DOCUMENTATION[0].id;
  const { activeSectionId, sectionRefs, scrollToSection } = useScrollSpy(
    contentRef,
    filteredSections,
    initialSectionId,
  );

  useDialogKeyboard(dialogRef, searchInputRef, onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="documentation-dialog-title"
        className="bg-surface rounded-lg shadow-2xl flex flex-col overflow-hidden"
        style={{ width: '900px', maxWidth: 'calc(100vw - 64px)', height: 'calc(100vh - 80px)' }}
      >
        <DocumentationHeader
          t={t}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchInputRef={searchInputRef}
          onClose={onClose}
        />

        <div className="flex flex-1 min-h-0">
          <DocumentationSidebar
            t={t}
            sections={filteredSections}
            totalSectionCount={DOCUMENTATION.length}
            activeSectionId={activeSectionId}
            searchQuery={searchQuery}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={setSidebarCollapsed}
            onSelectSection={scrollToSection}
          />

          <DocumentationContentView
            t={t}
            sections={filteredSections}
            contentRef={contentRef}
            sectionRefs={sectionRefs}
            searchQuery={searchQuery}
            onClearSearch={() => setSearchQuery('')}
          />
        </div>
      </div>
    </div>
  );
};

export default DocumentationDialog;
