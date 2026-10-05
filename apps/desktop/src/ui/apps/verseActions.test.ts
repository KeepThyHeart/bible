import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { useExtensionUiStore } from '../extensions/extensionUiStore';
import { verseActions } from './appHost';
import { installExtensionVerseActions, mapExtensionOrder } from './verseActions';
import { withVerseMenuContext } from '../components/VerseContextMenu';

const execute = vi.fn().mockResolvedValue(undefined);
const services = { registry: { execute } as never };
const label = 'Memorize';

function add(extensionId: string, item: Record<string, unknown>, target = 'verse') {
  useExtensionUiStore.getState().addContextMenuItem(extensionId, target as never, { id: 'a', label, command: 'ext.x.cmd', ...item } as never);
}

describe('installExtensionVerseActions', () => {
  let dispose: () => void;
  beforeEach(() => {
    dispose?.();
    useExtensionUiStore.setState({ contextMenuItems: [] });
    execute.mockClear();
    dispose = installExtensionVerseActions(services);
  });
  afterAll(() => dispose?.());

  it('mirrors verse rows into the registry; other targets and rows with a when are skipped', () => {
    add('ext-x', { id: 'a' });
    add('ext-x', { id: 'b' }, 'editor');
    add('ext-x', { id: 'c', when: 'foo' });
    expect(verseActions.list().map((a) => a.id)).toEqual(['ext-x.a']);
    expect(verseActions.get('ext-x.a')).toMatchObject({ group: 'extension', title: { extensionId: 'ext-x', text: label } });
  });

  it('replaces on re-registration (a new item object) and disposes when the row vanishes', () => {
    add('ext-x', { id: 'a', label: 'One' });
    add('ext-x', { id: 'a', label: 'Two' });
    expect(verseActions.list()).toHaveLength(1);
    expect((verseActions.get('ext-x.a')!.title as { text: string }).text).toBe('Two');
    useExtensionUiStore.getState().removeContextMenuItem('ext-x', 'a');
    expect(verseActions.list()).toHaveLength(0);
  });

  it('disposes every row of an owner when its contributions are removed', () => {
    add('ext-x', { id: 'a' });
    add('ext-x', { id: 'b' });
    useExtensionUiStore.setState({ contextMenuItems: [] });
    expect(verseActions.list()).toHaveLength(0);
  });

  it('runs the command with args carrying `verse` exactly as withVerseMenuContext did', async () => {
    add('ext-x', { id: 'a', args: { mode: 'm' } });
    await verseActions.run('ext-x.a', { verseId: 1001001, verseIds: [1001001, 1001002], module: 'ASV', surface: 'reader' });
    const v = (id: number) => ({ verse_id: id, book_number: 1, chapter: 1, verse: 1, text: '' });
    expect(execute).toHaveBeenCalledWith('ext.x.cmd', withVerseMenuContext({ mode: 'm' }, [v(1001001), v(1001002)], 'ASV'));
  });

  it('maps order into the extension band and breaks ties by id, not registration order', () => {
    expect(mapExtensionOrder(undefined)).toBe(100);
    expect(mapExtensionOrder(-5)).toBe(100);
    expect(mapExtensionOrder(5000)).toBe(1000);
    add('ext-x', { id: 'z', order: 3 });
    add('ext-x', { id: 'a', order: 3 });
    const ids = verseActions.getSnapshot().map((e) => e.item.id);
    expect(ids).toEqual(['ext-x.a', 'ext-x.z']);
  });
});
