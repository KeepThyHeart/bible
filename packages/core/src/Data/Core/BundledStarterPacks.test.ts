import { describe, it, expect } from 'vitest';
import starterPacksJson from './starter-packs.json';
import { BUNDLED_STARTER_PACKS } from './BundledStarterPacks';
import { parseStarterPacks } from './StarterPackTypes';

describe('starter-packs.json', () => {
  const raw = (starterPacksJson as { packs: unknown[] }).packs;

  it('holds only valid packs (a rejected entry would silently vanish from the app)', () => {
    expect(parseStarterPacks(raw).rejected).toEqual([]);
    expect(BUNDLED_STARTER_PACKS).toHaveLength(raw.length);
  });

  it('gives every pack a unique id', () => {
    const ids = BUNDLED_STARTER_PACKS.map(p => p.pack_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lists no module twice within a pack', () => {
    for (const pack of BUNDLED_STARTER_PACKS) {
      expect(new Set(pack.module_ids).size).toBe(pack.module_ids.length);
    }
  });

  describe('the essentials pack', () => {
    const essentials = BUNDLED_STARTER_PACKS.find(p => p.pack_id === 'essentials');

    it('is offered for English', () => {
      expect(essentials?.languages).toContain('en');
    });

    it('has both Bibles, the commentaries, TSK, Strong\'s and the dictionaries and topical indexes', () => {
      expect(essentials?.module_ids).toEqual(expect.arrayContaining([
        'bible_kjv', 'bible_webbe',
        'commentary_synthesis', 'commentary_mhc', 'commentary_barnes', 'commentary_gill', 'commentary_wesley',
        'xref_tsk', 'dictionary_strongsgreek', 'dictionary_strongshebrew',
        'dictionary_easton', 'dictionary_webster1828',
        'topical_nave', 'topical_torrey',
      ]));
    });

    it('needs no books', () => {
      expect(essentials?.module_ids.some(id => id.startsWith('book_'))).toBe(false);
    });
  });
});
