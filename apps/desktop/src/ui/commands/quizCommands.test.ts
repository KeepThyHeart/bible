import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  panels: new Map<string, { currentBook: number; currentChapter: number }>(),
  layout: {
    panels: new Map<string, { contentType: string }>(),
    dockviewApi: null as null | { getPanel: (id: string) => { api: { setActive: () => void } } },
    addPanel: vi.fn(),
  },
  setActive: vi.fn(),
}));

vi.mock('../stores/useBibleStore', () => ({
  DEFAULT_PANEL_ID: 'default',
  useBibleStore: { getState: () => ({ panels: h.panels }) },
}));
vi.mock('../stores/useLayoutStore', () => ({ useLayoutStore: { getState: () => h.layout } }));

import { registerQuizCommands } from './quizCommands';
import { useQuizLaunchStore } from '../stores/useQuizLaunchStore';
import type { CommandRegistration } from '../types/Command';
import enCommands from '../../../locales/en/commands.json';

function commands(): Record<string, CommandRegistration> {
  const regs: CommandRegistration[] = [];
  registerQuizCommands({ register: (c: CommandRegistration) => { regs.push(c); return { dispose: vi.fn() }; } } as never);
  return Object.fromEntries(regs.map((c) => [c.id, c]));
}

describe('quiz commands', () => {
  beforeEach(() => {
    h.panels = new Map([['default', { currentBook: 41, currentChapter: 4 }]]);
    h.layout.panels = new Map();
    h.layout.dockviewApi = null;
    h.layout.addPanel.mockReset();
    h.setActive.mockReset();
    useQuizLaunchStore.setState({ pending: null });
  });

  it('has English titles and categories', () => {
    for (const id of ['quiz.open', 'quiz.thisChapter']) {
      expect((enCommands as Record<string, string>)[id]).toBeTruthy();
      expect((enCommands as Record<string, string>)[`${id}.category`]).toBeTruthy();
    }
  });

  it('quiz.open adds a panel, or focuses the existing one', async () => {
    const { 'quiz.open': open } = commands();
    await open.handler({} as never);
    expect(h.layout.addPanel).toHaveBeenCalledWith('quiz', undefined, expect.any(String));

    h.layout.addPanel.mockReset();
    h.layout.panels = new Map([['p9', { contentType: 'quiz' }]]);
    h.layout.dockviewApi = { getPanel: () => ({ api: { setActive: h.setActive } }) };
    await open.handler({} as never);
    expect(h.setActive).toHaveBeenCalled();
    expect(h.layout.addPanel).not.toHaveBeenCalled();
  });

  it('quiz.thisChapter queues a request for the primary panel chapter and opens the pane', async () => {
    const { 'quiz.thisChapter': thisChapter } = commands();
    await thisChapter.handler({} as never);
    expect(useQuizLaunchStore.getState().pending).toEqual({
      passages: [{ start: 41004001, end: 41004999 }],
      label: 'Mark 4',
    });
    expect(h.layout.addPanel).toHaveBeenCalledWith('quiz', undefined, expect.any(String));
  });
});
