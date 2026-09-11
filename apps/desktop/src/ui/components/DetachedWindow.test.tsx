/**
 * Unit tests for the detached-window root component.
 *
 * This is the renderer half of pop-out: the main process creates a
 * `BrowserWindow`, waits for `ready-to-show`, then pushes a single
 * `initialize-pane` IPC message carrying `{ paneType, windowId, componentName,
 * state }`. Everything a popped-out pane will ever know arrives in that one
 * message, so the failure modes here are:
 *
 *  - the message never arrives (window parks on the loading screen forever),
 *  - `componentName` names something `COMPONENT_MAP` doesn't have (error screen),
 *  - the state is dropped instead of being spread onto the pane.
 *
 * All the real pane components are mocked out - they mount stores, hit IPC and
 * are covered by their own suites. What is under test is the dispatch: which
 * component gets chosen, and what props it receives.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Capture the props each stub pane is rendered with so we can assert the
// handover payload actually reaches the component.
const paneProps: Record<string, any> = {};

function stubPane(name: string) {
  return {
    default: (props: any) => {
      paneProps[name] = props;
      return <div data-testid={`pane-${name}`} />;
    },
  };
}

vi.mock('./BiblePane', () => stubPane('BiblePane'));
vi.mock('./CommentaryPane', () => stubPane('CommentaryPane'));
vi.mock('./BookPane', () => stubPane('BookPane'));
vi.mock('./DictionaryPane', () => stubPane('DictionaryPane'));
vi.mock('./notes/UserNotesPane', () => stubPane('UserNotesPane'));
vi.mock('./notes/tabs/PrayerTab', () => stubPane('PrayerTab'));
vi.mock('./StudyPane', () => stubPane('StudyPane'));
vi.mock('./TopicsPane', () => stubPane('TopicsPane'));
// Extension panels detach into this one component - every contributed panel
// type maps to it, and `extensionId` / `panelTypeId` arrive in the payload.
// Stubbed like the rest: the real one calls `useI18n`, which needs the
// `ContextProvider` that `detached.tsx` wraps the tree in, and mounts an
// `ext-ui://` iframe that has no meaning in jsdom.
vi.mock('./extensions/ExtensionPanelHost', () => stubPane('ExtensionPanelHost'));

// Only the singleton is stubbed: `enT` imports the real `I18nService` class
// from this same module, so replacing the whole module would break it.
vi.mock('../services/I18nService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/I18nService')>()),
  i18nService: { t: (key: string, params?: Record<string, unknown>) => enT(key, params) },
}));

import { DetachedWindow, COMPONENT_MAP, type InitializePanePayload } from './DetachedWindow';
// paneConfig is a dependency-free data module (no `electron` import), so the
// renderer side can import the main-process side directly and check the two
// halves of the pop-out contract against each other for real.
import { PANE_CONFIGS } from '../../../electron/config/paneConfig';
import { enT } from '../testing/enCatalog';

/** The `initialize-pane` callback registered by the component under test. */
let initializeCallback: ((data: InitializePanePayload) => void) | null = null;

