/**
 * Which Bible pane asked for audio last, so a notice that arrives with nothing playing ("no audio for this
 * translation") is shown in that pane's strip and not in every pane. The Listen button records it; a keyboard
 * shortcut path can call `markAudioRequestedPane(panelId)` too. A pane that is not on screen (closed) does not
 * count: the first pane with a bar shows the notice then.
 */
let requested: string | null = null;
const mounted = new Set<string>();

export function markAudioRequestedPane(panelId: string | null): void {
  requested = panelId;
}

export function registerAudioBarPane(panelId: string): () => void {
  mounted.add(panelId);
  return () => { mounted.delete(panelId); };
}

/** Should this pane show the idle notice strip? */
export function showsIdleNotice(panelId: string): boolean {
  if (requested && mounted.has(requested)) return requested === panelId;
  return mounted.values().next().value === panelId;
}
