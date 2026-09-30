/**
 * Keyboard shortcuts for audio, registered with the small keydown registry below (the app has no global one):
 *
 *   Alt+P               play / pause (starts reading the selected verse when idle)
 *   Alt+Left / Alt+Right          previous / next verse
 *   Alt+Shift+Left / Right        previous / next chapter
 *
 * The four arrow shortcuts act only while audio is active, so Alt+Left keeps
 * meaning "browser back" the rest of the time, and never while typing in a field.
 * Checked against the existing bindings: the app's own shortcuts use Ctrl/Cmd and
 * `/`, none use Alt. (On macOS Option+P types a different character, so Alt+P works
 * on Windows and Linux only; the transport bar has the same actions as buttons.)
 */

export interface KeyBinding {
  id: string;
  /** Key combo such as `alt+p` or `alt+shift+arrowleft` (lower case). */
  key: string;
  label: string;
  handler(): void;
  /** Only active while this returns true. */
  when?(): boolean;
}

/**
 * A minimal shortcut registry over one `keydown` listener. The app has no global
 * keybinding registry, so audio owns its five keys; `dispose()` removes the listener.
 */
export function createKeybindingRegistry(target: Pick<Document, 'addEventListener' | 'removeEventListener'> = document): ShortcutRegistry & { dispose(): void } {
  const bindings = new Map<string, KeyBinding>();
  const onKeyDown = (e: Event) => {
    const ev = e as KeyboardEvent;
    for (const b of bindings.values()) {
      const parts = b.key.split('+');
      if (ev.key.toLowerCase() !== parts[parts.length - 1]) continue;
      if (ev.ctrlKey !== parts.includes('ctrl') || ev.metaKey !== (parts.includes('meta') || parts.includes('cmd'))
        || ev.shiftKey !== parts.includes('shift') || ev.altKey !== parts.includes('alt')) continue;
      if (b.when && !b.when()) continue;
      ev.preventDefault();
      b.handler();
      return;
    }
  };
  target.addEventListener('keydown', onKeyDown);
  return {
    register(binding) { bindings.set(binding.id, binding); return () => { bindings.delete(binding.id); }; },
    dispose() { target.removeEventListener('keydown', onKeyDown); bindings.clear(); },
  };
}

export interface ShortcutRegistry {
  register(binding: KeyBinding): () => void;
}

export interface ShortcutTarget {
  readonly enabled: boolean;
  readonly status: string;
  togglePlay(): void;
  seekVerse(delta: 1 | -1): void;
  seekChapter(delta: 1 | -1): void;
}

const isTextEntry = (el: Element | null): boolean =>
  !!el && (el instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(el.type)
    || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable === true);

export function registerAudioShortcuts(registry: ShortcutRegistry, audio: ShortcutTarget): () => void {
  const active = () => audio.enabled && audio.status !== 'idle' && !isTextEntry(document.activeElement);
  const offs = [
    registry.register({ id: 'audio.toggle', key: 'alt+p', label: 'Play or pause audio', when: () => audio.enabled, handler: () => audio.togglePlay() }),
    registry.register({ id: 'audio.prevVerse', key: 'alt+arrowleft', label: 'Previous verse (audio)', when: active, handler: () => audio.seekVerse(-1) }),
    registry.register({ id: 'audio.nextVerse', key: 'alt+arrowright', label: 'Next verse (audio)', when: active, handler: () => audio.seekVerse(1) }),
    registry.register({ id: 'audio.prevChapter', key: 'alt+shift+arrowleft', label: 'Previous chapter (audio)', when: active, handler: () => audio.seekChapter(-1) }),
    registry.register({ id: 'audio.nextChapter', key: 'alt+shift+arrowright', label: 'Next chapter (audio)', when: active, handler: () => audio.seekChapter(1) }),
  ];
  return () => { for (const off of offs) off(); };
}
