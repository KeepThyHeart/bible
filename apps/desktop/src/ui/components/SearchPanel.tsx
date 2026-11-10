/**
 * The `search` panel type: either one search tab (a session whose id is the
 * panel id) or the general Search tab of the right-hand pane group that holds
 * several searches as sub-tabs ("Tab in the right pane", `contentKey: 'host'`).
 */
import React from 'react';
import { SEARCH_HOST_CONTENT_KEY } from '../stores/useLayoutStore';
import SearchResultsPane from './SearchResultsPane';
import SearchHostPane from './SearchHostPane';

interface SearchPanelProps {
  panelId?: string;
  contentKey?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dockviewPanelApi?: any;
}

const SearchPanel: React.FC<SearchPanelProps> = ({ panelId, contentKey, dockviewPanelApi }) => {
  if (contentKey === SEARCH_HOST_CONTENT_KEY && panelId) {
    return <SearchHostPane panelId={panelId} dockviewPanelApi={dockviewPanelApi} />;
  }
  return <SearchResultsPane panelId={panelId} dockviewPanelApi={dockviewPanelApi} />;
};

export default SearchPanel;
