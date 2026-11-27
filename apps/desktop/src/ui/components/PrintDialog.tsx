/**
 * The Print dialog: a live preview of the printed page with every print setting beside it (above it on
 * narrow windows). Print and Save as PDF are its buttons.
 *
 * The preview is the very document that is printed or saved, so what the user sees is what they get. The
 * settings are remembered apart from Copy's (`printPreferences`). "More options..." hands over to the
 * Copy dialog's full list of formats and options, whose "Print this format..." comes back here following it.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  PRINT_FONT_SIZE_MAX_PT,
  PRINT_FONT_SIZE_MIN_PT,
  PRINT_LINE_SPACINGS,
  PRINT_NOTES_MARGIN_MAX_CM,
  PRINT_NOTES_MARGIN_MAX_IN,
  PRINT_NOTES_MARGIN_MIN_CM,
  PRINT_NOTES_MARGIN_MIN_IN,
  PRINT_NOTES_MARGIN_STEP_CM,
  PRINT_NOTES_MARGIN_STEP_IN,
  PRINT_THEMES,
  PRINT_UNITS,
  notesMarginFromUnit,
  notesMarginInUnit,
  type PrintPreferences,
} from '@bible/core';
import { useI18n } from '../contexts/useI18n';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { PopupPortal } from '../hooks/usePopupPosition';
import { useToastStore } from '../stores/useToastStore';
import { exportDocumentPdf, printDocument } from '../services/fileNotesAPI';
import { loadPrintPreferences, savePrintPreferences } from '../services/copyFormats/printPreferences';
import { buildPassagePrintDocument } from '../utils/passagePrintDocument';
import PrintPagePreview from './PrintPagePreview';

const MODAL_Z_INDEX = 10000;

const THEME_LABEL_KEYS = {
  bw: 'passageDialog.printThemeBw',
  classic: 'passageDialog.printThemeClassic',
  blue: 'passageDialog.printThemeBlue',
  green: 'passageDialog.printThemeGreen',
  sepia: 'passageDialog.printThemeSepia',
} as const;

export interface PrintDialogProps {
  title: string;
  /** The suggested file name, no extension ("John 3-16 KJV"): the PDF's name and the document's `<title>`. */
  fileName: string;
  /** The passage as HTML for the given print settings (the layout decides the format). */
  buildBody: (prefs: PrintPreferences) => string;
  onClose: () => void;
  /** Open the Copy dialog's formats and options, to print in one of them. */
  onMoreOptions: () => void;
}

const SELECT = 'bg-background-tertiary border border-border rounded px-2 py-1 text-text-primary';

