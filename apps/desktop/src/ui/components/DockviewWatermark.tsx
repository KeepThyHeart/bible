import React from 'react';
import type { IWatermarkPanelProps } from 'dockview-react';
import { useI18n } from '../contexts/useI18n';
import { useLayoutStore, type PanelContentType } from '../stores/useLayoutStore';
import { localizePaneLabel } from '../utils/paneNames';
import { chooserIconFor } from './paneIcons';

/**
 * Shown when every panel has been closed - the emptiest the app can get, and
 * the one place a user can end up with genuinely nothing on screen.
 *
 * The button row was already here; what was missing was any explanation of
 * what a "panel" is or why the app is arranged this way. That sentence is the
 * whole point of the addition.
 */
const DockviewWatermark: React.FC<IWatermarkPanelProps> = () => {
  const { t } = useI18n();
  const handleAdd = (type: PanelContentType, label: string) => {
    useLayoutStore.getState().addPanel(type, undefined, label); // allow-getstate: event handler - imperative panel creation
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: '16px',
        padding: '24px',
        backgroundColor: 'var(--theme-bg-primary)',
        color: 'var(--theme-text-secondary)',
      }}
    >
      <div style={{ maxWidth: '460px', textAlign: 'center' }}>
        <p style={{ fontSize: '14px', marginBottom: '8px', color: 'var(--theme-text-primary)' }}>
          {t('dockviewWatermark.emptyMessage')}
        </p>
        <p style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--theme-text-secondary)' }}>
          {t('onboarding.empty.workspace.description')}
        </p>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {/*
          `label` stays English on purpose. It is handed to `addPanel`, which
          persists it as the panel's title in the serialized layout - so a
          localized string here would bake the creating locale into the saved
          session. `localizePaneLabel` recognizes these exact generic English
          titles and translates them at render time instead; the button text
          below is resolved the same way. See utils/paneNames.ts.
        */}
        {([
          // Same order as the "+ New Tab" chooser (minus the two kinds this
          // row has never offered): two chooser surfaces disagreeing about
          // where "Notes" sits is a needless thing to re-learn. The glyphs come
          // from the shared vocabulary rather than being spelled out again.
          ['bible', 'Bible'],
          ['notes', 'Notes'],
          ['prayer', 'Prayer'],
          ['book', 'Books'],
          ['commentary', 'Commentary'],
          ['dictionary', 'Dictionary'],
        ] as const).map(([type, label]) => (
          <button
            key={type}
            onClick={() => handleAdd(type, label)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              border: '1px solid var(--theme-border-primary)',
              borderRadius: '6px',
              backgroundColor: 'transparent',
              color: 'var(--theme-text-primary)',
              cursor: 'pointer',
              fontSize: '13px',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-tab-bg-hover)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
            }}
          >
            <span aria-hidden="true">{chooserIconFor(type)}</span>
            <span>{localizePaneLabel(t, type, label) ?? label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default DockviewWatermark;
