/**
 * Clicking a Strong's number promises "open the dictionary and navigate to it".
 * Keeping that promise means bringing forward a pane that already hosts
 * dictionaries, or creating a real Dictionary pane when none does - not
 * conjuring a *Books* pane, which would leave the reader asking for a word
 * and getting a strip named after a feature they had never opened. These
 * tests pin the reveal step (mirrors revealNotesPanel.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('dockview-react', () => ({}));

import { useLayoutStore, type LayoutPanel } from '../../stores/useLayoutStore';
import { revealDictionaryPanel } from './revealDictionaryPanel';

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

describe('revealDictionaryPanel', () => {
  beforeEach(() => {
    useLayoutStore.setState({
      panels: new Map(),
      dockviewApi: null,
      addPanel: vi.fn().mockReturnValue('dictionary_new'),
    });
  });

  it('brings an existing Dictionary pane to the front instead of adding a second one', () => {
    const setActive = vi.fn();
    const addPanel = vi.fn();
    useLayoutStore.setState({
      panels: new Map([
        panel('dictionary_default', 'dictionary'),
        panel('commentary_default', 'commentary'),
      ]),
      dockviewApi: fakeDockview(setActive),
      addPanel,
    });

    const result = revealDictionaryPanel();

    expect(result).toBe('dictionary_default');
    expect(setActive).toHaveBeenCalledTimes(1);
    expect(addPanel).not.toHaveBeenCalled();
  });

  it('does not send the lookup to a Books pane — a bookshelf lists no dictionaries', () => {
    const addPanel = vi.fn().mockReturnValue('dictionary_new');
    useLayoutStore.setState({
      panels: new Map([panel('book_1', 'book'), panel('commentary_default', 'commentary')]),
      dockviewApi: fakeDockview(vi.fn()),
      addPanel,
    });

    // The two content types are segregated: a Books pane cannot host a
    // lexicon, so sending a lookup there would open as a tab nothing
    // displays; a real Dictionary pane is created instead.
    expect(revealDictionaryPanel()).toBe('dictionary_new');
    expect(addPanel).toHaveBeenCalledWith('dictionary', undefined, expect.anything(), expect.anything());
  });

  it('prefers the Dictionary pane when both are open', () => {
    useLayoutStore.setState({
      panels: new Map([panel('book_1', 'book'), panel('dictionary_default', 'dictionary')]),
      dockviewApi: fakeDockview(vi.fn()),
      addPanel: vi.fn(),
    });

    expect(revealDictionaryPanel()).toBe('dictionary_default');
  });

  it('adds a Dictionary pane to the right-hand group when the layout has none', () => {
    const addPanel = vi.fn().mockReturnValue('dictionary_new');
    useLayoutStore.setState({
      panels: new Map([panel('bible_default', 'bible'), panel('study_default', 'study')]),
      dockviewApi: fakeDockview(vi.fn()),
      addPanel,
    });

    const result = revealDictionaryPanel();

    expect(result).toBe('dictionary_new');
    expect(addPanel).toHaveBeenCalledTimes(1);
    const [contentType, contentKey, title, position] = addPanel.mock.calls[0];
    expect(contentType).toBe('dictionary');
    expect(contentKey).toBeUndefined();
    // The generic English title, so `localizePaneLabel` can translate the tab.
    expect(title).toBe('Dictionary');
    expect(position).toEqual({ referenceGroup: 'group_of_study_default', direction: 'within' });
  });

  it('lets dockview place the pane when there is no right-hand group', () => {
    const addPanel = vi.fn().mockReturnValue('dictionary_new');
    useLayoutStore.setState({
      panels: new Map([panel('bible_default', 'bible')]),
      dockviewApi: fakeDockview(vi.fn()),
      addPanel,
    });

    revealDictionaryPanel();

    expect(addPanel.mock.calls[0][3]).toBeUndefined();
  });

  it('reports failure rather than throwing when dockview is not ready', () => {
    useLayoutStore.setState({
      panels: new Map(),
      dockviewApi: null,
      addPanel: vi.fn().mockReturnValue(null),
    });

    expect(revealDictionaryPanel()).toBeNull();
  });

  it('leaves the pane where it is when the caller asks to defer activation', () => {
    const setActive = vi.fn();
    useLayoutStore.setState({
      panels: new Map([panel('dictionary_default', 'dictionary')]),
      dockviewApi: fakeDockview(setActive),
    });

    // The lookup has not run yet, so bringing the pane forward now would show
    // the reader the previous word. See `openStrongsInDictionary`.
    expect(revealDictionaryPanel({ deferActivation: true })).toBe('dictionary_default');
    expect(setActive).not.toHaveBeenCalled();
  });
});
