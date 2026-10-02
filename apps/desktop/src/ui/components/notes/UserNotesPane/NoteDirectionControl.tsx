import React from 'react';
import { useI18n } from '../../../contexts/useI18n';
import type { NoteDirectionChoice } from '../../../services/noteDirectionAPI';

interface Props {
  value: NoteDirectionChoice;
  onChange: (next: NoteDirectionChoice) => void;
}

/** Note-level "Note direction" menu: Default (follow the UI language) / LTR / RTL. */
const NoteDirectionControl: React.FC<Props> = ({ value, onChange }) => {
  const { t } = useI18n();
  return (
    // ms-auto pushes this and the pop-out button to the far end of the header.
    <label className="ms-auto flex-shrink-0 flex items-center gap-1 text-xs text-text-secondary">
      <span>{t('editorToolbar.noteDirectionLabel')}</span>
      <select
        value={value ?? 'default'}
        onChange={(e) => onChange(e.target.value === 'default' ? null : (e.target.value as 'ltr' | 'rtl'))}
        className="px-1 py-1 text-sm rounded border border-border-secondary bg-background"
        title={t('editorToolbar.noteDirectionTitle')}
        aria-label={t('editorToolbar.noteDirectionLabel')}
      >
        <option value="default">{t('editorToolbar.noteDirectionDefault')}</option>
        <option value="ltr">{t('editorToolbar.noteDirectionLtr')}</option>
        <option value="rtl">{t('editorToolbar.noteDirectionRtl')}</option>
      </select>
    </label>
  );
};

export default NoteDirectionControl;
