import React from 'react';
import { useI18n } from '../../contexts/useI18n';
import { useOfferedFonts } from '../../hooks/useOfferedFonts';
import type { PickableFont } from '../../hooks/useOfferedFonts';

/**
 * The `<option>`s of a font picker: only the faces this machine has, grouped Serif / Sans-serif, with the
 * saved choice kept (marked "not installed") when it is missing here. Render inside a `<select>`.
 */
export const FontOptions: React.FC<{ fonts: PickableFont[]; value: string | undefined }> = ({ fonts, value }) => {
  const { t } = useI18n();
  const { groups, missing } = useOfferedFonts(fonts, value);
  const label = (f: PickableFont) => (f.labelKey ? t(f.labelKey, { fontName: f.label }) : f.label);
  const option = (f: PickableFont) => (
    <option key={f.value} value={f.value} style={{ fontFamily: f.stack }}>{label(f)}</option>
  );
  return (
    <>
      {groups.general.map(option)}
      {groups.serif.length > 0 && (
        <optgroup label={t('preferencesDialog.fontGroupSerif')}>{groups.serif.map(option)}</optgroup>
      )}
      {groups.sans.length > 0 && (
        <optgroup label={t('preferencesDialog.fontGroupSans')}>{groups.sans.map(option)}</optgroup>
      )}
      {missing && (
        <option key={missing.value} value={missing.value} disabled>
          {t('preferencesDialog.fontNotInstalled', { fontName: missing.label })}
        </option>
      )}
    </>
  );
};
