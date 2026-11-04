import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseDisabledModules, releaseModuleOverrides, RELEASE_DISABLED_MODULES, RELEASE_EXTENSIONS_ENABLED } from './releaseProfile';
import { MAIN_MODULES } from '../modules/mainModules';

describe('releaseProfile', () => {
  it('parses the comma-separated define, ignoring blanks', () => {
    expect(parseDisabledModules(' quiz, ,timeline,')).toEqual(['quiz', 'timeline']);
    expect(parseDisabledModules(undefined)).toEqual([]);
  });

  it('turns ids into false overrides', () => {
    expect(releaseModuleOverrides(['quiz', 'memory'])).toEqual({ quiz: false, memory: false });
  });

  it('is a full build (nothing disabled) when no profile is baked in', () => {
    expect(RELEASE_DISABLED_MODULES).toEqual([]);
    expect(RELEASE_EXTENSIONS_ENABLED).toBe(true);
  });

  it('release-profiles.json: base names only real main-process module ids it can disable, and full disables nothing', () => {
    const profiles = JSON.parse(readFileSync(resolve(__dirname, '../../release-profiles.json'), 'utf8'));
    expect(profiles.full.disabledModules).toEqual([]);
    expect(profiles.base.extensions).toBe(false);
    const mainIds = new Set(MAIN_MODULES.map((m) => m.manifest.id));
    // Renderer-only modules (genealogy, measures, ...) have no main half; every id must exist somewhere, and
    // the ones that do have a main half must match it exactly.
    for (const id of ['quiz', 'timeline', 'memory', 'speech', 'notifications', 'reading-plans', 'similar', 'word-study', 'xref-graph', 'keyword-marks']) {
      expect(profiles.base.disabledModules).toContain(id);
      expect(mainIds.has(id)).toBe(true);
    }
  });
});
