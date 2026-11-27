/**
 * The desktop wiring of the downloads picker: translations that have recordings, the shared model over the
 * main-process store, and `ensureText` through the module manager's install queue.
 */
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AudioDownloadsModel } from '@bible/audio';
import type { IAudioDownloadStore } from '@bible/audio';
import { MAX_CHAPTERS, getBookName } from '@bible/core/browser';
import { useModuleStore } from '../../../stores/useModuleStore';
import { useI18n } from '../../../contexts/useI18n';
import { audioClient } from '../audioClient';
import { createDesktopDownloadStore } from './desktopDownloadStore';
import { getDesktopRecordings, subscribeDesktopRecordings } from './recordingsHandle';
import type { DesktopRecordings } from './recordingsHandle';
import { AudioDownloadsPanel, OFFLINE_ERROR } from './AudioDownloadsPanel';

/** Chapters in a book (canonical counts; 0 when unknown). */
export const chapterCount = (book: number): number => MAX_CHAPTERS[book] ?? 0;

const isOffline = (e: unknown) => {
  const code = (e as { code?: string } | null)?.code;
  return code === 'offline' || code === 'network_blocked';
};

/** The store with the network switch's refusal reported as one recognisable error. */
export function offlineAware(store: IAudioDownloadStore): IAudioDownloadStore {
  return {
    present: (urls) => store.present(urls),
    remove: (urls) => store.remove(urls),
    freeBytes: () => store.freeBytes(),
    ...(store.persist ? { persist: () => store.persist!() } : {}),
    async fetch(files, opts) {
      try { await store.fetch(files, opts); } catch (e) { throw isOffline(e) ? Object.assign(new Error(OFFLINE_ERROR), { code: 'offline' }) : e; }
    },
  };
}

interface TextInstaller {
  isInstalled(abbr: string): boolean;
  catalogId(abbr: string): string | undefined;
  start(catalogId: string): Promise<void>;
  /** Reload the installed list. */
  reload(): Promise<void>;
}

/**
 * Make sure a translation's text is on the device: a no-op when it is installed, otherwise queue the module
 * install and wait for it (aborting stops waiting; the install itself carries on in the queue).
 */
export async function ensureModuleText(module: string, signal: AbortSignal, installer: TextInstaller, pollMs = 500): Promise<void> {
  if (installer.isInstalled(module)) return;
  const id = installer.catalogId(module);
  if (!id) throw new Error(`The text of ${module} is not available to install.`);
  try { await installer.start(id); } catch (e) { throw isOffline(e) ? Object.assign(new Error(OFFLINE_ERROR), { code: 'offline' }) : e; }
  for (let i = 0; i < 1200; i++) { // up to ~10 minutes
    if (signal.aborted) throw Object.assign(new Error('aborted'), { code: 'aborted' });
    await installer.reload();
    if (installer.isInstalled(module)) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`The text of ${module} did not finish installing.`);
}

const desktopInstaller: TextInstaller = {
  isInstalled: (abbr) => useModuleStore.getState().installedModules.some((m) => m.abbreviation === abbr), // allow-getstate: not render
  catalogId: (abbr) => useModuleStore.getState().availableModules.find((m) => m.abbreviation === abbr && m.module_type === 'bible')?.module_id, // allow-getstate: not render
  start: (id) => useModuleStore.getState().startInstall(id), // allow-getstate: not render
  reload: () => useModuleStore.getState().loadInstalledModules(), // allow-getstate: not render
};

const canPlay = (mime: string): boolean => {
  try { return document.createElement('audio').canPlayType(mime) !== ''; } catch { return false; }
};

export const AudioDownloads: React.FC = () => {
  const { t } = useI18n();
  const recordings = useSyncExternalStore(subscribeDesktopRecordings, getDesktopRecordings);
  const installed = useModuleStore((s) => s.installedModules);
  const catalog = useModuleStore((s) => s.availableModules);
  const [withAudio, setWithAudio] = useState<{ abbreviation: string; name?: string }[] | null>(null);

  // Installed Bibles first, then catalog Bibles not installed yet (their text is downloaded with the audio).
  const bibles = useMemo(() => {
    const out = new Map<string, { abbreviation: string; name?: string }>();
    for (const m of installed) if (m.module_type === 'bible') out.set(m.abbreviation, { abbreviation: m.abbreviation, name: m.name });
    for (const m of catalog) if (m.module_type === 'bible' && !out.has(m.abbreviation)) out.set(m.abbreviation, { abbreviation: m.abbreviation, name: m.name });
    return [...out.values()];
  }, [installed, catalog]);
  // The lists are new arrays on every reload (every 500 ms during a text install): probe only when the set changes.
  const biblesKey = bibles.map((m) => m.abbreviation).join('\n');
  const biblesRef = useRef(bibles);
  biblesRef.current = bibles;

  // The installed list is otherwise loaded only when the Module Manager opens: Preferences must not depend on that.
  useEffect(() => { void desktopInstaller.reload(); }, []);

  // Only translations that have recordings are offered.
  useEffect(() => {
    if (!recordings) { setWithAudio([]); return; }
    let live = true;
    const ctl = new AbortController();
    // A few lookups at a time: the catalog can list many Bibles (each a small index.json, 404 when none).
    const probe = async () => {
      const found: (typeof bibles)[number][] = [];
      const list = biblesRef.current;
      const queue = [...list];
      const worker = async () => {
        for (let m = queue.shift(); m && !ctl.signal.aborted; m = queue.shift()) {
          const index = await recordings.manifests.translationIndex(m.abbreviation, ctl.signal).catch(() => null);
          if (index && index.narrators.length > 0) found.push(m);
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
      // Keep the list order (installed first), whatever order the lookups finished in.
      return list.filter((m) => found.includes(m));
    };
    void probe().then((list) => { if (live) setWithAudio(list); });
    return () => { live = false; ctl.abort(); };
  }, [recordings, biblesKey]);

  if (withAudio === null) return <p className="audio-settings__hint" role="status">{t('audio.downloads.loading')}</p>;
  if (!recordings || withAudio.length === 0) return <p className="audio-settings__hint" data-testid="audio-dl-none">{t('audio.downloads.noneAny')}</p>;
  return <DownloadsForRecordings recordings={recordings} modules={withAudio} />;
};

/**
 * One model per app (rebuilt only when the recordings source changes), so a run keeps going when
 * Preferences closes and reopening shows its progress.
 */
let shared: { recordings: DesktopRecordings; model: AudioDownloadsModel } | null = null;

export function getDesktopDownloadsModel(recordings: DesktopRecordings): AudioDownloadsModel {
  if (shared && shared.recordings === recordings) return shared.model;
  shared?.model.cancel();
  const model = new AudioDownloadsModel({
    manifests: recordings.manifests,
    locator: recordings.locator,
    store: offlineAware(createDesktopDownloadStore(audioClient)),
    canPlay,
    chapterCount,
    ensureText: (module, signal) => ensureModuleText(module, signal, desktopInstaller),
  });
  shared = { recordings, model };
  return model;
}

/** For tests: drop the shared model (cancelling any run). */
export function resetDesktopDownloadsModel(): void {
  shared?.model.cancel();
  shared = null;
}

const DownloadsForRecordings: React.FC<{ recordings: DesktopRecordings; modules: { abbreviation: string; name?: string }[] }> = ({ recordings, modules }) => {
  const model = getDesktopDownloadsModel(recordings);
  return <AudioDownloadsPanel model={model} modules={modules} bookName={getBookName} />;
};