export default function PrintDialog({ title, fileName, buildBody, onClose, onMoreOptions }: PrintDialogProps) {
  const { t } = useI18n();
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const [prefs, setPrefs] = useState<PrintPreferences>(() => loadPrintPreferences());
  const [busy, setBusy] = useState(false);

  const change = useCallback((partial: Partial<PrintPreferences>) => {
    setPrefs(prev => {
      const next = { ...prev, ...partial };
      savePrintPreferences(next);
      return next;
    });
  }, []);

  const doc = useMemo(
    () => buildPassagePrintDocument(title, buildBody(prefs), document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr', prefs, fileName),
    [title, fileName, buildBody, prefs],
  );

  const finish = (
    result: { success: boolean; canceled?: boolean; error?: string },
    failedKey: 'passageDialog.printFailed' | 'passageDialog.savePdfFailed' = 'passageDialog.printFailed',
  ): void => {
    setBusy(false);
    if (result.success) onClose();
    else if (!result.canceled) {
      useToastStore.getState().addToast(result.error || t(failedKey), 'error'); // allow-getstate: event handler
    }
  };

  const handlePrint = async (): Promise<void> => {
    setBusy(true);
    finish(await printDocument(doc));
  };

  const handleSavePdf = async (): Promise<void> => {
    setBusy(true);
    finish(await exportDocumentPdf(doc, fileName), 'passageDialog.savePdfFailed');
  };

  const unit = prefs.unit;
  const marginShown = notesMarginInUnit(prefs.notesMarginCm, unit);
  const label = 'flex items-center gap-2';

  return (
    <PopupPortal>
      <div
        className="fixed inset-0 bg-background-overlay flex items-center justify-center p-4"
        style={{ zIndex: MODAL_Z_INDEX }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t('copyOptionsDialog.printTitle')}
          data-testid="print-dialog"
          className="bg-surface-elevated text-text-primary rounded-lg shadow-xl w-full max-w-6xl h-[90vh] overflow-hidden flex flex-col"
        >
          <div className="px-6 py-4 border-b border-border shrink-0">
            <h2 className="text-lg font-semibold text-text-heading">{t('copyOptionsDialog.printTitle')}</h2>
          </div>

          <div className="flex-1 min-h-0 flex flex-col md:flex-row">
            <div
              role="group"
              aria-label={t('passageDialog.printOptions')}
              data-testid="print-dialog-settings"
              className="md:w-72 shrink-0 p-4 overflow-y-auto flex flex-col gap-3 text-sm text-text-secondary border-b md:border-b-0 md:border-e border-border max-h-[40%] md:max-h-none"
            >
              <label className={label}>
                {t('passageDialog.printLayout')}
                <select
                  value={prefs.layout}
                  onChange={e => change({ layout: e.target.value as PrintPreferences['layout'] })}
                  data-testid="print-layout"
                  className={SELECT}
                >
                  <option value="numbered">{t('passageDialog.printLayoutNumbered')}</option>
                  <option value="blockquote">{t('passageDialog.printLayoutBlockquote')}</option>
                  {prefs.layout === 'preview' && <option value="preview">{t('passageDialog.printLayoutPreview')}</option>}
                </select>
              </label>
              <button
                type="button"
                onClick={onMoreOptions}
                data-testid="print-more-options"
                className="self-start text-xs text-accent underline hover:no-underline"
              >
                {t('passageDialog.printMoreOptions')}
              </button>

              {prefs.layout !== 'preview' && (
                <label className="flex flex-col gap-1">
                  {t('ui.passageInsert.verseNumbersLabel')}
                  <select
                    value={prefs.verseNumbers}
                    onChange={e => change({ verseNumbers: e.target.value as PrintPreferences['verseNumbers'] })}
                    data-testid="print-verse-numbers"
                    className={`${SELECT} w-full min-w-0`}
                  >
                    <option value="parenthetical">{t('ui.passageInsert.verseNumbersParenthetical')}</option>
                    <option value="superscript">{t('ui.passageInsert.verseNumbersSuperscript')}</option>
                    <option value="first-full">{t('ui.passageInsert.verseNumbersFirstFull')}</option>
                    <option value="none">{t('ui.passageInsert.verseNumbersNone')}</option>
                  </select>
                </label>
              )}

              <label className={label}>
                <input type="checkbox" checked={prefs.showTitle} onChange={e => change({ showTitle: e.target.checked })} data-testid="print-title" className="w-3.5 h-3.5" />
                {t('passageDialog.printShowTitle')}
              </label>

              <label className={label}>
                {t('passageDialog.printTheme')}
                <select value={prefs.theme} onChange={e => change({ theme: e.target.value as PrintPreferences['theme'] })} data-testid="print-theme" className={SELECT}>
                  {PRINT_THEMES.map(th => <option key={th} value={th}>{t(THEME_LABEL_KEYS[th])}</option>)}
                </select>
              </label>
              {prefs.theme !== 'bw' && (
                <label className={label}>
                  <input type="checkbox" checked={prefs.redLetters} onChange={e => change({ redLetters: e.target.checked })} data-testid="print-red-letters" className="w-3.5 h-3.5" />
                  {t('passageDialog.printRedLetters')}
                </label>
              )}

              <label className={label}>
                {t('passageDialog.printLineSpacing')}
                <select value={prefs.lineSpacing} onChange={e => change({ lineSpacing: Number(e.target.value) })} data-testid="print-line-spacing" className={SELECT}>
                  {PRINT_LINE_SPACINGS.map(v => (
                    <option key={v} value={v}>{v === PRINT_LINE_SPACINGS[0] ? t('passageDialog.printLineSpacingNormal') : `${v}×`}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                {t('passageDialog.printFontSize', { size: prefs.fontSizePt })}
                <input
                  type="range"
                  min={PRINT_FONT_SIZE_MIN_PT}
                  max={PRINT_FONT_SIZE_MAX_PT}
                  step={1}
                  value={prefs.fontSizePt}
                  onChange={e => change({ fontSizePt: Number(e.target.value) })}
                  data-testid="print-font-size"
                />
              </label>

              <label className={label}>
                <input type="checkbox" checked={prefs.notesMargin} onChange={e => change({ notesMargin: e.target.checked })} data-testid="print-notes-margin" className="w-3.5 h-3.5" />
                {t('passageDialog.printNotesMargin')}
              </label>
              {prefs.notesMargin && (
                <div className="ps-5 flex flex-col gap-2">
                  <label className={label}>
                    {t('passageDialog.printUnits')}
                    <select value={unit} onChange={e => change({ unit: e.target.value as PrintPreferences['unit'] })} data-testid="print-unit" className={SELECT}>
                      {PRINT_UNITS.map(u => <option key={u} value={u}>{t(u === 'cm' ? 'passageDialog.printUnitCm' : 'passageDialog.printUnitIn')}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    {t(unit === 'cm' ? 'passageDialog.printMarginWidth' : 'passageDialog.printMarginWidthIn', { width: marginShown })}
                    <input
                      type="range"
                      min={unit === 'cm' ? PRINT_NOTES_MARGIN_MIN_CM : PRINT_NOTES_MARGIN_MIN_IN}
                      max={unit === 'cm' ? PRINT_NOTES_MARGIN_MAX_CM : PRINT_NOTES_MARGIN_MAX_IN}
                      step={unit === 'cm' ? PRINT_NOTES_MARGIN_STEP_CM : PRINT_NOTES_MARGIN_STEP_IN}
                      value={marginShown}
                      onChange={e => change({ notesMarginCm: notesMarginFromUnit(Number(e.target.value), unit) })}
                      data-testid="print-margin-width"
                    />
                  </label>
                  <label className={label}>
                    <input type="checkbox" checked={prefs.notesRule} onChange={e => change({ notesRule: e.target.checked })} data-testid="print-notes-rule" className="w-3.5 h-3.5" />
                    {t('passageDialog.printMarginRule')}
                  </label>
                </div>
              )}
            </div>

            <div
              role="region"
              aria-label={t('passageDialog.printPreviewLabel')}
              className="flex-1 min-w-0 min-h-0 overflow-auto bg-surface-secondary p-4"
            >
              <PrintPagePreview html={doc} label={t('passageDialog.printPreviewLabel')} />
            </div>
          </div>

          <div className="px-6 py-4 border-t border-border flex justify-end gap-3 shrink-0" data-popover-actions="">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-text-secondary bg-background-tertiary rounded hover:bg-background-active transition-colors">
              {t('copyOptionsDialog.cancelButton')}
            </button>
            <button
              type="button"
              onClick={() => void handleSavePdf()}
              disabled={busy}
              data-testid="print-save-pdf"
              className="px-4 py-2 text-sm font-medium text-text-secondary bg-background-tertiary rounded hover:bg-background-active transition-colors disabled:opacity-50"
            >
              {t('passageDialog.printSavePdf')}
            </button>
            <button
              type="button"
              onClick={() => void handlePrint()}
              disabled={busy}
              data-testid="print-dialog-print"
              className="px-4 py-2 text-sm font-medium text-text-on-accent bg-accent rounded hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {t('copyOptionsDialog.printButton')}
            </button>
          </div>
        </div>
      </div>
    </PopupPortal>
  );
}
