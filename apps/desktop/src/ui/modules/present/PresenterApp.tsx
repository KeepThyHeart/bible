/**
 * The Presenter app (task 0198): the desktop is the controller; a page served from a small
 * localhost server (main process, `electron/modules/present/`) is the screen. This view starts and
 * stops the server, shows its address, and drives what the screen shows. All state lives in main,
 * so the view just re-reads it when it opens.
 */
import React from 'react';
import { useI18n } from '../../contexts/useI18n';
import { translateWithDefault } from '../../utils/translateWithDefault';
import { PaneToolbar, PaneToolbarButton } from '../../components/shared/PaneToolbar';
import { bibleAPI } from '../../services/electronAPI';
import { useModuleNamespace } from '../host/useModuleNamespace';
import { presentClient } from './presentClient';
import type { PresentStatus } from '../../../../electron/modules/present/types';

interface BibleOption {
  abbreviation: string;
  name: string;
}
interface BookOption {
  book_number: number;
  book_name: string;
  chapter_count: number;
}

const INPUT =
  'rounded border border-border bg-background px-sm py-xs text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const BUTTON =
  'rounded border border-border bg-transparent px-md py-xs text-sm hover:bg-background-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40';
const PRIMARY =
  'rounded bg-accent px-md py-xs text-sm font-medium text-accent-foreground hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40';

function qrDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function useStatus(): [PresentStatus | null, (s: PresentStatus) => void] {
  const [status, setStatus] = React.useState<PresentStatus | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    presentClient.status().then((s) => { if (!cancelled) setStatus(s); }).catch(() => {});
    const off = presentClient.on('changed', (s) => setStatus(s));
    return () => { cancelled = true; off(); };
  }, []);
  return [status, setStatus];
}

