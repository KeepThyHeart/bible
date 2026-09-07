/**
 * Component tests for DialogLayer.
 *
 * Pattern: Composition component that conditionally renders child dialogs.
 * Child dialogs are mocked to avoid pulling in their full dependency trees.
 * Tests verify that the correct dialogs receive open/close props and that
 * Strong's popup/tooltip data flows through correctly.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// Mock heavy child dialogs to isolate DialogLayer logic
vi.mock('../Dialogs/SettingsPanel', () => ({
  SettingsPanel: ({ isOpen, scrollToSection }: { isOpen: boolean; onClose: () => void; scrollToSection?: string }) => (
    isOpen ? <div data-testid="settings-panel" data-section={scrollToSection ?? ''} /> : null
  ),
}));
vi.mock('../Dialogs/HelpDialog', () => ({
  HelpDialog: ({ isOpen, onSendFeedback }: { isOpen: boolean; onClose: () => void; onSendFeedback?: () => void }) => (
    isOpen ? <button data-testid="help-dialog" onClick={onSendFeedback} /> : null
  ),
}));
vi.mock('../Dialogs/FeedbackDialog', () => ({
  FeedbackDialog: ({ isOpen }: { isOpen: boolean; onClose: () => void }) => (
    isOpen ? <div data-testid="feedback-dialog" /> : null
  ),
}));
vi.mock('../Dialogs/CopyDialog', () => ({
  CopyDialog: ({ isOpen }: { isOpen: boolean; onClose: () => void }) => (
    isOpen ? <div data-testid="copy-dialog" /> : null
  ),
}));
vi.mock('../Dialogs/StrongsPopup', () => ({
  StrongsPopup: ({ entry }: { entry: unknown; position: unknown; onClose: () => void }) => (
    entry ? <div data-testid="strongs-popup" /> : null
  ),
}));
vi.mock('../Dialogs/StrongsTooltip', () => ({
  StrongsTooltip: ({ entry }: { entry: unknown; position: unknown }) => (
    entry ? <div data-testid="strongs-tooltip" /> : null
  ),
}));

import { DialogLayer } from './DialogLayer';
import type { StrongsEntryData } from '../../types';

function makeEntry(): StrongsEntryData {
  return {
    strongsNumber: 'G25',
    word: 'ἀγάπη',
    transliteration: 'agape',
    definition: 'love',
    partOfSpeech: 'noun',
  };
}

function baseProps() {
  return {
    settingsOpen: false,
    setSettingsOpen: vi.fn(),
    helpOpen: false,
    setHelpOpen: vi.fn(),
    feedbackOpen: false,
    setFeedbackOpen: vi.fn(),
    copyOpen: false,
    setCopyOpen: vi.fn(),
    strongsPopup: null as null | { entry: StrongsEntryData; position: { top: number; left: number } },
    setStrongsPopup: vi.fn() as (value: null) => void,
    strongsTooltip: null as null | { entry: StrongsEntryData; position: { top: number; left: number } },
  };
}

describe('DialogLayer', () => {
  it('renders nothing visible when all dialogs are closed', () => {
    const { container } = render(<DialogLayer {...baseProps()} />);
    expect(container.querySelector('[data-testid="settings-panel"]')).toBeNull();
    expect(container.querySelector('[data-testid="help-dialog"]')).toBeNull();
    expect(container.querySelector('[data-testid="copy-dialog"]')).toBeNull();
    expect(container.querySelector('[data-testid="strongs-popup"]')).toBeNull();
    expect(container.querySelector('[data-testid="strongs-tooltip"]')).toBeNull();
  });

  it('shows SettingsPanel when settingsOpen is true', () => {
    const props = { ...baseProps(), settingsOpen: true };
    const { container } = render(<DialogLayer {...props} />);
    expect(container.querySelector('[data-testid="settings-panel"]')).toBeTruthy();
  });

  it('passes settingsSection to SettingsPanel', () => {
    const props = { ...baseProps(), settingsOpen: true, settingsSection: 'display' };
    const { container } = render(<DialogLayer {...props} />);
    const panel = container.querySelector('[data-testid="settings-panel"]') as HTMLElement;
    expect(panel.dataset.section).toBe('display');
  });

  it('shows HelpDialog when helpOpen is true', () => {
    const props = { ...baseProps(), helpOpen: true };
    const { container } = render(<DialogLayer {...props} />);
    expect(container.querySelector('[data-testid="help-dialog"]')).toBeTruthy();
  });

  it('shows CopyDialog when copyOpen is true', () => {
    const props = { ...baseProps(), copyOpen: true };
    const { container } = render(<DialogLayer {...props} />);
    expect(container.querySelector('[data-testid="copy-dialog"]')).toBeTruthy();
  });

  it('shows StrongsPopup when strongsPopup entry is set', () => {
    const props = {
      ...baseProps(),
      strongsPopup: { entry: makeEntry(), position: { top: 100, left: 200 } },
    };
    const { container } = render(<DialogLayer {...props} />);
    expect(container.querySelector('[data-testid="strongs-popup"]')).toBeTruthy();
  });

  it('does not show StrongsPopup when strongsPopup is null', () => {
    const props = { ...baseProps(), strongsPopup: null };
    const { container } = render(<DialogLayer {...props} />);
    expect(container.querySelector('[data-testid="strongs-popup"]')).toBeNull();
  });

  it('shows StrongsTooltip when strongsTooltip entry is set', () => {
    const props = {
      ...baseProps(),
      strongsTooltip: { entry: makeEntry(), position: { top: 50, left: 80 } },
    };
    const { container } = render(<DialogLayer {...props} />);
    expect(container.querySelector('[data-testid="strongs-tooltip"]')).toBeTruthy();
  });

  it('can render multiple dialogs open simultaneously', () => {
    const props = {
      ...baseProps(),
      settingsOpen: true,
      helpOpen: true,
    };
    const { container } = render(<DialogLayer {...props} />);
    expect(container.querySelector('[data-testid="settings-panel"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="help-dialog"]')).toBeTruthy();
  });

  it('shows FeedbackDialog when feedbackOpen is true', () => {
    const props = { ...baseProps(), feedbackOpen: true };
    const { container } = render(<DialogLayer {...props} />);
    expect(container.querySelector('[data-testid="feedback-dialog"]')).toBeTruthy();
  });

  it('swaps Help for Feedback rather than stacking the two overlays', () => {
    const props = { ...baseProps(), helpOpen: true };
    const { container } = render(<DialogLayer {...props} />);
    fireEvent.click(container.querySelector('[data-testid="help-dialog"]')!);
    expect(props.setHelpOpen).toHaveBeenCalledWith(false);
    expect(props.setFeedbackOpen).toHaveBeenCalledWith(true);
  });
});
