/**
 * Contract tests for right-pane ids.
 *
 * `rightPaneMode` is a bare string reachable from three directions — the tab
 * strip, the `pane:show` event (verse context menu, plugins), and the restored
 * session. Nothing in the type system stops any of them naming a pane the shell
 * cannot render; DesktopApp only notices at runtime, and falls back to 'study'.
 *
 * That fallback is a safety net, not a contract. These tests are the contract:
 * a caller that names an unrenderable pane fails here rather than silently
 * landing the reader somewhere they did not ask for.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RENDERABLE_PANE_MODES, RESTORABLE_PANE_MODES, commentaryStore } from './commentaryStore';
import { CONTEXT_MENU_TARGETS } from '../hooks/useContextMenu';
import { eventBus } from '../events/eventBus';

const RENDERABLE: readonly string[] = RENDERABLE_PANE_MODES;

describe('pane mode sets', () => {
  it('every restorable mode is also renderable', () => {
    for (const mode of RESTORABLE_PANE_MODES) {
      expect(RENDERABLE).toContain(mode);
    }
  });

  it('excludes search, whose tab exists only while a search is open', () => {
    expect(RENDERABLE).not.toContain('search');
    expect(RESTORABLE_PANE_MODES.has('search')).toBe(false);
  });

  it('names each pane once', () => {
    expect(new Set(RENDERABLE).size).toBe(RENDERABLE.length);
  });
});

describe('context menu targets', () => {
  it('every action opens a pane the shell can render', () => {
    for (const [action, target] of Object.entries(CONTEXT_MENU_TARGETS)) {
      expect(RENDERABLE, `action '${action}' targets an unrenderable pane`).toContain(target.paneId);
    }
  });

  it('offers exactly one navigating action, to the study pane', () => {
    // The menu used to carry an entry per study target — Cross-References,
    // Topics, Commentary, Dictionary — and each of them opened a pane still
    // showing the previously selected verse. They collapsed into 'study',
    // which selects the right-clicked verse first. The other panes stay
    // reachable from the tab strip; they are no longer right-click targets.
    expect(Object.keys(CONTEXT_MENU_TARGETS)).toEqual(['study']);
    expect(CONTEXT_MENU_TARGETS.study?.paneId).toBe('study');
  });

  it('only ever asks for a mobile view that exists', () => {
    const views = ['home', 'bible', 'search', 'study', 'commentary'];
    for (const [action, target] of Object.entries(CONTEXT_MENU_TARGETS)) {
      expect(views, `action '${action}' targets an unknown mobile view`).toContain(target.mobileView);
    }
  });
});

/**
 * `commentaryStore` subscribes to the bus inside `init()`, so the wiring only
 * exists once a provider has been handed over. The stub answers every call with
 * an empty result — these tests are about which pane is shown, not what it
 * contains.
 */
function initStore(): void {
  localStorage.clear();
  commentaryStore.init({
    getCommentary: async () => ({ entries: [] }) as never,
    getAllCommentary: async () => ({ modules: [] }) as never,
    getAvailability: async () => ({ modules: [] }) as never,
    getHomeData: async () => ({ modules: [], chapterModules: [] }) as never,
    getModuleInfo: async () => null,
    getChapterOverview: async () => ({}) as never,
  });
}

describe('pane:show', () => {
  beforeEach(() => {
    initStore();
    commentaryStore.setRightPaneMode('commentary');
  });

  it.each(RENDERABLE_PANE_MODES)('puts the pane into %s mode', (mode) => {
    eventBus.emit('pane:show', { paneId: mode });
    expect(commentaryStore.rightPaneMode).toBe(mode);
  });

  it('carries every context-menu target through to rightPaneMode', () => {
    // The end-to-end version of this — that the pane visibly changes — is
    // e2e/tests/ui-e2e.spec.ts, which is the only level that also proves the
    // document-level contextmenu listener is wired up.
    for (const target of Object.values(CONTEXT_MENU_TARGETS)) {
      commentaryStore.setRightPaneMode('commentary');
      eventBus.emit('pane:show', { paneId: target.paneId });
      expect(commentaryStore.rightPaneMode).toBe(target.paneId);
    }
  });
});
