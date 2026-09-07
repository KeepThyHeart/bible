import { SettingsPanel } from '../Dialogs/SettingsPanel';
import { HelpDialog } from '../Dialogs/HelpDialog';
import { FeedbackDialog } from '../Dialogs/FeedbackDialog';
import { CopyDialog } from '../Dialogs/CopyDialog';
import { StrongsPopup } from '../Dialogs/StrongsPopup';
import { StrongsTooltip } from '../Dialogs/StrongsTooltip';
import { SemanticSearchLoadingOverlay } from './SemanticSearchLoadingOverlay';
import type { StrongsEntryData } from '../../types';

interface DialogLayerProps {
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  settingsSection?: string;
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  feedbackOpen: boolean;
  setFeedbackOpen: (open: boolean) => void;
  copyOpen: boolean;
  setCopyOpen: (open: boolean) => void;
  strongsPopup: { entry: StrongsEntryData; position: { top: number; left: number } } | null;
  setStrongsPopup: (value: null) => void;
  strongsTooltip: { entry: StrongsEntryData; position: { top: number; left: number } } | null;
}

/**
 * Renders all shared dialogs (Settings, Help, Feedback, Copy, Strong's popup/tooltip).
 * Used by both DesktopApp and MobileApp to avoid duplicating dialog management.
 */
export function DialogLayer({
  settingsOpen, setSettingsOpen, settingsSection,
  helpOpen, setHelpOpen,
  feedbackOpen, setFeedbackOpen,
  copyOpen, setCopyOpen,
  strongsPopup, setStrongsPopup,
  strongsTooltip,
}: DialogLayerProps) {
  return (
    <>
      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        scrollToSection={settingsSection}
      />
      <HelpDialog
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        // Feedback replaces Help rather than stacking on top of it: two
        // overlays deep, the outer one's click-outside handler sits under the
        // inner dialog and closes both.
        onSendFeedback={() => { setHelpOpen(false); setFeedbackOpen(true); }}
      />
      <FeedbackDialog isOpen={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <CopyDialog isOpen={copyOpen} onClose={() => setCopyOpen(false)} />
      <StrongsPopup
        entry={strongsPopup?.entry ?? null}
        position={strongsPopup?.position ?? null}
        onClose={() => setStrongsPopup(null)}
      />
      <StrongsTooltip
        entry={strongsTooltip?.entry ?? null}
        position={strongsTooltip?.position ?? null}
      />
      <SemanticSearchLoadingOverlay />
    </>
  );
}
