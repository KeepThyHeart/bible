import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';

type Theme = 'light' | 'dark' | 'sepia';

const OPTIONS: { value: Theme; label: string; icon: string }[] = [
  { value: 'light', label: 'themes.light', icon: 'fa-sun' },
  { value: 'dark', label: 'themes.dark', icon: 'fa-moon' },
  { value: 'sepia', label: 'themes.sepia', icon: 'fa-mug-hot' },
];

interface LandscapeThemeMenuProps {
  theme: string;
  onSelect: (theme: Theme) => void;
  /** The "More..." item: the caller opens Settings. */
  onMore: () => void;
}

/**
 * The theme picker of the landscape phone sidebar. A small non-modal popup (same behaviour as the
 * header's): it takes focus when it opens, closes on a press or focus outside it or on Escape, and
 * hands focus back to its button when it closes from inside.
 */
export function LandscapeThemeMenu({ theme, onSelect, onMore }: LandscapeThemeMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const themeIcon = theme === 'dark' ? 'fa-moon' : theme === 'sepia' ? 'fa-mug-hot' : 'fa-sun';

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      const box = boxRef.current;
      (box?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? box?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
      const onPointerDown = (e: PointerEvent) => {
        if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
      };
      document.addEventListener('pointerdown', onPointerDown, true);
      return () => document.removeEventListener('pointerdown', onPointerDown, true);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      const active = document.activeElement;
      if (!active || active === document.body) buttonRef.current?.focus({ preventScroll: true });
    }
    return undefined;
  }, [open]);

  return (
    <div
      class="mobile-landscape-sidebar__theme-wrapper"
      ref={wrapperRef}
      onFocusOut={(e) => {
        const next = (e as FocusEvent).relatedTarget as Node | null;
        if (open && next && !wrapperRef.current?.contains(next)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        class="mobile-landscape-sidebar__action-btn"
        onClick={() => setOpen(!open)}
        title={t('header.theme')}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <i class={`fa-solid ${themeIcon}`} />
      </button>
      {open && (
        <div class="mobile-landscape-sidebar__theme-dropdown" ref={boxRef} role="dialog" aria-label={t('header.theme')}>
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={theme === opt.value}
              class={`mobile-landscape-sidebar__theme-option ${theme === opt.value ? 'mobile-landscape-sidebar__theme-option--active' : ''}`}
              onClick={() => {
                onSelect(opt.value);
                setOpen(false);
              }}
            >
              <i class={`fa-solid ${opt.icon}`} /> {t(opt.label)}
            </button>
          ))}
          <button
            type="button"
            class="mobile-landscape-sidebar__theme-option"
            onClick={() => {
              setOpen(false);
              onMore();
            }}
          >
            <i class="fa-solid fa-palette" /> {t('header.more')}
          </button>
        </div>
      )}
    </div>
  );
}
