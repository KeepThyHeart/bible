/**
 * Audio Bible, desktop main half (task 0223). Answers `getInfo` and serves the `kth-audio://` protocol
 * (recordings, installed Piper files, the pronunciation overlay). Off unless the `audio` flag is on.
 */
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import type { Disposable } from '@bible/core/browser';
import type { FeatureMainModule } from '../FeatureMainModule';
import { getAudioDownloadsRoot } from '../../utils/appPaths';
import { createAudioHandler } from './audioProtocol';
import { createGatewayUpstream } from './gatewayUpstream';
import { buildAudioInfo, recordingsBaseFrom } from './info';
import { createDownloadStore } from './downloadStore';
import { AUDIO_SCHEME, type AudioModuleApi } from './types';

const mainModule: FeatureMainModule = {
  id: 'audio',
  registerIpc(ipc, deps): Disposable {
    ipc.handle('getInfo', async (): ReturnType<AudioModuleApi['getInfo']> => {
      // Any downloaded translation keeps the recorded channel on, even with no host configured.
      const hasDownloads = await readdir(join(getAudioDownloadsRoot(), 'v1')).then(e => e.length > 0, () => false);
      return buildAudioInfo(process.env, { hasDownloads });
    });
    const upstream = async (url: string, range: string | null) => {
      // Lazy: nothing of the gateway loads until a recording is proxied or downloaded.
      const { getNetworkGateway } = await import('../../services/NetworkGateway');
      return createGatewayUpstream(getNetworkGateway)(url, range);
    };
    const store = createDownloadStore({
      downloadsRoot: getAudioDownloadsRoot,
      recordingsBase: () => recordingsBaseFrom(),
      fetchUpstream: upstream,
    });
    ipc.handle('downloadsPresent', (urls: string[]) => store.present(urls));
    ipc.handle('downloadsFetch', (files: { url: string; bytes: number; sha256?: string }[]) => store.fetchFiles(files));
    ipc.handle('downloadsProgress', (jobId: string) => store.progress(jobId));
    ipc.handle('downloadsCancel', (jobId: string) => store.cancel(jobId));
    ipc.handle('downloadsRemove', (urls: string[]) => store.remove(urls));
    ipc.handle('downloadsFreeBytes', () => store.freeBytes());
    ipc.handle('downloadsUsage', () => store.usage());
    const handler = createAudioHandler({
      resolveAsset: async (id, path) => (await import('../../services/assets/AssetService')).getAssetService().resolvePath(id, path),
      downloadsRoot: getAudioDownloadsRoot,
      recordingsBase: () => recordingsBaseFrom(),
      fetchUpstream: upstream,
      statFile: async (p) => {
        try {
          const s = await stat(p);
          return s.isFile() ? s.size : null;
        } catch {
          return null;
        }
      },
      openFile: (p, start, end) => Readable.toWeb(createReadStream(p, { start, end })) as unknown as BodyInit,
      readText: (p) => readFile(p, 'utf8'),
      joinPath: join,
    });
    let handled = false;
    try {
      protocol.handle(AUDIO_SCHEME, handler);
      handled = true;
    } catch (e) {
      deps.log.warn('[audio] could not install the protocol handler', e);
    }
    return {
      dispose() {
        if (handled) protocol.unhandle(AUDIO_SCHEME);
      },
    };
  },
};

export default mainModule;
