import { useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../../hooks/useEscapeKey';

/**
 * A concise, multi-tab help overlay for the Presenter, opened from the `?` key,
 * the app bar or the Control menu rather than folded into the app's own
 * `HelpDialog`: presenting has its own vocabulary (notes, the plan, going
 * live, the simple viewer) that would otherwise crowd a dialog about reading
 * and searching Scripture.
 *
 * Each tab is a short list of points; the strings live in `help.json` under
 * `present.<tab>.<point>` and may carry <strong>/<kbd> markup.
 *
 * Reuses `.help-dialog` and `.settings-panel-overlay` from the app's own help
 * dialog rather than a bespoke box.
 */

type HelpTab = 'notes' | 'control' | 'preview' | 'command' | 'simple' | 'study' | 'joining';

const TABS: Array<{ id: HelpTab; points: string[] }> = [
  { id: 'notes', points: ['references', 'hymns', 'quotes', 'highlight', 'play', 'ctrlEnter', 'amber'] },
  { id: 'control', points: ['transport', 'pickers', 'chips', 'keys', 'prepare'] },
  { id: 'preview', points: ['what', 'dblclick', 'clickVerse', 'presenterOnly'] },
  { id: 'command', points: ['verse', 'passage', 'hymn', 'blank', 'search', 'open'] },
  { id: 'simple', points: ['what', 'open', 'prompt', 'noSearch'] },
  { id: 'study', points: ['send', 'highlight', 'companion'] },
  { id: 'joining', points: ['share', 'handoff', 'lock'] },
];

export function PresentHelp(props: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation('help');
  const [tab, setTab] = useState<HelpTab>('notes');
  useEscapeKey(props.isOpen, props.onClose);

  if (!props.isOpen) return null;

  return (
    <div class="settings-panel-overlay" onClick={props.onClose}>
      <div class="help-dialog" onClick={event => event.stopPropagation()}>
        <div class="help-dialog__header">
          <h3>
            <i class="fa-solid fa-circle-question" style={{ marginInlineEnd: '8px', opacity: 0.5 }} aria-hidden="true" />
            {t('present.title')}
          </h3>
          <button type="button" class="help-dialog__close" onClick={props.onClose} aria-label={t('present.close')}>
            <i class="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <div class="help-dialog__tabs">
          {TABS.map(({ id }) => (
            <button
              key={id}
              type="button"
              class={`help-dialog__tab ${tab === id ? 'help-dialog__tab--active' : ''}`}
              onClick={() => setTab(id)}
            >
              {t(`present.tab.${id}`)}
            </button>
          ))}
        </div>

        <div class="help-dialog__body">
          <section class="help-dialog__section">
            <h4>{t(`present.${tab}.title`)}</h4>
            <ul>
              {TABS.find(x => x.id === tab)!.points.map(point => (
                <li key={point} dangerouslySetInnerHTML={{ __html: t(`present.${tab}.${point}`) }} />
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
