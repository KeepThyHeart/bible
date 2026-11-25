import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { useCtrlWheelBibleSize, stepBibleFontSize } from './useCtrlWheelBibleSize';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { useTextSettingsStore } from '../stores/useTextSettingsStore';

function Harness() {
  const ref = React.useRef<HTMLDivElement>(null);
  useCtrlWheelBibleSize(ref);
  return <div ref={ref} data-testid="text" />;
}

const size = () => usePreferencesStore.getState().typography.bibleFontSize;

describe('Ctrl + wheel Bible text size', () => {
  beforeEach(() => {
    usePreferencesStore.getState().resetTypography();
    useTextSettingsStore.getState().resetSettings('bible');
  });

  it('wheel up with Ctrl grows the Typography Bible size and cancels the browser zoom', () => {
    const { getByTestId } = render(<Harness />);
    const before = size();
    const notCancelled = fireEvent.wheel(getByTestId('text'), { ctrlKey: true, deltaY: -100 });
    expect(notCancelled).toBe(false);
    expect(size()).toBe(before + 1);
  });

  it('wheel without Ctrl does nothing (the text scrolls)', () => {
    const { getByTestId } = render(<Harness />);
    const before = size();
    const notCancelled = fireEvent.wheel(getByTestId('text'), { deltaY: -100 });
    expect(notCancelled).toBe(true);
    expect(size()).toBe(before);
  });

  it('does not detach the pane (customized stays false)', () => {
    stepBibleFontSize(1);
    expect(useTextSettingsStore.getState().customized.bible).toBe(false);
    expect(useTextSettingsStore.getState().getSettings('bible').fontSize).toBe(size());
  });

  it('stays within 12-48', () => {
    usePreferencesStore.getState().setTypography({ bibleFontSize: 48 });
    stepBibleFontSize(1);
    expect(size()).toBe(48);
    usePreferencesStore.getState().setTypography({ bibleFontSize: 12 });
    stepBibleFontSize(-1);
    expect(size()).toBe(12);
  });

  it('changes the pane override when the pane was customized in Fonts', () => {
    useTextSettingsStore.getState().updateSettings('bible', { fontSize: 30 });
    const typographyBefore = size();
    stepBibleFontSize(-1);
    expect(useTextSettingsStore.getState().getSettings('bible').fontSize).toBe(29);
    expect(size()).toBe(typographyBefore);
  });
});
