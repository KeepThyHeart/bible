import { useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { presentStore } from '../../../stores/presentStore';
import { usePresenter } from '../../../components/Present/usePresenter';
import { usePresenterState } from '../presenterSink';
import { HighlightChips } from './HighlightChips';
import { useStore } from '../../../hooks/useStore';
import type { PresentItem } from '../../../present/protocol';
import { AddRow } from './AddRow';
import { CommandArea } from './CommandArea';
import { ControlMenu } from './ControlMenu';
import { isSetupDone, markSetupDone } from './setupState';
import { SetupCard } from './SetupCard';
import { StatusRow } from './StatusRow';
import { Transport } from './Transport';

/**
 * The Control pane: the command box and its search results, a short status row,
 * transport, and the Verse / Hymn / Quote pickers. There is deliberately no "On
 * screen / Up next" block; the preview shows what is on screen.
 *
 * It reads `presentStore` itself and takes only two optional props:
 *  - `onAddToNotes`: called by the pickers' "Add to notes" buttons.
 *  - `onOpenHelp`: opens the presenter help (owned by the page).
 */
export function ControlPane(props: {
  onAddToNotes?: (item: PresentItem, label?: string) => void;
  onOpenHelp: () => void;
}) {
  const { t } = useTranslation();
  const view = usePresenter();
  const state = usePresenterState();
  const session = useStore(presentStore, () => presentStore.session);
  const [menuOpen, setMenuOpen] = useState(false);
  const [setupDone, setSetupDone] = useState(isSetupDone);

  return (
    <section class="pz-pane pz-control" aria-label={t('present.app.control')}>
      <CommandArea state={state} onAddToNotes={props.onAddToNotes} onHelp={props.onOpenHelp} />

      <div class="pz-control__top">
        <StatusRow menuOpen={menuOpen} onToggleMenu={() => setMenuOpen(open => !open)} />
        {menuOpen && (
          <ControlMenu
            session={session}
            onClose={() => setMenuOpen(false)}
            onOpenHelp={props.onOpenHelp}
          />
        )}
      </div>

      <div class="pz-pane__body">
        {view.error && (
          <div class="pz-error" role="status">
            {view.error}
            <button type="button" onClick={() => presentStore.clearError()} aria-label={t('common.close')}>
              <i class="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
        )}

        {!setupDone && (
          <SetupCard session={session} onDone={() => { markSetupDone(); setSetupDone(true); }} />
        )}

        <Transport />
        <HighlightChips />
        <AddRow onAddToNotes={props.onAddToNotes} />
      </div>
    </section>
  );
}
