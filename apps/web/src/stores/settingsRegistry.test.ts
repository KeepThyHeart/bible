/**
 * The web settings registry over the legacy settings blob (task 0087).
 * Pins that the migrated swipe settings keep their storage location and behaviour.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSettingsStore } from '@bible/core/browser';
import { STORAGE_KEY, WEB_SETTINGS, webSettingsPort } from './settingsRegistry';
import { settingsStore } from './settingsStore';

function blob(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
}

beforeEach(() => {
  localStorage.clear();
  settingsStore.load();
});

describe('settingsStore.save', () => {
  it('keeps registry keys (appHidden) across a legacy save and reload', async () => {
    const { webSettings } = await import('./settingsRegistry');
    webSettings.set('appHidden', ['present']);
    settingsStore.setTheme('dark');
    expect(blob().appHidden).toEqual(['present']);
    settingsStore.load();
    await webSettings.reload();
    expect(webSettings.get('appHidden')).toEqual(['present']);
  });
});

describe('webSettingsPort', () => {
  it('merges into the existing blob without dropping other keys', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: 'dark', fontSize: 22 }));
    const store = createSettingsStore(WEB_SETTINGS, webSettingsPort);
    store.set('swipeChaptersEnabled', false);
    expect(blob()).toMatchObject({ theme: 'dark', fontSize: 22, swipeChaptersEnabled: false });
  });

  it('reads values saved by the previous settings store', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      swipeChaptersEnabled: false, swipeChapterThresholdPx: 250, swipeCommentaryVerseThresholdPx: 9999,
    }));
    const store = createSettingsStore(WEB_SETTINGS, webSettingsPort);
    expect(store.get('swipeChaptersEnabled')).toBe(false);
    expect(store.get('swipeChapterThresholdPx')).toBe(250);
    expect(store.get('swipeCommentaryVerseThresholdPx')).toBe(400); // clamped, as the old store did
  });

  it('tolerates a corrupt blob', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const store = createSettingsStore(WEB_SETTINGS, webSettingsPort);
    expect(store.get('swipeChapterThresholdPx')).toBe(100);
  });
});

describe('settingsStore delegating to the registry', () => {
  it('keeps the old setters and getters working and clamps like before', () => {
    settingsStore.setSwipeChapterThresholdPx(5);
    expect(settingsStore.swipeChapterThresholdPx).toBe(20);
    settingsStore.setSwipeChapterThresholdPx(1000);
    expect(settingsStore.swipeChapterThresholdPx).toBe(400);
    settingsStore.setSwipeChaptersEnabled(false);
    expect(settingsStore.swipeChaptersEnabled).toBe(false);
    expect(blob()).toMatchObject({ swipeChaptersEnabled: false, swipeChapterThresholdPx: 400 });
  });

  it('survives settingsStore.save() rewriting the blob', () => {
    settingsStore.setSwipeCommentaryVerseThresholdPx(150);
    settingsStore.setFontSize(20); // save() rewrites the whole blob
    expect(blob().swipeCommentaryVerseThresholdPx).toBe(150);
    settingsStore.load();
    expect(settingsStore.swipeCommentaryVerseThresholdPx).toBe(150);
  });

  it('wakes settingsStore subscribers when a swipe setting changes', () => {
    let calls = 0;
    const off = settingsStore.subscribe(() => { calls++; });
    settingsStore.setSwipeChaptersEnabled(false);
    off();
    expect(calls).toBeGreaterThan(0);
  });

  it('resetToDefaults restores the swipe settings', () => {
    settingsStore.setSwipeChaptersEnabled(false);
    settingsStore.setSwipeChapterThresholdPx(300);
    settingsStore.resetToDefaults();
    expect(settingsStore.swipeChaptersEnabled).toBe(true);
    expect(settingsStore.swipeChapterThresholdPx).toBe(100);
  });
});
