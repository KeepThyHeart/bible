/** The playback speed: a button showing the rate ("1.25×"); pressing it opens a pop-up of the speeds the current source supports. */

import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { Popover } from '@bible/ui';
import { audioStore } from '../../stores/audioStore';
import { useStore } from '../../hooks/useStore';
import { RATE_PRESETS, effectiveRate } from '../../audio/audioPrefs';
import { formatRate } from './AudioControls';

export function AudioSpeedControl({ large }: { large?: boolean }) {
  const { t } = useTranslation();
  const rate = useStore(audioStore, () => audioStore.prefs.rate);
  const range = useStore(audioStore, () => audioStore.capabilities?.rate ?? null);
  const shown = range ? effectiveRate(rate, { rate: range }) : rate;
  const options = range ? RATE_PRESETS.filter(r => r >= range.min - 1e-9 && r <= range.max + 1e-9) : [];
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  // No speed range (nothing playing, or a source without speed control): nothing to choose.
  useEffect(() => { if (!range) setOpen(false); }, [range]);

  const listRef = useRef<HTMLUListElement>(null);
  // Put focus on the current speed once the pop-up has taken it (its own focus move runs first).
  useEffect(() => {
    if (!open) return;
    const h = requestAnimationFrame(() => {
      const opts = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
      (opts && Array.from(opts).find(o => o.getAttribute('aria-selected') === 'true') || opts?.[0])?.focus();
    });
    return () => cancelAnimationFrame(h);
  }, [open]);

  const onListKey = (e: KeyboardEvent) => {
    const opts = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const i = opts.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); opts[Math.min(opts.length - 1, Math.max(0, n))]?.focus(); };
    switch (e.key) {
      case 'ArrowDown': return go(i + 1);
      case 'ArrowUp': return go(i < 0 ? 0 : i - 1);
      case 'Home': return go(0);
      case 'End': return go(opts.length - 1);
      case 'Escape': // close the list only: not the phone player behind it
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        btnRef.current?.focus();
    }
  };

  const pick = (r: number) => {
    audioStore.setPrefs({ rate: r });
    setOpen(false);
    btnRef.current?.focus();
  };

  return (
    <div class={`audio-speed${large ? ' audio-speed--large' : ''}`} data-testid="audio-speed">
      <span class="audio-speed__sr" role="status" aria-live="polite">{range ? formatRate(shown) : ''}</span>
      <button
        type="button"
        ref={btnRef}
        class="audio-speed__btn"
        disabled={!range}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t('audio.speed.label')}
        aria-label={`${t('audio.speed.label')}: ${formatRate(shown)}`}
        data-testid="audio-speed-button"
        onClick={() => setOpen(o => !o)}
      >
        {formatRate(shown)}
      </button>
      <Popover
        open={open && options.length > 0}
        anchor={open && btnRef.current ? btnRef.current.getBoundingClientRect() : null}
        onClose={() => setOpen(false)}
        label={t('audio.speed.label')}
        width={148}
        estimatedHeight={options.length * 38 + 12}
        align="center"
        autoFocus
        className="audio-popover audio-speed__menu"
        insideRefs={[btnRef]}
      >
        <ul class="audio-speed__list" role="listbox" aria-label={t('audio.speed.label')} ref={listRef} onKeyDown={onListKey}>
          {options.map(r => (
            <li key={r} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={Math.abs(r - shown) < 1e-9}
                class={`audio-speed__opt${Math.abs(r - shown) < 1e-9 ? ' audio-speed__opt--on' : ''}`}
                onClick={() => pick(r)}
              >
                {formatRate(r)}
              </button>
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  );
}
