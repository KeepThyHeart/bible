import { describe, it, expect, vi } from 'vitest';
import { saveChapterNote, type ChapterSaveDeps } from './chapterNoteSave';
import type { BnFile } from '../../../services/fileNotesAPI';

const note = (content = 'old'): BnFile => ({ bn: 1, type: 'verse_note', title: 'Romans 8:1', tags: [], passages: [], created: 'c', updated: 't1', content, metadata: {} });
const mk = () => {
  const deps = {
    saveWithBaseline: vi.fn(async () => 't2'),
    saveVerseNote: vi.fn(async (_id: number, html: string) => ({ note: { ...note(html), updated: 't9' }, relativePath: 'Verse Notes/Romans/8/1.bn' })),
  };
  return deps as typeof deps & ChapterSaveDeps;
};
const base = { verseId: 45008001, folderName: 'Romans' };

describe('saveChapterNote', () => {
  it('existing file: saves against its baseline and returns the new updated', async () => {
    const d = mk();
    const r = await saveChapterNote({ ...base, note: note(), relativePath: 'Verse Notes/Romans/8/1.bn', origin: 'o' }, '<p>new</p>', d);
    expect(d.saveWithBaseline).toHaveBeenCalledWith('Verse Notes/Romans/8/1.bn', expect.objectContaining({ content: '<p>new</p>', updated: 't1' }), 'o');
    expect(r?.note.updated).toBe('t2');
    expect(d.saveVerseNote).not.toHaveBeenCalled();
  });
  it('existing file cleared to empty is still saved', async () => {
    const d = mk();
    const r = await saveChapterNote({ ...base, note: note(), relativePath: 'p.bn' }, '<p></p>', d);
    expect(d.saveWithBaseline).toHaveBeenCalledTimes(1);
    expect(r).not.toBeNull();
  });
  it('no file and content: creates through saveVerseNote with the folder name', async () => {
    const d = mk();
    const r = await saveChapterNote({ ...base, note: null, relativePath: null, origin: 'o' }, '<p>hi</p>', d);
    expect(d.saveVerseNote).toHaveBeenCalledWith(45008001, '<p>hi</p>', undefined, 'Romans', 'o');
    expect(r?.relativePath).toBe('Verse Notes/Romans/8/1.bn');
  });
  it('no file and no content: writes nothing', async () => {
    const d = mk();
    expect(await saveChapterNote({ ...base, note: null, relativePath: null }, '<p><br></p>', d)).toBeNull();
    expect(d.saveVerseNote).not.toHaveBeenCalled();
    expect(d.saveWithBaseline).not.toHaveBeenCalled();
  });
});
