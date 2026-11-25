/**
 * The desktop's "Look up" sources. Dictionaries are the only provider today; a genealogy or word-study
 * provider registers itself here the same way (see `LookUpProvider` in `@bible/core`).
 */
import { createLookUpRegistry } from '@bible/core/browser';
import type { LookUpGroup, LookUpProvider } from '@bible/core/browser';
import { dictionaryAPI } from '../services/electronAPI';

export const lookUpRegistry = createLookUpRegistry();

/** Every installed dictionary, through `dictionary:lookUp` (stemmed title match, Strong's entry first). */
export const dictionaryLookUpProvider: LookUpProvider = {
  id: 'dictionary',
  label: 'Dictionaries',
  lookUp: async (query) => (await dictionaryAPI.lookUp(query.text, query.strongs)) as LookUpGroup[],
};

lookUpRegistry.register(dictionaryLookUpProvider);