export const PresenterApp: React.FC = () => {
  const { t } = useI18n();
  const ready = useModuleNamespace('present');
  const tr = React.useCallback((key: string, fallback: string) => translateWithDefault(t, `present.${key}`, fallback), [t]);
  const [status, setStatus] = useStatus();
  const [error, setError] = React.useState<string | null>(null);
  const [lan, setLan] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const [bibles, setBibles] = React.useState<BibleOption[]>([]);
  const [books, setBooks] = React.useState<BookOption[]>([]);
  const [module, setModule] = React.useState('');
  const [book, setBook] = React.useState(43);
  const [chapter, setChapter] = React.useState(3);
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [bs, bk] = await Promise.all([bibleAPI.getAvailableBibles(), bibleAPI.getAllBooks()]);
        if (cancelled) return;
        const options = (bs as Array<{ abbreviation: string; name: string }>).map((b) => ({ abbreviation: b.abbreviation, name: b.name }));
        setBibles(options);
        setBooks(bk as BookOption[]);
        setModule((m) => m || options[0]?.abbreviation || '');
      } catch {
        /* the pickers stay empty; Show reports the problem */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Follow the running passage when the app opens mid-presentation.
  const requestKey = status?.request ? `${status.request.module}/${status.request.book}/${status.request.chapter}` : '';
  React.useEffect(() => {
    const r = status?.request;
    if (!r) return;
    setModule(r.module);
    setBook(r.book);
    setChapter(r.chapter);
    setFrom(r.verseStart ? String(r.verseStart) : '');
    setTo(r.verseEnd ? String(r.verseEnd) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const run = React.useCallback(async (action: () => Promise<PresentStatus | void>) => {
    setError(null);
    setBusy(true);
    try {
      const next = await action();
      if (next) setStatus(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [setStatus]);

  if (!ready || !status) return <div className="h-full bg-background" data-testid="present-loading" />;

  const { running, server, snapshot } = status;
  const live = snapshot.live;
  const chapterCount = books.find((b) => b.book_number === book)?.chapter_count ?? 150;

  const show = () => run(() => presentClient.setPassage({
    module,
    book,
    chapter,
    ...(from ? { verseStart: Number(from) } : {}),
    ...(to ? { verseEnd: Number(to) } : {}),
  }));

  const copy = async () => {
    if (!server) return;
    try {
      await navigator.clipboard.writeText(server.lan && server.lanUrls[0] ? server.lanUrls[0] : server.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the address is selectable in the field */
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-background text-text-primary" data-app="present" data-testid="present-app" aria-label={tr('title', 'Presenter')}>
      <PaneToolbar
        ariaLabel={tr('toolbar', 'Presenter controls')}
        testId="present-toolbar"
        trailing={running ? (
          <>
            <PaneToolbarButton divider="start" label={tr('openBrowser', 'Open in browser')} onClick={() => void run(() => presentClient.openInBrowser())} testId="present-open-browser">
              {tr('openBrowserShort', 'Browser')}
            </PaneToolbarButton>
            <PaneToolbarButton divider="start" label={tr('openWindow', 'Open in a new window (second display if there is one)')} onClick={() => void run(() => presentClient.openInWindow())} testId="present-open-window">
              {tr('openWindowShort', 'New window')}
            </PaneToolbarButton>
          </>
        ) : undefined}
      >
        {running ? (
          <>
            <PaneToolbarButton label={tr('stop', 'Stop presenting')} onClick={() => void run(() => presentClient.stop())} testId="present-stop">
              {tr('stopShort', 'Stop')}
            </PaneToolbarButton>
            <PaneToolbarButton label={tr('prev', 'Previous verse')} disabled={!live} onClick={() => void run(() => presentClient.step(-1))} testId="present-prev">
              {tr('prevShort', '← Previous')}
            </PaneToolbarButton>
            <PaneToolbarButton label={tr('next', 'Next verse')} disabled={!live} onClick={() => void run(() => presentClient.step(1))} testId="present-next">
              {tr('nextShort', 'Next →')}
            </PaneToolbarButton>
            <PaneToolbarButton label={snapshot.display.blanked ? tr('unblank', 'Show the screen again') : tr('blank', 'Blank the screen')} onClick={() => void run(() => presentClient.setDisplay({ blanked: !snapshot.display.blanked }))} testId="present-blank">
              {snapshot.display.blanked ? tr('unblankShort', 'Unblank') : tr('blankShort', 'Blank')}
            </PaneToolbarButton>
            <PaneToolbarButton label={tr('smaller', 'Smaller text')} onClick={() => void run(() => presentClient.setDisplay({ fontStep: snapshot.display.fontStep - 1 }))} testId="present-smaller">A-</PaneToolbarButton>
            <PaneToolbarButton label={tr('larger', 'Larger text')} onClick={() => void run(() => presentClient.setDisplay({ fontStep: snapshot.display.fontStep + 1 }))} testId="present-larger">A+</PaneToolbarButton>
            <PaneToolbarButton label={tr('theme', 'Switch light/dark screen')} onClick={() => void run(() => presentClient.setDisplay({ theme: snapshot.display.theme === 'dark' ? 'light' : 'dark' }))} testId="present-theme">
              {snapshot.display.theme === 'dark' ? tr('themeLight', 'Light') : tr('themeDark', 'Dark')}
            </PaneToolbarButton>
          </>
        ) : (
          <PaneToolbarButton label={tr('start', 'Start presenting')} onClick={() => void run(() => presentClient.start({ lan }))} testId="present-start">
            {tr('startShort', 'Start presenting')}
          </PaneToolbarButton>
        )}
      </PaneToolbar>

      <div className="min-h-0 flex-1 overflow-auto p-md">
        <div className="mx-auto flex max-w-3xl flex-col gap-md">
          {error && <div role="alert" className="rounded border border-border p-sm text-sm text-danger" data-testid="present-error">{error}</div>}

          {!running ? (
            <div className="flex flex-col gap-sm" data-testid="present-intro">
              <h2 className="m-0 text-lg font-semibold text-text-heading">{tr('introTitle', 'Show Scripture on a second screen')}</h2>
              <p className="m-0 text-sm text-text-secondary">
                {tr('introBody', 'Presenting starts a small web page on this computer. Open it in a browser or a new window on a projector or second display; it follows what you choose here.')}
              </p>
              <label className="flex items-start gap-sm text-sm">
                <input type="checkbox" checked={lan} onChange={(e) => setLan(e.target.checked)} data-testid="present-lan" />
                <span>{tr('lanOption', 'Also allow other devices on my local network (a TV or projector computer)')}</span>
              </label>
              {lan && <p className="m-0 text-sm text-warning" role="note">{tr('lanWarning', 'Anyone on this network who has the address can watch. The address contains a secret and travels unencrypted; share it only with the device you mean, and avoid public Wi-Fi.')}</p>}
              <div><button type="button" className={PRIMARY} onClick={() => void run(() => presentClient.start({ lan }))} disabled={busy} data-testid="present-start-main">{tr('startShort', 'Start presenting')}</button></div>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-sm rounded border border-border bg-surface p-md" data-testid="present-address">
                <div className="flex items-center gap-sm">
                  <input readOnly className={`${INPUT} min-w-0 flex-1`} value={server?.url ?? ''} aria-label={tr('address', 'Screen address')} onFocus={(e) => e.currentTarget.select()} data-testid="present-url" />
                  <button type="button" className={BUTTON} onClick={() => void copy()}>{copied ? tr('copied', 'Copied') : tr('copy', 'Copy')}</button>
                </div>
                <p className="m-0 text-xs text-text-secondary">
                  {snapshot.viewerCount === 0
                    ? tr('noScreens', 'No screen connected yet. Open the address above in a browser, or use the buttons at the top right.')
                    : snapshot.viewerCount === 1 ? tr('oneScreen', '1 screen connected.') : tr('manyScreens', '{n} screens connected.').replace('{n}', String(snapshot.viewerCount))}
                </p>
                <label className="flex items-start gap-sm text-sm">
                  <input type="checkbox" checked={server?.lan ?? false} onChange={(e) => void run(() => presentClient.start({ lan: e.target.checked }))} disabled={busy} data-testid="present-lan-live" />
                  <span>{tr('lanOption', 'Also allow other devices on my local network (a TV or projector computer)')}</span>
                </label>
                {server?.lan && (
                  <div className="flex items-start gap-md" data-testid="present-lan-panel">
                    <img src={qrDataUrl(server.qrSvg)} alt={tr('qrAlt', 'QR code for the screen address on the local network')} width={132} height={132} className="rounded bg-white" data-testid="present-qr" />
                    <div className="flex min-w-0 flex-col gap-xs text-sm">
                      <p className="m-0 text-warning" role="note">{tr('lanWarning', 'Anyone on this network who has the address can watch. The address contains a secret and travels unencrypted; share it only with the device you mean, and avoid public Wi-Fi.')}</p>
                      {server.lanUrls.length === 0
                        ? <p className="m-0 text-text-secondary">{tr('noLan', 'No network connection was found.')}</p>
                        : server.lanUrls.map((u) => <code key={u} className="break-all text-xs" data-testid="present-lan-url">{u}</code>)}
                    </div>
                  </div>
                )}
              </div>

              <form className="flex flex-wrap items-end gap-sm" onSubmit={(e) => { e.preventDefault(); void show(); }} data-testid="present-picker" aria-label={tr('pick', 'Choose a passage')}>
                <label className="flex flex-col gap-xs text-xs text-text-secondary">{tr('bible', 'Bible')}
                  <select className={INPUT} value={module} onChange={(e) => setModule(e.target.value)} data-testid="present-module">
                    {bibles.map((b) => <option key={b.abbreviation} value={b.abbreviation}>{b.abbreviation}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-xs text-xs text-text-secondary">{tr('book', 'Book')}
                  <select className={INPUT} value={book} onChange={(e) => { setBook(Number(e.target.value)); setChapter(1); setFrom(''); setTo(''); }} data-testid="present-book">
                    {books.map((b) => <option key={b.book_number} value={b.book_number}>{b.book_name}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-xs text-xs text-text-secondary">{tr('chapter', 'Chapter')}
                  <input className={`${INPUT} w-20`} type="number" min={1} max={chapterCount} value={chapter} onChange={(e) => setChapter(Math.max(1, Number(e.target.value) || 1))} data-testid="present-chapter" />
                </label>
                <label className="flex flex-col gap-xs text-xs text-text-secondary">{tr('fromVerse', 'From verse')}
                  <input className={`${INPUT} w-20`} type="number" min={1} placeholder={tr('all', 'all')} value={from} onChange={(e) => setFrom(e.target.value)} data-testid="present-from" />
                </label>
                <label className="flex flex-col gap-xs text-xs text-text-secondary">{tr('toVerse', 'To verse')}
                  <input className={`${INPUT} w-20`} type="number" min={1} placeholder={tr('all', 'all')} value={to} onChange={(e) => setTo(e.target.value)} data-testid="present-to" />
                </label>
                <button type="submit" className={PRIMARY} disabled={!module} data-testid="present-show">{tr('show', 'Show on screen')}</button>
              </form>

              {live ? (
                <div className="flex flex-col gap-xs" data-testid="present-preview">
                  <h2 className="m-0 text-base font-semibold text-text-heading" data-testid="present-reference">{live.reference}</h2>
                  <ol className="m-0 flex list-none flex-col gap-xs p-0">
                    {live.verses.map((v) => (
                      <li key={v.verse}>
                        <button
                          type="button"
                          onClick={() => void run(() => presentClient.focusVerse(v.verse))}
                          aria-current={v.verse === live.focus ? 'true' : undefined}
                          data-testid={`present-verse-${v.verse}`}
                          className={`w-full rounded border px-sm py-xs text-start text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${v.verse === live.focus ? 'border-accent bg-background-hover' : 'border-transparent hover:bg-background-hover'}`}
                        >
                          <sup className="me-xs text-text-secondary">{v.verse}</sup>{v.text}
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <p className="m-0 text-sm text-text-secondary" data-testid="present-empty">{tr('nothingShown', 'Nothing is on the screen yet. Choose a passage and press Show on screen.')}</p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
};

export default PresenterApp;
