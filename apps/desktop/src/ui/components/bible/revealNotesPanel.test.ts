/**
 * The note indicator beside a verse promises "click to view the note". It only
 * kept that promise if a Notes pane happened to already be open and in front -
 * and the first-run layout opens none, so for most users the icon did nothing.
 * These tests pin the reveal step that was missing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('dockview-react', () => ({}));

import { useLayoutStore, type LayoutPanel } from '../../stores/useLayoutStore';
import { revealNotesPanel } from './revealNotesPanel';

function panel(panelId: string, contentType: LayoutPanel['contentType']): [string, LayoutPanel] {
  return [panelId, { panelId, contentType, displayName: panelId }];
}

/** A dockview stub whose panels each report a group named after themselves. */
function fakeDockview(setActive: () => void) {
  return {
    getPanel: (id: string) => ({
      group: `group_of_${id}`,
      api: { setActive },
    }),
  } as never;
}

describe('revealNotesPanel', () => {
  beforeEach(() => {
    useLayoutStore.setState({
      panels: new Map(),
      dockviewApi: null,
      addPanel: vi.fn().mockReturnValue('notes_new'),
    });
  });

  it('brings an existing Notes pane to the front instead of adding a second one', () => {
    const setActive = vi.fn();
    const addPanel = vi.fn();
    useLayoutStore.setState({
      panels: new Map([panel('notes_1', 'notes'), panel('commentary_default', 'commentary')]),
      dockviewApi: fakeDockview(setActive),
      addPanel,
    });

    const result = revealNotesPanel();

    expect(result).toBe('notes_1');
    // A Notes pane sitting behind the Commentary tab is as good as absent to
    // someone who just clicked a note icon, so it has to be activated.
    expect(setActive).toHaveBeenCalledTimes(1);
    expect(addPanel).not.toHaveBeenCalled();
  });

  it('adds a Notes pane to the right-hand group when the layout has none', () => {
    const addPanel = vi.fn().mockReturnValue('notes_new');
    useLayoutStore.setState({
      panels: new Map([panel('bible_default', 'bible'), panel('study_default', 'study')]),
      dockviewApi: fakeDockview(vi.fn()),
      addPanel,
    });

    const result = revealNotesPanel();

    expect(result).toBe('notes_new');
    expect(addPanel).toHaveBeenCalledTimes(1);
    const [contentType, contentKey, title, position] = addPanel.mock.calls[0];
    expect(contentType).toBe('notes');
    expect(contentKey).toBeUndefined();
    expect(title).toBe('Notes');
    // Joining the Study/Commentary group keeps the passage the reader is
    // looking at at its current width rather than splitting it again.
    expect(position).toEqual({ referenceGroup: 'group_of_study_default', direction: 'within' });
  });

  it('lets dockview place the pane when there is no right-hand group', () => {
    const addPanel = vi.fn().mockReturnValue('notes_new');
    useLayoutStore.setState({
      panels: new Map([panel('bible_default', 'bible')]),
      dockviewApi: fakeDockview(vi.fn()),
      addPanel,
    });

    revealNotesPanel();

    expect(addPanel.mock.calls[0][3]).toBeUndefined();
  });

  it('reports failure rather than throwing when dockview is not ready', () => {
    useLayoutStore.setState({
      panels: new Map(),
      dockviewApi: null,
      addPanel: vi.fn().mockReturnValue(null),
    });

    expect(revealNotesPanel()).toBeNull();
  });
});
