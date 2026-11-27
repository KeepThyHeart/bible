import { describe, expect, it } from 'vitest';
import { MemoryAssetCache } from '../AssetCache';
import { PronunciationStore } from './pronunciationStore';

const LEX = { format: 'kth-pron-lexicon/2', locale: 'en-us', entries: { hast: 'hˈæst' }, senses: { read: { past: 'ɹˈɛd' } } };
const SEN = { format: 'kth-pron-senses/1', module: 'KJV', language: 'en', verses: { 'GEN.1.1': { hash: '0', words: { 0: ['read', 'past'] } } } };
const MOD = { format: 'kth-pron-module/1', module: 'KJV', locale: 'en-us', verses: { 'GEN.1.1': { hash: '0', words: { 0: ['In', 'ɪn'] } } } };

function server(files: Record<string, unknown>) {
  const calls: string[] = [];
  let online = true;
  const fetchFn = async (url: string) => {
    calls.push(url);
    if (!online) throw new TypeError('Failed to fetch');
    return url in files ? new Response(JSON.stringify(files[url]), { status: 200 }) : new Response('', { status: 404 });
  };
  return { calls, fetchFn, offline: () => { online = false; } };
}

describe('PronunciationStore', () => {
  it('loads the lexicon, the language senses and the locale overrides, once', async () => {
    const s = server({ '/audio/pronunciation/en-us/lexicon.json': LEX, '/audio/pronunciation/en/KJV.json': SEN, '/audio/pronunciation/en-us/KJV.json': MOD });
    const store = new PronunciationStore({ base: '/audio/pronunciation/', cache: new MemoryAssetCache(), fetchFn: s.fetchFn });
    const o = await store.overlay('KJV', 'en-us');
    expect(o?.lexicon?.entries.get('hast')).toBe('hˈæst');
    expect(o?.senses?.verses.size).toBe(1);
    expect(o?.module?.verses.size).toBe(1);
    await store.overlay('KJV', 'en-us');
    expect(s.calls).toHaveLength(3);
  });

  it('a module without its own files still gets the lexicon; a locale with none gets nothing', async () => {
    const s = server({ '/a/en-us/lexicon.json': LEX });
    const store = new PronunciationStore({ base: '/a', cache: new MemoryAssetCache(), fetchFn: s.fetchFn });
    const o = await store.overlay('WEB', 'en-us');
    expect(o?.lexicon).toBeTruthy();
    expect(o?.senses).toBeNull();
    expect(o?.module).toBeNull();
    expect(await store.overlay('WEB', 'en-gb')).toBeNull();
  });

  it('the language senses serve every locale of the language', async () => {
    const s = server({ '/a/en-gb/lexicon.json': { ...LEX, locale: 'en-gb' }, '/a/en/KJV.json': SEN });
    const store = new PronunciationStore({ base: '/a', cache: new MemoryAssetCache(), fetchFn: s.fetchFn });
    expect((await store.overlay('KJV', 'en-gb'))?.senses?.module).toBe('KJV');
  });

  it('rejects files for another locale or module', async () => {
    const s = server({ '/a/en-us/lexicon.json': { ...LEX, locale: 'en-gb' }, '/a/en/WEB.json': SEN, '/a/en-us/WEB.json': MOD });
    const store = new PronunciationStore({ base: '/a', cache: new MemoryAssetCache(), fetchFn: s.fetchFn });
    expect(await store.overlay('WEB', 'en-us')).toBeNull();
  });

  it('offline, the cached copy is used', async () => {
    const cache = new MemoryAssetCache();
    const s = server({ '/a/en-us/lexicon.json': LEX });
    await new PronunciationStore({ base: '/a', cache, fetchFn: s.fetchFn }).overlay('KJV', 'en-us');
    s.offline();
    const later = new PronunciationStore({ base: '/a', cache, fetchFn: s.fetchFn });
    expect((await later.overlay('KJV', 'en-us'))?.lexicon?.entries.get('hast')).toBe('hˈæst');
  });

  it('offline with nothing cached: no overlay now, and it asks again next time', async () => {
    const s = server({ '/a/en-us/lexicon.json': LEX });
    s.offline();
    const store = new PronunciationStore({ base: '/a', cache: new MemoryAssetCache(), fetchFn: s.fetchFn });
    expect(await store.overlay('KJV', 'en-us')).toBeNull();
    await store.overlay('KJV', 'en-us');
    expect(s.calls.filter(u => u.endsWith('lexicon.json'))).toHaveLength(2);
  });
});
