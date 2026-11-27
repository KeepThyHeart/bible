/**
 * "Download audio for offline listening" (task 0223): pick a translation and narrator, then the books to
 * keep on this device. State lives in the shared `AudioDownloadsModel`; this only draws it. Books are
 * grouped Old/New Testament with size and download state; the Whole Bible preset and any large or
 * too-big selection ask first, with the total and the free space.
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { formatBytes } from '@bible/audio';
import type { AudioBookRow, AudioDownloadsModel, Testament } from '@bible/audio';
import { ConfirmDialog } from '../../../components/shared/ConfirmDialog';
import { useI18n } from '../../../contexts/useI18n';

/** Message the model carries when the network switch is off (see `AudioDownloads`). */
export const OFFLINE_ERROR = 'audio-offline';

type Check = Awaited<ReturnType<AudioDownloadsModel['check']>>;

export interface AudioDownloadsPanelProps {
  model: AudioDownloadsModel;
  /** Translations with recordings. */
  modules: { abbreviation: string; name?: string }[];
  bookName: (book: number) => string;
  initialModule?: string;
}

export const AudioDownloadsPanel: React.FC<AudioDownloadsPanelProps> = ({ model, modules, bookName, initialModule }) => {
  const { t } = useI18n();
  useSyncExternalStore(model.subscribe, () => model.version);
  // The model outlives this panel: reopening during a run shows that run's translation.
  const [moduleAbbr, setModuleAbbr] = useState(
    (model.run === 'running' ? model.module : null) ?? initialModule ?? modules[0]?.abbreviation ?? '',
  );
  const [wholeBible, setWholeBible] = useState(false);
  const [confirm, setConfirm] = useState<Check | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [focusBook, setFocusBook] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moduleAbbr) return;
    if (model.run === 'running' && model.module === moduleAbbr) return; // a run in progress: show it, do not reload
    const ctl = new AbortController();
    void model.open(moduleAbbr, ctl.signal);
    return () => { ctl.abort(); }; // a running download is not cancelled by leaving
  }, [model, moduleAbbr]);

  const selectionKey = [...model.selected].join(',');
  useEffect(() => {
    let live = true;
    void model.check().then((c) => { if (live) setCheck(c); });
    return () => { live = false; };
  }, [model, selectionKey, model.rows.length, model.run]);

  // After Remove the button disappears; keep the keyboard place on the book's checkbox.
  useEffect(() => {
    if (focusBook === null) return;
    listRef.current?.querySelector<HTMLInputElement>(`#audio-dl-cb-${focusBook}`)?.focus();
    setFocusBook(null);
  }, [focusBook, model.version]);

  const running = model.run === 'running';
  const narrators = model.index?.narrators ?? [];
  const bytesText = (n: number | null) => (n === null ? t('audio.downloads.sizeLoading') : formatBytes(n));

  const start = async () => {
    const c = await model.check();
    if (c.fits === false) { setCheck(c); return; } // does not fit: say so, do not start
    if (wholeBible || c.warn) { setConfirm(c); return; }
    void model.download();
  };
  const confirmed = () => { setConfirm(null); void model.download(); };

  const bookRow = (r: AudioBookRow) => {
    const name = bookName(r.book);
    const meta = [
      r.partial ? t('audio.downloads.chapters', { count: r.chapters.length, total: r.totalChapters }) : null,
      bytesText(r.bytes),
      r.state === 'downloaded' ? t('audio.downloads.state.downloaded') : r.state === 'partial' ? t('audio.downloads.state.partial') : null,
    ].filter(Boolean).join(' · ');
    return (
      <li key={r.book} className="audio-downloads__book" data-testid={`audio-dl-book-${r.book}`}>
        <label className="audio-downloads__label">
          <input
            id={`audio-dl-cb-${r.book}`}
            type="checkbox"
            checked={model.selected.has(r.book)}
            disabled={running || r.state === 'downloaded'}
            onChange={() => { setWholeBible(false); model.toggle(r.book); }}
          />
          <span className="audio-downloads__name">{name}</span>
        </label>
        <span className="audio-downloads__meta">{meta}</span>
        {r.state !== 'absent' && (
          <button
            type="button"
            className="audio-settings__btn"
            disabled={running}
            aria-label={t('audio.downloads.removeBook', { book: name })}
            onClick={() => { void model.remove(r.book).then(() => setFocusBook(r.book)); }}
          >
            {t('audio.settings.remove')}
          </button>
        )}
      </li>
    );
  };

  const group = (testament: Testament) => {
    const rows = model.rows.filter((r) => r.testament === testament);
    if (rows.length === 0) return null;
    const headingId = `audio-dl-${testament}`;
    const label = t(testament === 'ot' ? 'audio.downloads.ot' : 'audio.downloads.nt');
    const open = rows.filter((r) => r.state !== 'downloaded');
    const allOn = open.every((r) => model.selected.has(r.book));
    return (
      <section className="audio-downloads__group" aria-labelledby={headingId} data-testid={`audio-dl-group-${testament}`}>
        <div className="audio-downloads__group-head">
          <h5 id={headingId} className="audio-settings__heading">{label}</h5>
          {open.length > 0 && <button
            type="button"
            className="audio-settings__btn"
            disabled={running}
            aria-label={t(allOn ? 'audio.downloads.clearGroup' : 'audio.downloads.selectGroup', { testament: label })}
            onClick={() => { setWholeBible(false); model.selectTestament(testament, !allOn); }}
          >
            {t(allOn ? 'audio.downloads.clear' : 'audio.downloads.selectAll')}
          </button>}
        </div>
        <ul className="audio-downloads__list">{rows.map(bookRow)}</ul>
      </section>
    );
  };

  const p = model.progress;
  const failedText = model.error === OFFLINE_ERROR ? t('audio.downloads.offline') : t('audio.downloads.failed', { message: model.error ?? '' });
  const progressText = running && p
    ? t('audio.downloads.progress', {
      book: p.current ? bookName(p.current) : '', done: Math.min(p.done + 1, p.total), total: p.total,
      loaded: formatBytes(p.loadedBytes), size: formatBytes(p.totalBytes),
    })
    : model.run === 'done' ? t('audio.downloads.done')
      : model.run === 'cancelled' ? t('audio.downloads.cancelled')
        : model.run === 'failed' ? failedText
          : '';

  const selCount = model.selected.size;
  const noFit = check?.fits === false && selCount > 0;

  return (
    <div className="audio-downloads" data-testid="audio-downloads" ref={listRef}>
      <p className="audio-settings__hint">{t('audio.downloads.hint')}</p>

      <div className="audio-downloads__pickers">
        <label className="audio-downloads__field">
          <span>{t('audio.downloads.translation')}</span>
          <select
            className="audio-select"
            data-testid="audio-dl-translation"
            value={moduleAbbr}
            disabled={running || modules.length === 0}
            onChange={(e) => { setWholeBible(false); setModuleAbbr(e.target.value); }}
          >
            {modules.map((m) => <option key={m.abbreviation} value={m.abbreviation}>{m.name ? `${m.abbreviation} · ${m.name}` : m.abbreviation}</option>)}
          </select>
        </label>
        {narrators.length > 1 && (
          <label className="audio-downloads__field">
            <span>{t('audio.downloads.narrator')}</span>
            <select
              className="audio-select"
              data-testid="audio-dl-narrator"
              value={model.narratorId ?? ''}
              disabled={running}
              onChange={(e) => { setWholeBible(false); void model.chooseNarrator(e.target.value); }}
            >
              {narrators.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
          </label>
        )}
      </div>

      {model.loading && <p className="audio-settings__hint" role="status">{t('audio.downloads.loading')}</p>}
      {!model.loading && model.rows.length === 0 && (
        <p className="audio-settings__hint" data-testid="audio-dl-none">{t('audio.downloads.none', { module: moduleAbbr })}</p>
      )}

      {model.rows.length > 0 && (
        <>
          <div className="audio-downloads__presets">
            <button
              type="button"
              className="audio-settings__btn"
              data-testid="audio-dl-whole"
              disabled={running || model.rows.every((r) => r.state === 'downloaded')}
              onClick={() => { setWholeBible(true); model.selectWholeBible(); }}
            >
              {t('audio.downloads.wholeBible')}{model.totalBytes !== null ? ` · ${formatBytes(model.totalBytes)}` : ''}
            </button>
          </div>
          {group('ot')}
          {group('nt')}

          <p className="audio-downloads__summary" data-testid="audio-dl-summary">
            {t('audio.downloads.selected', { count: selCount, size: bytesText(model.selectedBytes) })}
            {check?.free != null && ` · ${t('audio.downloads.free', { size: formatBytes(check.free) })}`}
          </p>
          {noFit && <p className="audio-downloads__warn" role="alert" data-testid="audio-dl-nofit">{t('audio.downloads.noFit')}</p>}

          <div className="audio-downloads__actions">
            {!running && (
              <button type="button" className="audio-settings__btn audio-downloads__primary" data-testid="audio-dl-start" disabled={selCount === 0 || noFit} onClick={() => { void start(); }}>
                {t('audio.downloads.download')}
              </button>
            )}
            {running && (
              <button type="button" className="audio-settings__btn" data-testid="audio-dl-cancel" onClick={() => model.cancel()}>{t('audio.action.cancel')}</button>
            )}
          </div>
        </>
      )}

      {running && p && (
        <progress className="audio-settings__progress" data-testid="audio-dl-progress" max={p.totalBytes || undefined} value={p.totalBytes ? p.loadedBytes : undefined} aria-label={t('audio.downloads.title')} />
      )}
      <p className="audio-downloads__status" role="status" aria-live="polite" data-testid="audio-dl-status">{progressText}</p>

      <ConfirmDialog
        open={confirm !== null}
        title={t('audio.downloads.confirmTitle')}
        message={confirm && confirm.fits === false && confirm.free !== null
          ? t('audio.downloads.confirmNoFit', { size: bytesText(confirm.bytes), free: formatBytes(confirm.free) })
          : t('audio.downloads.confirmBody', { size: bytesText(confirm?.bytes ?? null) })}
        confirmLabel={t('audio.downloads.confirmGo')}
        cancelLabel={t('audio.downloads.back')}
        onConfirm={confirmed}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
};
