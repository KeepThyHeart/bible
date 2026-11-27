/**
 * "Download audio for offline listening" (task 0223): pick a translation and narrator, then the
 * books to keep on this device. The state lives in the shared `AudioDownloadsModel`; this only
 * draws it. Books are grouped Old/New Testament, each with its size and download state; the Whole
 * Bible preset and any large or too-big selection ask first, with the total.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '@bible/audio';
import type { AudioBookRow, AudioDownloadsModel, Testament } from '@bible/audio';
import { useStore } from '../../../hooks/useStore';
import { moduleStore } from '../../../stores/moduleStore';

type Check = Awaited<ReturnType<AudioDownloadsModel['check']>>;

export interface AudioDownloadsViewProps {
  model: AudioDownloadsModel;
  moduleAbbr: string;
  /** Translations to choose from (default: the Bible modules). */
  modules?: { abbreviation: string; name?: string }[];
  bookName?: (book: number) => string;
}

export function AudioDownloadsView({ model, moduleAbbr, modules, bookName = b => moduleStore.getBookName(b) }: AudioDownloadsViewProps) {
  const { t } = useTranslation();
  useStore(model, () => model.version);
  const available = useMemo(() => modules ?? moduleStore.getBibleModules(), [modules]);
  const [wholeBible, setWholeBible] = useState(false);
  const [confirm, setConfirm] = useState<Check | null>(null);
  const [check, setCheck] = useState<Check | null>(null);

  useEffect(() => {
    if (model.run === 'running' && model.module) return; // a run in progress (model outlives the view): show it
    const ctl = new AbortController();
    void model.open(moduleAbbr, ctl.signal);
    return () => { ctl.abort(); }; // a running download is not cancelled by leaving
  }, [model, moduleAbbr]);

  const selectionKey = [...model.selected].join(',');
  useEffect(() => {
    let live = true;
    void model.check().then(c => { if (live) setCheck(c); });
    return () => { live = false; };
  }, [model, selectionKey, model.rows.length]);

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

  const group = (testament: Testament) => {
    const rows = model.rows.filter(r => r.testament === testament);
    if (rows.length === 0) return null;
    const headingId = `audio-dl-${testament}`;
    const label = t(`audio.downloads.${testament}`);
    const open = rows.filter(r => r.state !== 'downloaded');
    const allOn = open.every(r => model.selected.has(r.book));
    return (
      <section class="audio-downloads__group" aria-labelledby={headingId} data-testid={`audio-dl-group-${testament}`}>
        <div class="audio-downloads__group-head">
          <h5 id={headingId} class="audio-settings__heading">{label}</h5>
          {open.length > 0 && <button
            type="button"
            class="audio-settings__btn"
            disabled={running}
            aria-label={t(allOn ? 'audio.downloads.clearGroup' : 'audio.downloads.selectGroup', { testament: label })}
            onClick={() => { setWholeBible(false); model.selectTestament(testament, !allOn); }}
          >
            {t(allOn ? 'audio.downloads.clear' : 'audio.downloads.selectAll')}
          </button>}
        </div>
        <ul class="audio-downloads__list">{rows.map(r => bookRow(r))}</ul>
      </section>
    );
  };

  const bookRow = (r: AudioBookRow) => {
    const name = bookName(r.book);
    const meta = [
      r.partial ? t('audio.downloads.chapters', { count: r.chapters.length, total: r.totalChapters }) : null,
      bytesText(r.bytes),
      r.state === 'downloaded' ? t('audio.downloads.state.downloaded') : r.state === 'partial' ? t('audio.downloads.state.partial') : null,
    ].filter(Boolean).join(' · ');
    return (
      <li key={r.book} class="audio-downloads__book" data-testid={`audio-dl-book-${r.book}`}>
        <label class="audio-downloads__label">
          <input
            type="checkbox"
            checked={model.selected.has(r.book)}
            disabled={running || r.state === 'downloaded'}
            onChange={() => { setWholeBible(false); model.toggle(r.book); }}
          />
          <span class="audio-downloads__name">{name}</span>
        </label>
        <span class="audio-downloads__meta">{meta}</span>
        {r.state !== 'absent' && (
          <button
            type="button"
            class="audio-settings__btn"
            disabled={running}
            aria-label={t('audio.downloads.removeBook', { book: name })}
            onClick={() => { void model.remove(r.book); }}
          >
            {t('audio.settings.remove')}
          </button>
        )}
      </li>
    );
  };

  const p = model.progress;
  const progressText = running && p
    ? t('audio.downloads.progress', {
      book: p.current ? bookName(p.current) : '', done: p.done, total: p.total,
      loaded: formatBytes(p.loadedBytes), size: formatBytes(p.totalBytes),
    })
    : model.run === 'done' ? t('audio.downloads.done')
      : model.run === 'cancelled' ? t('audio.downloads.cancelled')
        : model.run === 'failed' ? t('audio.downloads.failed', { message: model.error ?? '' })
          : '';

  const selCount = model.selected.size;
  const noFit = check?.fits === false && selCount > 0;

  return (
    <div class="audio-downloads" data-testid="audio-downloads">
      <p class="audio-settings__hint">{t('audio.downloads.hint')}</p>

      <div class="audio-downloads__pickers">
        <label class="audio-downloads__field">
          <span>{t('audio.downloads.translation')}</span>
          <select
            class="audio-select"
            data-testid="audio-dl-translation"
            value={model.module ?? moduleAbbr}
            disabled={running}
            onChange={e => { setWholeBible(false); void model.open((e.target as HTMLSelectElement).value); }}
          >
            {available.map(m => <option key={m.abbreviation} value={m.abbreviation}>{m.name ? `${m.abbreviation} · ${m.name}` : m.abbreviation}</option>)}
          </select>
        </label>
        {narrators.length > 1 && (
          <label class="audio-downloads__field">
            <span>{t('audio.downloads.narrator')}</span>
            <select
              class="audio-select"
              data-testid="audio-dl-narrator"
              value={model.narratorId ?? ''}
              disabled={running}
              onChange={e => { setWholeBible(false); void model.chooseNarrator((e.target as HTMLSelectElement).value); }}
            >
              {narrators.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
          </label>
        )}
      </div>

      {model.loading && <p class="audio-settings__hint" role="status">{t('audio.downloads.loading')}</p>}
      {!model.loading && model.rows.length === 0 && (
        <p class="audio-settings__hint" data-testid="audio-dl-none">{t('audio.downloads.none', { module: model.module ?? moduleAbbr })}</p>
      )}

      {model.rows.length > 0 && (
        <>
          <div class="audio-downloads__presets">
            <button
              type="button"
              class="audio-settings__btn"
              data-testid="audio-dl-whole"
              disabled={running || model.rows.every(r => r.state === 'downloaded')}
              onClick={() => { setWholeBible(true); model.selectWholeBible(); }}
            >
              {t('audio.downloads.wholeBible')}{model.totalBytes !== null ? ` · ${formatBytes(model.totalBytes)}` : ''}
            </button>
          </div>
          {group('ot')}
          {group('nt')}

          <p class="audio-downloads__summary" data-testid="audio-dl-summary">
            {t('audio.downloads.selected', { count: selCount, size: bytesText(model.selectedBytes) })}
            {check?.free != null && ` · ${t('audio.downloads.free', { size: formatBytes(check.free) })}`}
          </p>
          {noFit && <p class="audio-downloads__warn" role="alert" data-testid="audio-dl-nofit">{t('audio.downloads.noFit')}</p>}

          {confirm ? (
            <div class="audio-downloads__confirm" role="alertdialog" aria-labelledby="audio-dl-confirm-title" aria-describedby="audio-dl-confirm-body" data-testid="audio-dl-confirm">
              <h5 id="audio-dl-confirm-title" class="audio-downloads__confirm-title">{t('audio.downloads.confirmTitle')}</h5>
              <p id="audio-dl-confirm-body">
                {confirm.fits === false && confirm.free !== null
                  ? t('audio.downloads.confirmNoFit', { size: bytesText(confirm.bytes), free: formatBytes(confirm.free) })
                  : t('audio.downloads.confirmBody', { size: bytesText(confirm.bytes) })}
              </p>
              <div class="audio-gate__actions">
                <button type="button" class="audio-gate__btn" onClick={() => setConfirm(null)}>{t('audio.downloads.back')}</button>
                <button type="button" class="audio-gate__btn audio-gate__btn--primary" data-testid="audio-dl-confirm-go" onClick={confirmed}>{t('audio.downloads.confirmGo')}</button>
              </div>
            </div>
          ) : (
            <div class="audio-downloads__actions">
              {!running && (
                <button type="button" class="audio-gate__btn audio-gate__btn--primary" data-testid="audio-dl-start" disabled={selCount === 0 || noFit} onClick={() => { void start(); }}>
                  {t('audio.downloads.download')}
                </button>
              )}
              {running && (
                <button type="button" class="audio-gate__btn" data-testid="audio-dl-cancel" onClick={() => model.cancel()}>{t('audio.action.cancel')}</button>
              )}
            </div>
          )}
        </>
      )}

      {running && p && <progress class="audio-settings__progress" data-testid="audio-dl-progress" max={p.totalBytes || undefined} value={p.totalBytes ? p.loadedBytes : undefined} aria-label={t('audio.downloads.title')} />}
      <p class="audio-downloads__status" role="status" aria-live="polite" data-testid="audio-dl-status">{progressText}</p>
    </div>
  );
}
