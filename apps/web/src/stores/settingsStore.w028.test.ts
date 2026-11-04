// @vitest-environment jsdom
/** W-028: garbage stored sizes are sanitised on load. */
import { describe, it, expect, beforeEach } from 'vitest';
import { settingsStore, TEXT_SIZE_RANGES } from './settingsStore';

function loadWith(blob: unknown) {
  localStorage.setItem('bible-reader-settings', JSON.stringify(blob));
  settingsStore.load();
}

describe('settingsStore.load clamps stored sizes (W-028)', () => {
  beforeEach(() => { localStorage.clear(); settingsStore.setTextSizeStep(5); });

  it('clamps huge and tiny values into range', () => {
    loadWith({ textSizeVersion: 2, uiFontSize: 99999, fontSize: -5, studyFontSize: 0, lineHeight: 50, studyLineHeight: 0.1 });
    expect(settingsStore.uiFontSize).toBe(TEXT_SIZE_RANGES.uiFontSize.max);
    expect(settingsStore.fontSize).toBe(TEXT_SIZE_RANGES.fontSize.min);
    expect(settingsStore.studyFontSize).toBe(TEXT_SIZE_RANGES.studyFontSize.min);
    expect(settingsStore.lineHeight).toBe(TEXT_SIZE_RANGES.lineHeight.max);
    expect(settingsStore.studyLineHeight).toBe(TEXT_SIZE_RANGES.studyLineHeight.min);
  });

  it('non-numeric values fall back to the current default, never NaN', () => {
    const before = { ui: settingsStore.uiFontSize, f: settingsStore.fontSize };
    loadWith({ textSizeVersion: 2, uiFontSize: 'abc', fontSize: {}, lineHeight: null });
    expect(settingsStore.uiFontSize).toBe(before.ui);
    expect(settingsStore.fontSize).toBe(before.f);
    expect(Number.isFinite(settingsStore.lineHeight)).toBe(true);
    expect(document.documentElement.style.cssText).not.toContain('NaN');
  });

  it('numeric strings are accepted and clamped', () => {
    loadWith({ textSizeVersion: 2, uiFontSize: '16', fontSize: '1000' });
    expect(settingsStore.uiFontSize).toBe(16);
    expect(settingsStore.fontSize).toBe(TEXT_SIZE_RANGES.fontSize.max);
  });
});
