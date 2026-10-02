import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import type { HymnSummary } from '../../../present/hymns';
import { searchHymns } from '../../../present/command/searchProviders';
import { notesStore, type ChooserTarget } from './notesStore';
import { buildVerseOrder } from './verseOrder';

const DEBOUNCE_MS = 180;

/**
 * The chooser popover: opened by clicking an amber item, a hymn, an amber
 * highlight, or "+ Insert > Hymn". Search a hymn, pick its verses, optionally
 * a refrain after each, and save; the choice becomes a `pin` mark on the
 * text (see row 7). "Not a hymn" / "Not a reference" applies `unlink`.
 */
export function ItemChooser({ target }: { target: ChooserTarget }) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);

  const item = target.mode === 'item' ? notesStore.itemById(target.id) : undefined;
  const highlight = target.mode === 'highlight' ? notesStore.highlightById(target.id) : undefined;
  const currentHymnId = item?.item?.kind === 'hymn' ? item.item.hymnId : undefined;
  const wantsHymn = target.mode === 'insert' || item?.kind === 'hymn';

  const [query, setQuery] = useState(() => (item?.kind === 'hymn' && !item.candidates?.length ? item.label.replace(/^hymn\s+/i, '') : ''));
  const [results, setResults] = useState<HymnSummary[]>([]);
  const [chosen, setChosen] = useState<HymnSummary | undefined>(() => (currentHymnId ? notesStore.hymnById(currentHymnId) : undefined));
  const [selected, setSelected] = useState<number[]>([]);
  const [refrain, setRefrain] = useState(false);

  // Seed verse toggles from the hymn (or the current item's order) whenever the hymn changes.
  useEffect(() => {
    if (!chosen) return;
    const order = item?.item?.kind === 'hymn' && item.item.hymnId === chosen.id ? item.item.verseOrder : undefined;
    const verses = order ? order.filter((tok) => /^\d+$/.test(tok)).map(Number) : [];
    setSelected(verses.length ? [...new Set(verses)] : Array.from({ length: chosen.verseCount }, (_, i) => i + 1));
    setRefrain(order ? order.includes('R') : false);
  }, [chosen?.id]);

  useEffect(() => {
    if (!wantsHymn) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchHymns(query)
        .then((hymns) => {
          if (cancelled) return;
          const first = (item?.candidates ?? []).map((id) => notesStore.hymnById(id)).filter((h): h is HymnSummary => !!h);
          setResults(query ? hymns : first.length ? first : hymns);
        })
        .catch(() => { if (!cancelled) setResults([]); });
    }, query ? DEBOUNCE_MS : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, wantsHymn]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) notesStore.closeChooser();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && notesStore.closeChooser();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, []);

  const toggleVerse = (n: number) =>
    setSelected((cur) => (cur.includes(n) ? cur.filter((v) => v !== n) : [...cur, n]));

  const save = () => {
    if (!chosen || selected.length === 0) return;
    const verseOrder = buildVerseOrder(chosen.verseCount, chosen.hasRefrain, selected, refrain);
    const pinned = { kind: 'hymn' as const, hymnId: chosen.id, ...(verseOrder ? { verseOrder } : {}) };
    if (target.mode === 'insert') notesStore.insertItem(pinned, chosen.title);
    else if (target.mode === 'item') notesStore.pinItem(target.id, pinned);
  };

  const reason = item?.status === 'choose' ? item.reason : highlight?.status === 'choose' ? highlight.reason : undefined;

  // Below the clicked text, kept inside the viewport.
  const style = {
    // rtl-physical: anchored to a measured viewport rect (getBoundingClientRect)
    left: `${Math.max(8, Math.min(target.anchor.left, window.innerWidth - 340))}px`,
    top: `${Math.min(target.anchor.bottom + 6, window.innerHeight - 120)}px`,
  };

  return (
    <div class="pn-chooser" ref={root} style={style} role="dialog" aria-label={t('present.notes.chooser.title')}>
      {reason && <p class="pn-chooser__reason">{t(reason.key, reason.params)}</p>}

      {wantsHymn && (
        <>
          <input
            class="pn-chooser__search"
            type="search"
            value={query}
            autoFocus
            placeholder={t('present.hymnSearchPlaceholder')}
            aria-label={t('present.hymnSearchPlaceholder')}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
          <ul class="pn-chooser__list">
            {results.slice(0, 8).map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  class={`pn-chooser__hymn${chosen?.id === h.id ? ' is-chosen' : ''}`}
                  onClick={() => setChosen(h)}
                >
                  <span>{h.title}</span>
                  {h.hymnals.length > 0 && <span class="pn-chooser__num">{h.hymnals.map((r) => r.number).join(', ')}</span>}
                </button>
              </li>
            ))}
          </ul>

          {chosen && (
            <div class="pn-chooser__verses">
              <div class="pn-chooser__label">{t('present.notes.chooser.verses')}</div>
              <div class="pn-chooser__toggles">
                {Array.from({ length: chosen.verseCount }, (_, i) => i + 1).map((n) => (
                  <button
                    type="button"
                    key={n}
                    class={`pn-chooser__toggle${selected.includes(n) ? ' is-on' : ''}`}
                    aria-pressed={selected.includes(n)}
                    onClick={() => toggleVerse(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              {chosen.hasRefrain && (
                <label class="pn-chooser__check">
                  <input type="checkbox" checked={refrain} onChange={(e) => setRefrain((e.target as HTMLInputElement).checked)} />
                  {t('present.notes.chooser.refrainAfterEach')}
                </label>
              )}
              <button type="button" class="pn-chooser__save" disabled={selected.length === 0} onClick={save}>
                {target.mode === 'insert' ? t('present.notes.chooser.insert') : t('present.notes.chooser.use')}
              </button>
            </div>
          )}
        </>
      )}

      {target.mode === 'item' && (
        <button type="button" class="pn-chooser__not" onClick={() => notesStore.unlinkItem(target.id)}>
          {item?.kind === 'hymn' ? t('present.notes.chooser.notHymn') : t('present.notes.chooser.notReference')}
        </button>
      )}
      {target.mode === 'highlight' && (
        <button type="button" class="pn-chooser__not" onClick={() => notesStore.dismissHighlight(target.id)}>
          {t('present.notes.chooser.notHighlight')}
        </button>
      )}
    </div>
  );
}
