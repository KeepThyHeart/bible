import { describe, it, expect, vi, beforeEach } from 'vitest';

const study = vi.hoisted(() => vi.fn());
vi.mock('./useWordStudyStore', () => ({ useWordStudyStore: { getState: () => ({ study }) } }));

import { useLayoutStore } from '../../stores/useLayoutStore';
import { revealWordStudyPanel } from './revealWordStudyPanel';
import { singleSelectedWord } from '../../components/VerseContextMenu';

describe('revealWordStudyPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLayoutStore.setState({ panels: new Map(), dockviewApi: null });
  });

  it('creates a pane when there is none and studies the subject in it', () => {
    const addPanel = vi.fn().mockReturnValue('wordStudy_9');
    useLayoutStore.setState({ addPanel } as never);
    const id = revealWordStudyPanel({ kind: 'strongs', strongs: 'G25' });
    expect(id).toBe('wordStudy_9');
    expect(addPanel.mock.calls[0][0]).toBe('wordStudy');
    expect(addPanel.mock.calls[0][2]).toBe('Word Study');
    expect(study).toHaveBeenCalledWith('wordStudy_9', { kind: 'strongs', strongs: 'G25' });
  });

  it('reuses an existing pane and opens it without a subject', () => {
    const addPanel = vi.fn();
    useLayoutStore.setState({
      addPanel,
      panels: new Map([['wordStudy_1', { panelId: 'wordStudy_1', contentType: 'wordStudy', displayName: 'Word Study' }]]),
    } as never);
    expect(revealWordStudyPanel()).toBe('wordStudy_1');
    expect(addPanel).not.toHaveBeenCalled();
    expect(study).not.toHaveBeenCalled();
  });
});

describe('singleSelectedWord', () => {
  it('accepts one word and rejects everything else', () => {
    expect(singleSelectedWord(' loved ')).toBe('loved');
    expect(singleSelectedWord("God's")).toBe("God's");
    expect(singleSelectedWord('agapáō')).toBe('agapáō');
    expect(singleSelectedWord('two words')).toBeNull();
    expect(singleSelectedWord('3:16')).toBeNull();
    expect(singleSelectedWord('')).toBeNull();
    expect(singleSelectedWord(null)).toBeNull();
  });
});
