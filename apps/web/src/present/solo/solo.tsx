/**
 * Entry point for the solo viewer (`/present/solo`).
 *
 * Unlike `viewer.tsx`, which must stay bare, this page carries the command
 * box and therefore the reading app's i18n, book tables and module list. It is
 * a separate bundle for that reason: the projection viewer that a television
 * loads stays as light as it was. No service worker, no reader, no plugin host.
 */

import { render } from 'preact';
import i18n, { ensureLocaleLoaded } from '../../i18n';
import { API_BASE } from '../../utils/apiUrl';
import { createServerProviders } from '../../providers/ServerDataProvider';
import { moduleStore } from '../../stores/moduleStore';
import { settingsStore } from '../../stores/settingsStore';
import { SoloApp } from './SoloApp';
import { createLocalSession } from './localSession';
import '../viewer.css';
import './solo.css';

async function boot(): Promise<void> {
  const root = document.getElementById('present-viewer');
  if (!root) return;
  await ensureLocaleLoaded(i18n.language).catch(() => undefined);

  // Book names and the installed translations, so a typed reference resolves.
  // Offline or refused: the box still opens and reports "no translation".
  moduleStore.init(createServerProviders(API_BASE).modules);
  await Promise.race([moduleStore.loadManifest(), new Promise<void>(r => setTimeout(r, 6000))]);

  render(<SoloApp session={createLocalSession()} defaultModule={settingsStore.getDefaultBible()} />, root);
}

void boot();
