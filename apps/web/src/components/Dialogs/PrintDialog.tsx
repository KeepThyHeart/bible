/**
 * The Print dialog: a live preview of the printed page with every print setting beside it (above it on
 * narrow screens). The preview is the very document handed to the browser's print dialog, which also
 * offers "Save as PDF".
 *
 * Settings are remembered apart from Copy's (`copyPreferences`). "More options..." returns to the
 * Copy dialog, whose Print button comes back here following that format.
 */
import { useState } from 'preact/hooks';
import type { RefObject } from 'preact';
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
  buildPrintStylesheet,
  notesMarginFromUnit,
  notesMarginInUnit,
  printNotesRuleHtml,
  printTitleHtml,
  type PrintPreferences,
} from '@bible/core/browser';
import { useTranslation } from 'react-i18next';
import { loadPrintPreferences, savePrintPreferences } from './copyPreferences';
import { PrintPagePreview } from './PrintPagePreview';

const THEME_LABEL_KEYS = {
  bw: 'copyDialog.printThemeBw',
  classic: 'copyDialog.printThemeClassic',
  blue: 'copyDialog.printThemeBlue',
  green: 'copyDialog.printThemeGreen',
  sepia: 'copyDialog.printThemeSepia',
} as const;

/** The standalone page: stylesheet, optional title and notes rule, and the sanitized passage body. */
export function buildWebPrintDocument(title: string, bodyHtml: string, prefs: PrintPreferences): string {
  const dir = document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
  return `<!DOCTYPE html><html dir="${dir}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>${buildPrintStylesheet(prefs)}</style></head><body>${printNotesRuleHtml(prefs)}${printTitleHtml(title, prefs)}${bodyHtml}</body></html>`;
}

/** Print a document through a sandboxed hidden iframe, removed again afterwards. */
function printThroughFrame(doc: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-modals allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;inset-inline-end:0;inset-block-end:0;inline-size:0;block-size:0;border:0';
  frame.srcdoc = doc;
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) { frame.remove(); return; }
    win.addEventListener('afterprint', () => frame.remove());
    win.focus();
    win.print();
    // Some browsers never fire afterprint; do not leave the frame behind.
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}

interface PrintDialogProps {
  title: string;
  /** The sanitized passage HTML for the given print settings (the layout decides the format). */
  buildBody: (prefs: PrintPreferences) => string;
  onClose: () => void;
  /** Go back to the Copy dialog to print in one of its formats. */
  onMoreOptions: () => void;
  dialogRef: RefObject<HTMLDivElement>;
}

