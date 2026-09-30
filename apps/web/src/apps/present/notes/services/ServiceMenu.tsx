import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { getServiceStore, type Service, type ServiceStore } from './serviceStore';
import './services.css';

export interface ServiceMenuProps {
  /** The service currently in the editor. */
  currentId: string | null;
  /** Called when the user opens, creates or duplicates: load `service.doc` into the editor. */
  onSelect: (service: Service) => void;
  /** Called after the open service was deleted (services.length may be 0: the host then opens/creates one). */
  onDeleted?: (id: string) => void;
  store?: ServiceStore;
}

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'rename'; id: string };

/** App-bar dropdown: open, new, duplicate, rename, delete. */
export function ServiceMenu({ currentId, onSelect, onDeleted, store = getServiceStore() }: ServiceMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [draft, setDraft] = useState('');
  const [, force] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void store.ready();
    return store.subscribe(() => force((n) => n + 1));
  }, [store]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setMode({ kind: 'list' });
  };

  const services = store.list();
  const current = currentId ? store.get(currentId) : undefined;

  const choose = async (id: string) => {
    await store.flush();
    const s = store.open(id);
    if (s) onSelect(s);
    close();
  };

  const submit = async () => {
    const name = draft.trim();
    if (mode.kind === 'new') {
      await store.flush();
      onSelect(await store.create({ name: name || undefined }));
    } else if (mode.kind === 'rename' && name) {
      await store.rename(mode.id, name);
    }
    setDraft('');
    close();
  };

  const duplicate = async (id: string) => {
    const copy = await store.duplicate(id);
    if (copy) onSelect(copy);
    close();
  };

  const remove = async (s: Service) => {
    if (!window.confirm(t('present.services.confirmDelete', { name: s.name }))) return;
    await store.remove(s.id);
    onDeleted?.(s.id);
  };

  return (
    <div class="service-menu" ref={root}>
      <button
        type="button"
        class="service-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span class="service-menu__name">{current?.name ?? t('present.services.none')}</span>
        <i class="fa-solid fa-chevron-down" aria-hidden="true" />
      </button>
      {open && (
        <div class="service-menu__panel" role="menu">
          {mode.kind === 'list' ? (
            <>
              <ul class="service-menu__list">
                {services.map((s) => (
                  <li key={s.id} class={`service-menu__row${s.id === currentId ? ' is-current' : ''}`}>
                    <button type="button" role="menuitem" class="service-menu__open" onClick={() => void choose(s.id)}>
                      <span class="service-menu__row-name">{s.name}</span>
                      <span class="service-menu__row-date">{s.date}</span>
                    </button>
                    <button
                      type="button"
                      class="service-menu__icon"
                      title={t('present.services.rename')}
                      aria-label={t('present.services.rename')}
                      onClick={() => {
                        setDraft(s.name);
                        setMode({ kind: 'rename', id: s.id });
                      }}
                    >
                      <i class="fa-solid fa-pen" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      class="service-menu__icon"
                      title={t('present.services.duplicate')}
                      aria-label={t('present.services.duplicate')}
                      onClick={() => void duplicate(s.id)}
                    >
                      <i class="fa-regular fa-copy" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      class="service-menu__icon"
                      title={t('present.services.delete')}
                      aria-label={t('present.services.delete')}
                      onClick={() => void remove(s)}
                    >
                      <i class="fa-solid fa-trash" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                role="menuitem"
                class="service-menu__new"
                onClick={() => {
                  setDraft('');
                  setMode({ kind: 'new' });
                }}
              >
                <i class="fa-solid fa-plus" aria-hidden="true" /> {t('present.services.new')}
              </button>
              {!store.persistent && <p class="service-menu__warn">{t('present.services.notSaved')}</p>}
            </>
          ) : (
            <form
              class="service-menu__form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <input
                type="text"
                value={draft}
                placeholder={t('present.services.namePlaceholder')}
                aria-label={t('present.services.name')}
                onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
                ref={(el) => el?.focus()}
              />
              <button type="submit">{mode.kind === 'new' ? t('present.services.create') : t('present.services.save')}</button>
              <button type="button" onClick={() => setMode({ kind: 'list' })}>
                {t('present.services.cancel')}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
