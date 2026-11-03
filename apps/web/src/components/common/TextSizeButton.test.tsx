import 'preact/compat';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

// English strings for the keys this component uses, with {placeholders} filled.
vi.mock('react-i18next', () => {
  const en: Record<string, string> = {
    'settings.textSize.popoverTitle': 'Text size',
    'settings.textSize.popoverReset': 'Reset',
    'settings.textSize.moreOptions': 'More text options…',
    'settings.textSize.decreaseAll': 'Decrease all font sizes',
    'settings.textSize.increaseAll': 'Increase all font sizes',
  };
  const t = (key: string, vars: Record<string, unknown> = {}) =>
    (en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
  return {
    useTranslation: () => ({ t, i18n: { language: 'en' } }),
    initReactI18next: { type: '3rdParty', init: () => {} },
  };
});

import { TextSizeButton } from './TextSizeButton';
import { settingsStore, DEFAULT_SETTINGS, TEXT_SIZE_RANGES, TEXT_SIZE_STEPS, DEFAULT_TEXT_SIZE_STEP } from '../../stores/settingsStore';

beforeEach(() => {
  settingsStore.setFontSize(DEFAULT_SETTINGS.fontSize);
  settingsStore.setStudyFontSize(DEFAULT_SETTINGS.studyFontSize);
  settingsStore.setUiFontSize(DEFAULT_SETTINGS.uiFontSize);
});

const open = (target: 'bible' | 'study' = 'bible') => fireEvent.click(screen.getByTestId(`text-size-btn-${target}`));

describe('TextSizeButton', () => {
  it('shows "Aa" and opens a popover rather than Settings', () => {
    const onMore = vi.fn();
    render(<TextSizeButton target="bible" onMoreOptions={onMore} />);
    const btn = screen.getByTestId('text-size-btn-bible');
    expect(btn.textContent).toBe('Aa');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    open();
    expect(screen.getByTestId('text-size-popover-bible')).toBeTruthy();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(onMore).not.toHaveBeenCalled();
  });

  it('has one −/+ control that steps all text together and shows the step number', () => {
    render(<TextSizeButton target="study" />);
    open('study');
    expect(screen.getByTestId('text-size-value').textContent).toBe(String(DEFAULT_TEXT_SIZE_STEP));
    fireEvent.click(screen.getByRole('button', { name: /increase/i }));
    const next = TEXT_SIZE_STEPS[DEFAULT_TEXT_SIZE_STEP];
    expect(settingsStore.fontSize).toBe(next);
    // Study and interface sizes scale by the same factor as the Bible size.
    const factor = next / DEFAULT_SETTINGS.fontSize;
    expect(settingsStore.studyFontSize).toBe(Math.round(DEFAULT_SETTINGS.studyFontSize * factor));
    expect(settingsStore.uiFontSize).toBe(Math.round(DEFAULT_SETTINGS.uiFontSize * factor));
    expect(screen.getByTestId('text-size-value').textContent).toBe(String(DEFAULT_TEXT_SIZE_STEP + 1));
    fireEvent.click(screen.getByRole('button', { name: /decrease/i }));
    expect(settingsStore.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(settingsStore.studyFontSize).toBe(DEFAULT_SETTINGS.studyFontSize);
    expect(settingsStore.uiFontSize).toBe(DEFAULT_SETTINGS.uiFontSize);
  });

  it('keeps the popover where it opened while sizes change', () => {
    render(<TextSizeButton target="bible" />);
    open();
    const pop = screen.getByTestId('text-size-popover-bible');
    const before = pop.getAttribute('style');
    fireEvent.click(screen.getByRole('button', { name: /increase/i }));
    fireEvent.click(screen.getByRole('button', { name: /increase/i }));
    expect(pop.getAttribute('style')).toBe(before);
  });

  it('disables + past the largest step', () => {
    settingsStore.setFontSize(TEXT_SIZE_RANGES.fontSize.max);
    render(<TextSizeButton target="bible" />);
    open();
    expect((screen.getByRole('button', { name: /increase/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('resets all sizes, and links to the full options', () => {
    const onMore = vi.fn();
    settingsStore.setFontSize(30);
    settingsStore.setUiFontSize(20);
    render(<TextSizeButton target="bible" onMoreOptions={onMore} />);
    open();
    fireEvent.click(screen.getByText(/^reset$/i));
    expect(settingsStore.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(settingsStore.uiFontSize).toBe(DEFAULT_SETTINGS.uiFontSize);
    fireEvent.click(screen.getByText(/more text options/i));
    expect(onMore).toHaveBeenCalled();
    expect(screen.queryByTestId('text-size-popover-bible')).toBeNull();
  });

  it('closes on Escape and returns focus to the button', () => {
    render(<TextSizeButton target="bible" />);
    open();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('text-size-popover-bible')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('text-size-btn-bible'));
  });
});

describe('settingsStore text-size steps', () => {
  it('defaults to step 5', () => {
    expect(DEFAULT_TEXT_SIZE_STEP).toBe(5);
    expect(settingsStore.getTextSizeStep()).toBe(5);
  });

  it('snaps an exact size from Settings onto the next step in the direction pressed', () => {
    settingsStore.setFontSize(20); // between steps 5 (19) and 6 (21)
    settingsStore.stepTextSize(1);
    expect(settingsStore.fontSize).toBe(21);
    settingsStore.setFontSize(20);
    settingsStore.stepTextSize(-1);
    expect(settingsStore.fontSize).toBe(19);
  });

  it('returns to the default sizes after stepping up and back down several times', () => {
    for (let i = 0; i < 4; i++) settingsStore.stepTextSize(1);
    for (let i = 0; i < 4; i++) settingsStore.stepTextSize(-1);
    expect([settingsStore.fontSize, settingsStore.studyFontSize, settingsStore.uiFontSize])
      .toEqual([DEFAULT_SETTINGS.fontSize, DEFAULT_SETTINGS.studyFontSize, DEFAULT_SETTINGS.uiFontSize]);
  });

  it('stops at both ends of the scale', () => {
    for (let i = 0; i < 20; i++) settingsStore.stepTextSize(-1);
    expect(settingsStore.getTextSizeStep()).toBe(1);
    expect(settingsStore.canStepTextSize(-1)).toBe(false);
    for (let i = 0; i < 20; i++) settingsStore.stepTextSize(1);
    expect(settingsStore.getTextSizeStep()).toBe(TEXT_SIZE_STEPS.length);
    expect(settingsStore.canStepTextSize(1)).toBe(false);
  });
});

describe('settingsStore text-size steps are deterministic', () => {
  const sizes = () => [settingsStore.fontSize, settingsStore.studyFontSize, settingsStore.uiFontSize];

  it('gives each step the same sizes whether reached from below or above', () => {
    const fromBelow: number[][] = [];
    settingsStore.setTextSizeStep(1);
    fromBelow.push(sizes());
    for (let i = 1; i < TEXT_SIZE_STEPS.length; i++) {
      settingsStore.stepTextSize(1);
      fromBelow.push(sizes());
    }
    // Now at the top, where the interface size is capped. Walk back down.
    const fromAbove: number[][] = [sizes()];
    for (let i = 1; i < TEXT_SIZE_STEPS.length; i++) {
      settingsStore.stepTextSize(-1);
      fromAbove.unshift(sizes());
    }
    expect(fromAbove).toEqual(fromBelow);
  });

  it('puts per-area sizes from Settings back on the scale at the next step', () => {
    settingsStore.setUiFontSize(22);
    settingsStore.stepTextSize(1);
    settingsStore.stepTextSize(-1);
    expect(sizes()).toEqual([DEFAULT_SETTINGS.fontSize, DEFAULT_SETTINGS.studyFontSize, DEFAULT_SETTINGS.uiFontSize]);
  });
});