export function PrintDialog({ title, buildBody, onClose, onMoreOptions, dialogRef }: PrintDialogProps) {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState<PrintPreferences>(loadPrintPreferences);
  const change = (partial: Partial<PrintPreferences>): void => {
    const next = { ...prefs, ...partial };
    setPrefs(next);
    savePrintPreferences(next);
  };

  const doc = buildWebPrintDocument(title, buildBody(prefs), prefs);
  const unit = prefs.unit;
  const marginShown = notesMarginInUnit(prefs.notesMarginCm, unit);

  return (
    <div class="copy-dialog-overlay" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('copyDialog.printTitle')}
        class="print-dialog"
        data-testid="print-dialog"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div class="copy-dialog__header">
          <h3>{t('copyDialog.printTitle')}</h3>
          <button onClick={onClose} aria-label={t('common.close')}><i class="fa-solid fa-xmark" /></button>
        </div>

        <div class="print-dialog__body">
          <div class="print-dialog__settings" role="group" aria-label={t('copyDialog.printOptions')}>
            <label class="copy-dialog__option">
              <span>{t('copyDialog.printLayout')}</span>
              <select
                value={prefs.layout}
                onChange={(e) => change({ layout: (e.target as HTMLSelectElement).value as PrintPreferences['layout'] })}
                data-testid="print-layout"
              >
                <option value="numbered">{t('copyDialog.printLayoutNumbered')}</option>
                <option value="blockquote">{t('copyDialog.printLayoutBlockquote')}</option>
                {prefs.layout === 'preview' && <option value="preview">{t('copyDialog.printLayoutPreview')}</option>}
              </select>
            </label>
            <button type="button" class="print-dialog__link" onClick={onMoreOptions} data-testid="print-more-options">
              {t('copyDialog.printMoreOptions')}
            </button>

            <label class="copy-dialog__option">
              <input type="checkbox" checked={prefs.showTitle} onChange={(e) => change({ showTitle: (e.target as HTMLInputElement).checked })} data-testid="print-title" />
              <span>{t('copyDialog.printShowTitle')}</span>
            </label>

            <label class="copy-dialog__option">
              <span>{t('copyDialog.printTheme')}</span>
              <select value={prefs.theme} onChange={(e) => change({ theme: (e.target as HTMLSelectElement).value as PrintPreferences['theme'] })} data-testid="print-theme">
                {PRINT_THEMES.map(th => <option key={th} value={th}>{t(THEME_LABEL_KEYS[th])}</option>)}
              </select>
            </label>
            {prefs.theme !== 'bw' && (
              <label class="copy-dialog__option">
                <input type="checkbox" checked={prefs.redLetters} onChange={(e) => change({ redLetters: (e.target as HTMLInputElement).checked })} data-testid="print-red-letters" />
                <span>{t('copyDialog.printRedLetters')}</span>
              </label>
            )}

            <label class="copy-dialog__option">
              <span>{t('copyDialog.printLineSpacing')}</span>
              <select value={String(prefs.lineSpacing)} onChange={(e) => change({ lineSpacing: Number((e.target as HTMLSelectElement).value) })} data-testid="print-line-spacing">
                {PRINT_LINE_SPACINGS.map(v => (
                  <option key={v} value={String(v)}>{v === PRINT_LINE_SPACINGS[0] ? t('copyDialog.printLineSpacingNormal') : `${v}×`}</option>
                ))}
              </select>
            </label>

            <label class="copy-dialog__option">
              <span>{t('copyDialog.printFontSize', { size: prefs.fontSizePt })}</span>
              <input
                type="range"
                min={PRINT_FONT_SIZE_MIN_PT}
                max={PRINT_FONT_SIZE_MAX_PT}
                step={1}
                value={prefs.fontSizePt}
                onInput={(e) => change({ fontSizePt: Number((e.target as HTMLInputElement).value) })}
                data-testid="print-font-size"
              />
            </label>

            <label class="copy-dialog__option">
              <input type="checkbox" checked={prefs.notesMargin} onChange={(e) => change({ notesMargin: (e.target as HTMLInputElement).checked })} data-testid="print-notes-margin" />
              <span>{t('copyDialog.printNotesMargin')}</span>
            </label>
            {prefs.notesMargin && (
              <>
                <label class="copy-dialog__option">
                  <span>{t('copyDialog.printUnits')}</span>
                  <select value={unit} onChange={(e) => change({ unit: (e.target as HTMLSelectElement).value as PrintPreferences['unit'] })} data-testid="print-unit">
                    {PRINT_UNITS.map(u => <option key={u} value={u}>{t(u === 'cm' ? 'copyDialog.printUnitCm' : 'copyDialog.printUnitIn')}</option>)}
                  </select>
                </label>
                <label class="copy-dialog__option">
                  <span>{t(unit === 'cm' ? 'copyDialog.printMarginWidth' : 'copyDialog.printMarginWidthIn', { width: marginShown })}</span>
                  <input
                    type="range"
                    min={unit === 'cm' ? PRINT_NOTES_MARGIN_MIN_CM : PRINT_NOTES_MARGIN_MIN_IN}
                    max={unit === 'cm' ? PRINT_NOTES_MARGIN_MAX_CM : PRINT_NOTES_MARGIN_MAX_IN}
                    step={unit === 'cm' ? PRINT_NOTES_MARGIN_STEP_CM : PRINT_NOTES_MARGIN_STEP_IN}
                    value={marginShown}
                    onInput={(e) => change({ notesMarginCm: notesMarginFromUnit(Number((e.target as HTMLInputElement).value), unit) })}
                    data-testid="print-margin-width"
                  />
                </label>
                <label class="copy-dialog__option">
                  <input type="checkbox" checked={prefs.notesRule} onChange={(e) => change({ notesRule: (e.target as HTMLInputElement).checked })} data-testid="print-notes-rule" />
                  <span>{t('copyDialog.printMarginRule')}</span>
                </label>
              </>
            )}
          </div>

          <div class="print-dialog__preview" role="region" aria-label={t('copyDialog.printPreviewLabel')}>
            <PrintPagePreview html={doc} label={t('copyDialog.printPreviewLabel')} />
          </div>
        </div>

        <div class="print-dialog__footer">
          <span class="print-dialog__hint">{t('copyDialog.printPdfHint')}</span>
          <button class="copy-dialog__copy-btn" onClick={onClose}>{t('common.cancel')}</button>
          <button
            class="copy-dialog__copy-btn"
            onClick={() => printThroughFrame(doc)}
            data-testid="print-dialog-print"
          >
            {t('copyDialog.print')}
          </button>
        </div>
      </div>
    </div>
  );
}
