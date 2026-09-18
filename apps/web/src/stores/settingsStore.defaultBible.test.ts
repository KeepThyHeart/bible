/**
 * Which Bible the app opens when nothing more specific names one.
 *
 * The server's `ui.defaultModule` is a preference, not a guarantee: a fresh
 * install may not have that translation at all. The default has to land on
 * something that is actually installed, or the first chapter the reader sees
 * is "Failed to load chapter". And while the module list has not loaded yet
 * (early in boot, or offline) nothing can be ruled out, so the configured
 * value is trusted rather than second-guessed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { settingsStore } from './settingsStore';
import { moduleStore } from './moduleStore';
import type { ModuleInfo } from '../types';

function module(abbreviation: string, type = 'bible'): ModuleInfo {
  return { module_id: 0, abbreviation, name: abbreviation, type, language_code: 'en' };
}

function install(...modules: ModuleInfo[]): void {
  moduleStore.availableModules = modules;
  moduleStore.loaded = true;
}

beforeEach(() => {
  settingsStore.serverDefaultModule = null;
  moduleStore.availableModules = [];
  moduleStore.loaded = false;
});

describe('settingsStore.getDefaultBible', () => {
  it('uses the configured default when it is installed', () => {
    settingsStore.serverDefaultModule = 'KJV';
    install(module('ASV'), module('KJV'));
    expect(settingsStore.getDefaultBible()).toBe('KJV');
  });

  it('matches the configured default case-insensitively, returning the installed spelling', () => {
    settingsStore.serverDefaultModule = 'kjv';
    install(module('ASV'), module('KJV'));
    expect(settingsStore.getDefaultBible()).toBe('KJV');
  });

  it('falls back to the first installed Bible when the configured default is not installed', () => {
    settingsStore.serverDefaultModule = 'KJV';
    install(module('ASV'), module('WEB'));
    expect(settingsStore.getDefaultBible()).toBe('ASV');
  });

  it('uses the first installed Bible when no default is configured', () => {
    install(module('ASV'), module('WEB'));
    expect(settingsStore.getDefaultBible()).toBe('ASV');
  });

  it('never picks a module that is not a Bible', () => {
    install(module('Barnes', 'commentary'), module('ASV'));
    expect(settingsStore.getDefaultBible()).toBe('ASV');
  });

  it('trusts the configured default before the module list has loaded', () => {
    settingsStore.serverDefaultModule = 'NET';
    expect(settingsStore.getDefaultBible()).toBe('NET');
  });

  it('keeps the configured default when the list loaded but holds no Bible', () => {
    settingsStore.serverDefaultModule = 'NET';
    install(module('Barnes', 'commentary'));
    expect(settingsStore.getDefaultBible()).toBe('NET');
  });

  it('falls back to KJV only when nothing else is known', () => {
    expect(settingsStore.getDefaultBible()).toBe('KJV');
  });
});

describe('settingsStore.resolveInstalledBible', () => {
  it('keeps a translation that is installed, in the installed spelling', () => {
    install(module('ASV'), module('KJV'));
    expect(settingsStore.resolveInstalledBible('kjv')).toBe('KJV');
  });

  it('replaces a translation that is not installed with the default', () => {
    settingsStore.serverDefaultModule = 'WEB';
    install(module('ASV'), module('WEB'));
    expect(settingsStore.resolveInstalledBible('KJV')).toBe('WEB');
  });

  it('leaves the translation alone while the module list is unknown', () => {
    settingsStore.serverDefaultModule = 'ASV';
    expect(settingsStore.resolveInstalledBible('KJV')).toBe('KJV');
  });
});
