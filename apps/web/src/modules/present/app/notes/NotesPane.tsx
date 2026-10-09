import { useEffect, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../../../hooks/useStore';
import { focusCommandBox } from '../../lib/command';
import { LazyNotesEditor } from './editor/LazyNotesEditor';
import type { InsertKind } from './editor/Toolbar';
import { ItemChooser } from './ItemChooser';
import { notesStore } from './notesStore';
import { PlanOutline } from './PlanOutline';
import './notesPane.css';

const PHONE_QUERY = '(max-width: 759px)';

/** True on phones (<760px), where there is no rich-text editor at all (07-me; row 11 builds the phone plan). */
function useIsPhone(): boolean {
  const query = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(PHONE_QUERY) : null);
  const [phone, setPhone] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

type View = 'notes' | 'plan';

/**
 * The Notes column: the service's rich-text notes (autosaved), with the
 * detection decorations and the green Play gutter, and a Notes | Plan toggle
 * (the Plan view is the outline of the notes' items). The service menu lives
 * in the app bar.
 */
export function NotesPane() {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const [view, setView] = useState<View>('notes');
  useStore(notesStore, () => notesStore.doc);
  const chooser = notesStore.chooser;

  useEffect(() => {
    notesStore.setTranslate((key, params) => t(key, params) as string);
    void notesStore.init();
  }, [t]);

  const onInsertRequest = (kind: InsertKind) => {
    if (kind === 'hymn') {
      notesStore.openChooser({ mode: 'insert', anchor: new DOMRect(window.innerWidth / 3, 120, 0, 0) });
    } else if (kind === 'quote') {
      notesStore.addQuoteLine();
    } else {
      focusCommandBox();
    }
  };

  const showEditor = !phone && view === 'notes';

  return (
    <section class="pz-pane pz-notes" aria-label={t('present.app.notes')}>
      <div class="pz-notes__head">
        <h2 class="pz-pane__title pz-notes__title">{t('present.app.notes')}</h2>
        {!phone && (
          <>
            <div class="pz-notes__toggle" role="tablist">
              {(['notes', 'plan'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  class={`pz-notes__tab${view === v ? ' is-active' : ''}`}
                  onClick={() => setView(v)}
                >
                  {t(`present.notes.view.${v}`)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <div class="pz-notes__body">
        {showEditor ? (
          <LazyNotesEditor
            doc={notesStore.doc}
            onChange={notesStore.onDocChange}
            plugins={notesStore.plugins}
            onReady={notesStore.attachView}
            onShowAtCaret={notesStore.showAtCaret}
            onInsertRequest={onInsertRequest}
          />
        ) : (
          <PlanOutline />
        )}
      </div>
      {chooser && <ItemChooser key={chooser.mode === 'insert' ? 'insert' : chooser.id} target={chooser} />}
    </section>
  );
}
