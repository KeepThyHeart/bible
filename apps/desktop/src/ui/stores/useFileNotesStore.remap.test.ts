import { describe, it, expect, beforeEach } from 'vitest';
import { useFileNotesStore } from './useFileNotesStore';

const recent = (path: string, title: string) => ({ path, title, openedAt: '2026-01-01T00:00:00Z' });

describe('Recent notes follow rename, move and delete (soak 0161)', () => {
  beforeEach(() => {
    useFileNotesStore.setState({
      recentFiles: [recent('Sermons/Grace.bn', 'Grace'), recent('Sermons/Sub/Deep.bn', 'Deep'), recent('Other.bn', 'Other')],
    });
  });

  it('a renamed file keeps its slot with the new path and title', () => {
    useFileNotesStore.getState().remapRecentPaths('Sermons/Grace.bn', 'Sermons/Mercy.bn', 'Mercy');
    expect(useFileNotesStore.getState().recentFiles.map(f => [f.path, f.title])).toEqual([
      ['Sermons/Mercy.bn', 'Mercy'], ['Sermons/Sub/Deep.bn', 'Deep'], ['Other.bn', 'Other'],
    ]);
  });

  it('a renamed folder re-points the notes inside it', () => {
    useFileNotesStore.getState().remapRecentPaths('Sermons', 'Talks');
    expect(useFileNotesStore.getState().recentFiles.map(f => f.path)).toEqual(['Talks/Grace.bn', 'Talks/Sub/Deep.bn', 'Other.bn']);
  });

  it('deleting a folder drops entries under it, and a prefix lookalike survives', () => {
    useFileNotesStore.setState({ recentFiles: [...useFileNotesStore.getState().recentFiles, recent('SermonsExtra/x.bn', 'x')] });
    useFileNotesStore.getState().removeRecentUnder('Sermons');
    expect(useFileNotesStore.getState().recentFiles.map(f => f.path)).toEqual(['Other.bn', 'SermonsExtra/x.bn']);
  });
});
