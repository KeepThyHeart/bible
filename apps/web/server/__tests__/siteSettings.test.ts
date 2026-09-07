import { describe, it, expect } from 'vitest';
import {
  isModuleActive,
  getModuleEntry,
  buildDescriptions,
  getSettingsKey,
} from '../siteSettings';
import type { ModuleTypeConfig, ModuleEntry } from '../siteSettings';

// ── Helper ──────────────────────────────────────────────────────────

function makeConfig(modules: Record<string, ModuleEntry>): ModuleTypeConfig {
  return { modules, sections: [] };
}

// ── getSettingsKey ──────────────────────────────────────────────────

describe('getSettingsKey', () => {
  it('maps "bible" to "bibles"', () => {
    expect(getSettingsKey('bible')).toBe('bibles');
  });

  it('maps "commentary" to "commentaries"', () => {
    expect(getSettingsKey('commentary')).toBe('commentaries');
  });

  it('maps "dictionary" to "dictionaries"', () => {
    expect(getSettingsKey('dictionary')).toBe('dictionaries');
  });

  it('returns null for unknown types', () => {
    expect(getSettingsKey('book')).toBeNull();
    expect(getSettingsKey('devotional')).toBeNull();
    expect(getSettingsKey('')).toBeNull();
  });
});

// ── isModuleActive ──────────────────────────────────────────────────

describe('isModuleActive', () => {
  const config = makeConfig({
    KJV: { active: true },
    ESV: { active: false },
    NIV: { active: true },
  });

  it('returns true for an active module', () => {
    expect(isModuleActive(config, 'KJV')).toBe(true);
    expect(isModuleActive(config, 'NIV')).toBe(true);
  });

  it('returns false for an inactive module', () => {
    expect(isModuleActive(config, 'ESV')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isModuleActive(config, 'kjv')).toBe(true);
    expect(isModuleActive(config, 'Kjv')).toBe(true);
    expect(isModuleActive(config, 'esv')).toBe(false);
  });

  it('returns false for unknown module', () => {
    expect(isModuleActive(config, 'NASB')).toBe(false);
  });

  it('returns false when config is undefined', () => {
    expect(isModuleActive(undefined, 'KJV')).toBe(false);
  });
});

// ── getModuleEntry ──────────────────────────────────────────────────

describe('getModuleEntry', () => {
  const config = makeConfig({
    KJV: { active: true, title: 'King James Version', description: 'Classic' },
    ESV: { active: false },
  });

  it('returns the entry for a known module', () => {
    const entry = getModuleEntry(config, 'KJV');
    expect(entry).toBeDefined();
    expect(entry!.active).toBe(true);
    expect(entry!.title).toBe('King James Version');
  });

  it('is case-insensitive', () => {
    expect(getModuleEntry(config, 'kjv')).toBeDefined();
    expect(getModuleEntry(config, 'KJV')).toBeDefined();
  });

  it('returns undefined for unknown module', () => {
    expect(getModuleEntry(config, 'NASB')).toBeUndefined();
  });

  it('returns undefined when config is undefined', () => {
    expect(getModuleEntry(undefined, 'KJV')).toBeUndefined();
  });
});

// ── buildDescriptions ───────────────────────────────────────────────

describe('buildDescriptions', () => {
  it('builds description overrides from modules with title/description', () => {
    const config = makeConfig({
      KJV: { active: true, title: 'King James', description: 'The classic translation' },
      ESV: { active: true, title: 'English Standard' },
      NIV: { active: true },
    });

    const result = buildDescriptions(config);

    expect(result['KJV']).toEqual({ title: 'King James', description: 'The classic translation' });
    expect(result['ESV']).toEqual({ title: 'English Standard' });
    // NIV has no title or description, so it should NOT appear
    expect(result['NIV']).toBeUndefined();
  });

  it('returns only description when title is absent', () => {
    const config = makeConfig({
      KJV: { active: true, description: 'A description' },
    });
    const result = buildDescriptions(config);
    expect(result['KJV']).toEqual({ description: 'A description' });
  });

  it('returns empty object when config is undefined', () => {
    expect(buildDescriptions(undefined)).toEqual({});
  });

  it('returns empty object when no modules have title or description', () => {
    const config = makeConfig({
      KJV: { active: true },
      ESV: { active: false },
    });
    expect(buildDescriptions(config)).toEqual({});
  });
});
