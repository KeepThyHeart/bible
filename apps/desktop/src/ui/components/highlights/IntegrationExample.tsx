/**
 * Integration Example: Using Highlights in Bible Pane
 *
 * This example demonstrates how to integrate the highlights system
 * into a Bible reading pane component.
 */

import React, { useState, useEffect } from 'react';
import { useI18n } from '../../contexts/useI18n';
import { UserTextMarkup, UserTextMarkupRepository, HighlightColor, MarkupType, UnderlineStyle } from '@bible/core';
import { useHighlightStore } from '../../stores/useHighlightStore';
import { HighlightedVerse, HighlightSelector, HighlightMenu } from './index';

// Import the CSS
import '../../styles/highlights.css';

interface BiblePaneWithHighlightsProps {
  moduleId: number;
  verseData: Array<{ verseId: number; verseHTML: string }>;
  userDbPath: string;
}

/**
 * Example: Bible Pane with Highlights Support
 */
export const BiblePaneWithHighlights: React.FC<BiblePaneWithHighlightsProps> = ({
  moduleId,
  verseData,
  userDbPath
}) => {
  const { t } = useI18n();
  const [repository, _setRepository] = useState<UserTextMarkupRepository | null>(null);
  const [menuState, setMenuState] = useState<{
    visible: boolean;
    position: { x: number; y: number };
    selection: {
      startVerseId: number;
      startWordIndex: number;
      endVerseId?: number;
      endWordIndex?: number;
    } | null;
  }>({
    visible: false,
    position: { x: 0, y: 0 },
    selection: null
  });

  const { loadHighlightsForVerseRange, createHighlight } = useHighlightStore();

  // Initialize repository and load highlights
  useEffect(() => {
    // In a real app, you'd get SqliteProvider from your database service
    // const userDb = new SqliteProvider(userDbPath);
    // const repo = new UserTextMarkupRepository(userDb);
    // setRepository(repo);

    // Load highlights for the current verse range
    if (verseData.length > 0 && repository) {
      const startVerseId = verseData[0].verseId;
      const endVerseId = verseData[verseData.length - 1].verseId;
      loadHighlightsForVerseRange(moduleId, startVerseId, endVerseId, repository);
    }
  }, [moduleId, verseData, userDbPath, repository, loadHighlightsForVerseRange]);

  // Handle when user completes a selection
  const handleShowMenu = (
    position: { x: number; y: number },
    selection: {
      startVerseId: number;
      startWordIndex: number;
      endVerseId?: number;
      endWordIndex?: number;
    }
  ) => {
    setMenuState({
      visible: true,
      position,
      selection
    });
  };

  // Handle when user selects a color/style from the menu
  const handleSelectHighlight = async (
    color: HighlightColor,
    markupType: MarkupType,
    underlineStyle?: UnderlineStyle,
    underlineColor?: HighlightColor
  ) => {
    if (!menuState.selection || !repository) return;

    const { startVerseId, startWordIndex, endVerseId, endWordIndex } = menuState.selection;

    // Create the highlight
    const markup = new UserTextMarkup({
      moduleId,
      verseIdStart: startVerseId,
      verseIdEnd: endVerseId,
      textStart: startWordIndex,
      textEnd: endWordIndex,
      color,
      metadata: {
        markupType,
        underlineStyle,
        underlineColor,
        version: 1
      }
    });

    try {
      await createHighlight(markup, repository);
    } catch (error) {
      console.error('Failed to create highlight:', error);
    }

    // Close the menu
    setMenuState({
      visible: false,
      position: { x: 0, y: 0 },
      selection: null
    });
  };

  // Handle menu cancel
  const handleCancelMenu = () => {
    setMenuState({
      visible: false,
      position: { x: 0, y: 0 },
      selection: null
    });
  };

  if (!repository) {
    return <div>{t('integrationExample.loadingHighlights')}</div>;
  }

  return (
    <div className="bible-pane">
      {/* Wrap content in HighlightSelector to enable drag-to-highlight */}
      <HighlightSelector
        moduleId={moduleId}
        repository={repository}
        onShowMenu={handleShowMenu}
      >
        <div className="verse-list">
          {verseData.map(({ verseId, verseHTML }) => (
            <div key={verseId} className="verse-container">
              <span className="verse-number">{verseId % 1000}</span>
              <HighlightedVerse
                verseId={verseId}
                verseHTML={verseHTML}
                moduleId={moduleId}
              />
            </div>
          ))}
        </div>
      </HighlightSelector>

      {/* Show menu when user completes a selection */}
      {menuState.visible && (
        <HighlightMenu
          position={menuState.position}
          onSelectHighlight={handleSelectHighlight}
          onCancel={handleCancelMenu}
        />
      )}
    </div>
  );
};

/**
 * Usage Example:
 *
 * ```tsx
 * import { BiblePaneWithHighlights } from './components/highlights/IntegrationExample';
 *
 * function MyBibleApp() {
 *   const verseData = [
 *     { verseId: 43003016, verseHTML: 'For God so loved the world...' },
 *     { verseId: 43003017, verseHTML: 'For God sent not his Son...' },
 *   ];
 *
 *   return (
 *     <BiblePaneWithHighlights
 *       moduleId={1}  // KJV module ID
 *       verseData={verseData}
 *       userDbPath="/path/to/user_john.db"
 *     />
 *   );
 * }
 * ```
 *
 * Key Integration Steps:
 *
 * 1. **Import CSS**: Add `import './styles/highlights.css'` to your main App.tsx
 *
 * 2. **Initialize Repository**: Create a UserTextMarkupRepository with your SqliteProvider
 *    ```typescript
 *    const userDb = new SqliteProvider('data/users/user_john.db');
 *    const repository = new UserTextMarkupRepository(userDb);
 *    ```
 *
 * 3. **Load Highlights**: When chapter changes, load highlights for the visible verse range
 *    ```typescript
 *    loadHighlightsForVerseRange(moduleId, startVerseId, endVerseId, repository);
 *    ```
 *
 * 4. **Wrap in HighlightSelector**: Wrap your Bible content with HighlightSelector
 *    to enable drag-to-highlight interaction
 *
 * 5. **Use HighlightedVerse**: Replace plain verse rendering with HighlightedVerse
 *    component which applies highlight markup
 *
 * 6. **Show Menu**: When user completes selection, show HighlightMenu for color/style
 *
 * 7. **Create Highlight**: On menu selection, create the highlight via the store
 *
 * Advanced Features:
 *
 * - **Right-click on Highlight**: Show context menu to edit or delete
 * - **Keyboard Shortcuts**: Add Ctrl+H to apply last used color
 * - **Highlight Note Linking**: Set noteId when creating highlight
 * - **Filter by Color**: Use repository.getByColor() to find all yellow highlights
 * - **Export Highlights**: Get all highlights and export to JSON/CSV
 */