/** Deliver an `initialize-pane` message the way the main process would. */
function sendInitializePane(payload: Partial<InitializePanePayload>) {
  act(() => {
    initializeCallback!({
      paneType: 'bible',
      windowId: 'detached-1',
      componentName: 'BiblePane',
      ...payload,
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  initializeCallback = null;
  for (const key of Object.keys(paneProps)) delete paneProps[key];

  (window as any).electron = {
    ...(window as any).electron,
    window: {
      onInitializePane: vi.fn((cb: (data: InitializePanePayload) => void) => {
        initializeCallback = cb;
      }),
    },
  };
});

describe('DetachedWindow: initialization handshake', () => {
  it('registers an initialize-pane listener on mount', () => {
    render(<DetachedWindow />);
    expect((window as any).electron.window.onInitializePane).toHaveBeenCalledTimes(1);
  });

  it('shows the loading screen until the IPC message arrives', () => {
    render(<DetachedWindow />);
    expect(screen.getByTestId('detached-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('detached-pane')).not.toBeInTheDocument();
  });

  it('replaces the loading screen once the message arrives', () => {
    render(<DetachedWindow />);
    sendInitializePane({});
    expect(screen.queryByTestId('detached-loading')).not.toBeInTheDocument();
    expect(screen.getByTestId('detached-pane')).toBeInTheDocument();
  });

  it('renders the pane even when no state was handed over', () => {
    // The loading gate must not require a truthy `state`: Books, Dictionary
    // and un-navigated Notes panes all pop out with `{}` (or nothing) for
    // state, so requiring one would leave those windows sitting on "Loading
    // pane..." forever - and the E2E smoke assertion (body text > 20 chars)
    // would pass anyway, because the loading copy is itself 43 characters.
    render(<DetachedWindow />);
    sendInitializePane({ paneType: 'book', componentName: 'BookPane', state: undefined });

    expect(screen.queryByTestId('detached-loading')).not.toBeInTheDocument();
    expect(screen.getByTestId('pane-BookPane')).toBeInTheDocument();
  });

  it('tags the wrapper with the pane type for E2E assertions', () => {
    render(<DetachedWindow />);
    sendInitializePane({ paneType: 'commentary', componentName: 'CommentaryPane' });
    expect(screen.getByTestId('detached-pane')).toHaveAttribute('data-pane-type', 'commentary');
  });
});

describe('DetachedWindow: component resolution', () => {
  it.each(Object.keys(COMPONENT_MAP))('resolves %s from the component map', (componentName) => {
    render(<DetachedWindow />);
    sendInitializePane({ componentName });
    expect(screen.getByTestId(`pane-${componentName}`)).toBeInTheDocument();
    expect(screen.queryByTestId('detached-error')).not.toBeInTheDocument();
  });

  it('falls back to BiblePane when componentName is missing', () => {
    render(<DetachedWindow />);
    sendInitializePane({ componentName: undefined });
    expect(screen.getByTestId('pane-BiblePane')).toBeInTheDocument();
  });

  it('shows the error screen for an unknown component instead of crashing', () => {
    render(<DetachedWindow />);
    sendInitializePane({ componentName: 'NotARealPane' });
    expect(screen.getByTestId('detached-error')).toBeInTheDocument();
    expect(screen.getByText(enT('detachedWindow.unknownComponent', { v1: 'NotARealPane' }))).toBeInTheDocument();
  });

  it('can resolve the component named by every pane type in paneConfig', () => {
    // The main process picks `componentName` straight out of paneConfig and
    // ships it over IPC. If the two drift, the user gets the "Unknown
    // component" error screen - which is what breaks popping out a Study or
    // Topics pane.
    for (const [paneType, config] of Object.entries(PANE_CONFIGS)) {
      expect(COMPONENT_MAP[config.component], `${paneType} -> ${config.component}`).toBeDefined();
    }
  });

  it('renders a real pane for every paneConfig entry, end to end', () => {
    for (const [paneType, config] of Object.entries(PANE_CONFIGS)) {
      const { unmount } = render(<DetachedWindow />);
      sendInitializePane({ paneType, componentName: config.component });

      expect(screen.queryByTestId('detached-error'), paneType).not.toBeInTheDocument();
      expect(screen.getByTestId(`pane-${config.component}`), paneType).toBeInTheDocument();
      unmount();
    }
  });
});

describe('DetachedWindow: state handover', () => {
  it('spreads the handed-over state onto the pane as props', () => {
    render(<DetachedWindow />);
    sendInitializePane({
      componentName: 'BiblePane',
      state: { openTabs: [{ abbreviation: 'KJV' }], currentBook: 43, currentChapter: 3 },
    });

    expect(paneProps.BiblePane.openTabs).toEqual([{ abbreviation: 'KJV' }]);
    expect(paneProps.BiblePane.currentBook).toBe(43);
    expect(paneProps.BiblePane.currentChapter).toBe(3);
  });

  it('always marks the pane as detached', () => {
    render(<DetachedWindow />);
    sendInitializePane({ componentName: 'CommentaryPane', state: {} });
    expect(paneProps.CommentaryPane.isDetached).toBe(true);
  });

  it('passes the windowId through so the pane can talk back to main', () => {
    render(<DetachedWindow />);
    sendInitializePane({ componentName: 'BiblePane', windowId: 'detached-7' });
    expect(paneProps.BiblePane.windowId).toBe('detached-7');
  });

  it('does not let handed-over state override isDetached', () => {
    // `state` is spread before `isDetached`, so a stale `isDetached: false` in a
    // serialized payload must not win - the pane would then try to read the
    // empty store in this window instead of seeding from props.
    render(<DetachedWindow />);
    sendInitializePane({ componentName: 'BiblePane', state: { isDetached: false } });
    expect(paneProps.BiblePane.isDetached).toBe(true);
  });

  it('tolerates a non-object state without crashing', () => {
    render(<DetachedWindow />);
    sendInitializePane({ componentName: 'BiblePane', state: 'unexpected' as unknown as object });
    expect(screen.getByTestId('pane-BiblePane')).toBeInTheDocument();
    expect(paneProps.BiblePane.isDetached).toBe(true);
  });

  it('re-renders when a second initialize-pane message arrives', () => {
    render(<DetachedWindow />);
    sendInitializePane({ componentName: 'BiblePane', state: { currentChapter: 3 } });
    expect(paneProps.BiblePane.currentChapter).toBe(3);

    sendInitializePane({ componentName: 'CommentaryPane', state: { currentVerseId: 43003016 } });
    expect(screen.getByTestId('pane-CommentaryPane')).toBeInTheDocument();
    expect(paneProps.CommentaryPane.currentVerseId).toBe(43003016);
  });
});
