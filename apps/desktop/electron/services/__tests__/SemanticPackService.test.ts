/**
 * Tests for `SemanticPackService` - the installer for the optional
 * semantic-search feature pack.
 *
 * These drive the *real* `DownloadService` through the `FakeNetworkGateway`
 * seam rather than stubbing the download, so each case exercises the whole
 * chain the shipping code takes: transfer -> SHA-256 verification -> gunzip ->
 * atomic directory swap -> manifest. The properties worth pinning down are the
 * ones a user would experience as data loss or a broken install:
 *
 *   - a failed or cancelled install must leave the previously installed pack
 *     untouched (the swap is all-or-nothing);
 *   - a payload that does not match its published digest is discarded, with no
 *     "install anyway" path;
 *   - a catalog cannot talk the installer into writing outside the pack root,
 *     nor into a layout the runtime would fail to find;
 *   - install and uninstall both release the cached index handle, because on
 *     Windows an open SQLite file cannot be renamed or deleted.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { createHash } from 'crypto';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => os.tmpdir()), isPackaged: false },
}));

vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// The pack root is redirected into a temp directory per test. Everything else
// in appPaths is irrelevant here, so only the three functions the service uses
// are provided.
let packRoot = '';
vi.mock('../../utils/appPaths', () => ({
  getFeaturePackRoot: () => packRoot,
  SEMANTIC_INDEX_FILENAME: 'semantic_index.db',
  SEMANTIC_MODELS_DIRNAME: 'models',
}));

import { SemanticPackService, SemanticPackInstallError } from '../SemanticPackService';
import { FakeNetworkGateway, downloadResult } from './fakeNetworkGateway';
// Nothing in the dependency tree *writes* zips (the app only reads them), so
// the extension tests' minimal writer stands in for a real archiver here too.
import { makeZip } from '../../extensions/__tests__/makeZip';
import type { FeaturePack } from '@bible/core';

let tempDir: string;
let gateway: FakeNetworkGateway;
let onInstalled: Mock;
let service: SemanticPackService;

const INDEX_BODY = 'SQLite format 3\u0000-pretend-index-bytes';
const MODEL_BODY = '{"model_type":"nomic_bert"}';

function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Serve each URL with fixed bytes, as the real gateway would. */
function serve(bodies: Record<string, Buffer>): void {
  gateway.downloadStreamImpl = async (opts) => {
    const body = bodies[opts.url];
    if (!body) {
      return downloadResult({ status: 404, chunks: [] });
    }
    return downloadResult({
      status: 200,
      headers: { 'content-length': String(body.length) },
      chunks: [body],
    });
  };
}

function pack(overrides: Partial<FeaturePack> = {}): FeaturePack {
  return {
    pack_id: 'semantic-kjv',
    pack_type: 'semantic_search',
    name: 'Semantic Search (KJV)',
    version: '1.0.0',
    description: 'Meaning-based search.',
    license: 'CC-BY-4.0',
    license_url: null,
    download_size_bytes: INDEX_BODY.length + MODEL_BODY.length,
    installed_size_bytes: INDEX_BODY.length + MODEL_BODY.length,
    artifacts: [
      {
        kind: 'index',
        path: 'semantic_index.db',
        download_url: 'https://packs.example.org/semantic_index.db',
        download_size_bytes: INDEX_BODY.length,
        sha256: sha256(INDEX_BODY),
      },
      {
        kind: 'model',
        path: 'models/Xenova/nomic-embed-text-v1/config.json',
        download_url: 'https://packs.example.org/config.json',
        download_size_bytes: MODEL_BODY.length,
        sha256: sha256(MODEL_BODY),
      },
    ],
    metadata: null,
    ...overrides,
  };
}

function defaultBodies(): Record<string, Buffer> {
  return {
    'https://packs.example.org/semantic_index.db': Buffer.from(INDEX_BODY),
    'https://packs.example.org/config.json': Buffer.from(MODEL_BODY),
  };
}

describe('SemanticPackService', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bible-pack-'));
    packRoot = path.join(tempDir, 'feature-packs', 'semantic_search');
    gateway = new FakeNetworkGateway();
    onInstalled = vi.fn();
    service = new SemanticPackService(onInstalled, gateway);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  describe('install', () => {
    it('downloads every artifact, verifies it, and writes the pack layout', async () => {
      serve(defaultBodies());

      const manifest = await service.install(pack());

      expect(fs.readFileSync(path.join(packRoot, 'semantic_index.db'), 'utf-8')).toBe(INDEX_BODY);
      expect(
        fs.readFileSync(
          path.join(packRoot, 'models', 'Xenova', 'nomic-embed-text-v1', 'config.json'),
          'utf-8'
        )
      ).toBe(MODEL_BODY);
      expect(manifest.packId).toBe('semantic-kjv');
      expect(manifest.files).toEqual([
        'semantic_index.db',
        'models/Xenova/nomic-embed-text-v1/config.json',
      ]);
      expect(manifest.installedSizeBytes).toBeGreaterThan(0);
    });

    it('reports the pack as installed afterwards', async () => {
      serve(defaultBodies());
      expect(service.getStatus().installed).toBe(false);

      await service.install(pack());

      const status = service.getStatus();
      expect(status.installed).toBe(true);
      expect(status.manifest?.version).toBe('1.0.0');
      expect(status.progress?.phase).toBe('done');
      expect(status.progress?.percent).toBe(100);
    });

    it('releases the cached index handle on both sides of the directory swap', async () => {
      serve(defaultBodies());
      await service.install(pack());

      // Once before the swap (so Windows can rename over the old directory)
      // and once after (so the next search opens the new index).
      expect(onInstalled).toHaveBeenCalledTimes(2);
    });

    it('expands a gzipped artifact after verifying the transferred bytes', async () => {
      const gz = zlib.gzipSync(Buffer.from(INDEX_BODY));
      const gzPack = pack({
        artifacts: [
          {
            kind: 'index',
            path: 'semantic_index.db',
            download_url: 'https://packs.example.org/semantic_index.db.gz',
            download_size_bytes: gz.length,
            // Digest is over the compressed bytes as served - the payload is
            // never expanded before it has been proven to be what was promised.
            sha256: sha256(gz),
            gzipped: true,
          },
          {
            kind: 'model',
            path: 'models/config.json',
            download_url: 'https://packs.example.org/config.json',
            download_size_bytes: MODEL_BODY.length,
            sha256: sha256(MODEL_BODY),
          },
        ],
      });
      serve({
        'https://packs.example.org/semantic_index.db.gz': gz,
        'https://packs.example.org/config.json': Buffer.from(MODEL_BODY),
      });

      await service.install(gzPack);

      expect(fs.readFileSync(path.join(packRoot, 'semantic_index.db'), 'utf-8')).toBe(INDEX_BODY);
      expect(fs.existsSync(path.join(packRoot, 'semantic_index.db.gz'))).toBe(false);
    });

    it('discards a payload whose digest does not match the catalog', async () => {
      serve({
        'https://packs.example.org/semantic_index.db': Buffer.from('substituted payload'),
        'https://packs.example.org/config.json': Buffer.from(MODEL_BODY),
      });

      await expect(service.install(pack())).rejects.toMatchObject({
        code: 'checksum_mismatch',
      });
      expect(fs.existsSync(packRoot)).toBe(false);
    });

    it('leaves an existing install untouched when a later artifact fails', async () => {
      serve(defaultBodies());
      await service.install(pack());
      onInstalled.mockClear();

      // Second install: the index downloads fine, the model 404s.
      serve({
        'https://packs.example.org/semantic_index.db': Buffer.from('v2 index'),
      });
      const v2 = pack({
        version: '2.0.0',
        artifacts: [
          {
            kind: 'index',
            path: 'semantic_index.db',
            download_url: 'https://packs.example.org/semantic_index.db',
            download_size_bytes: 8,
            sha256: sha256('v2 index'),
          },
          {
            kind: 'model',
            path: 'models/config.json',
            download_url: 'https://packs.example.org/missing.json',
            download_size_bytes: 10,
            sha256: sha256('whatever'),
          },
        ],
      });

      await expect(service.install(v2)).rejects.toBeInstanceOf(SemanticPackInstallError);

      // The old pack is still exactly as it was - an interrupted upgrade must
      // not leave the user with no working semantic search.
      expect(fs.readFileSync(path.join(packRoot, 'semantic_index.db'), 'utf-8')).toBe(INDEX_BODY);
      expect(service.getStatus().manifest?.version).toBe('1.0.0');
      // And the swap never ran, so the search cache was never invalidated.
      expect(onInstalled).not.toHaveBeenCalled();
    });

    // NOTE: `swapIntoPlace`'s retry-on-EBUSY path is deliberately not covered
    // here. It defends against a sharing violation from *another* process (an
    // antivirus or indexer scan holding the old directory), and that condition
    // cannot be reproduced in-process: Node opens files with FILE_SHARE_DELETE,
    // so even an open handle in this test does not block the delete. Faking it
    // by stubbing `renameSync` would only assert that the loop calls itself
    // again, which is what the code plainly says.

    it('removes the staging directory when an install fails', async () => {
      serve({});
      await expect(service.install(pack())).rejects.toBeInstanceOf(SemanticPackInstallError);
      expect(fs.existsSync(`${packRoot}.incoming`)).toBe(false);
    });

    it('surfaces offline mode as a distinct, actionable error', async () => {
      gateway.offline = true;
      serve(defaultBodies());

      await expect(service.install(pack())).rejects.toMatchObject({ code: 'offline' });
    });

    it('refuses a second install while one is running', async () => {
      // A download that never completes keeps the first install in flight.
      gateway.downloadStreamImpl = () => new Promise(() => { /* never resolves */ });
      void service.install(pack()).catch(() => { /* abandoned below */ });

      await expect(service.install(pack())).rejects.toMatchObject({ code: 'busy' });
      expect(service.isInstalling()).toBe(true);
    });
  });

  describe('layout enforcement', () => {
    it('rejects an index artifact that is not at the expected path', async () => {
      serve(defaultBodies());
      const misplaced = pack({
        artifacts: [
          {
            kind: 'index',
            path: 'data/index.db',
            download_url: 'https://packs.example.org/semantic_index.db',
            download_size_bytes: INDEX_BODY.length,
            sha256: sha256(INDEX_BODY),
          },
          {
            kind: 'model',
            path: 'models/config.json',
            download_url: 'https://packs.example.org/config.json',
            download_size_bytes: MODEL_BODY.length,
            sha256: sha256(MODEL_BODY),
          },
        ],
      });

      // Safe, but invisible to the path resolvers - an install that "succeeded"
      // and changed nothing is worse than a clean refusal.
      await expect(service.install(misplaced)).rejects.toMatchObject({
        code: 'invalid_layout',
      });
      expect(gateway.downloadCalls).toHaveLength(0);
    });

    it('rejects a model artifact outside models/', async () => {
      serve(defaultBodies());
      const stray = pack({
        artifacts: [
          {
            kind: 'index',
            path: 'semantic_index.db',
            download_url: 'https://packs.example.org/semantic_index.db',
            download_size_bytes: INDEX_BODY.length,
            sha256: sha256(INDEX_BODY),
          },
          {
            kind: 'model',
            path: 'config.json',
            download_url: 'https://packs.example.org/config.json',
            download_size_bytes: MODEL_BODY.length,
            sha256: sha256(MODEL_BODY),
          },
        ],
      });

      await expect(service.install(stray)).rejects.toMatchObject({ code: 'invalid_layout' });
    });

    // A pack carries data; it never carries code. Everything executable ships
    // inside the signed, attested installer. These cases pin that invariant
    // down, because it is what stops a pack download from becoming a second,
    // unsigned software distribution channel - the softest way into an app
    // whose users may face real consequences for running the wrong binary.
    describe('data-only invariant', () => {
      // One case per loader family. A denylist would have to anticipate every
      // one of these; the allowlist rejects them without knowing what they are.
      const executablePaths = [
        'models/onnxruntime_binding.node', // Node native addon
        'models/onnxruntime.dll', // Windows shared library
        'models/libonnxruntime.so', // Linux shared object
        'models/libonnxruntime.so.1.27.0', // ...and its versioned form
        'models/libonnxruntime.1.27.0.dylib', // macOS shared library
        'models/setup.exe',
        'models/install.sh',
        'models/run.ps1',
        'models/model.wasm', // executable bytecode
        'models/loader.js', // script
        'models/pytorch_model.bin', // pickle - RCE by design
        'models/weights.pt',
        'models/LICENSE', // no extension: the shape Linux executables take
      ];

      for (const badPath of executablePaths) {
        it(`refuses "${badPath}" without downloading it`, async () => {
          serve(defaultBodies());
          const smuggled = pack({
            artifacts: [
              {
                kind: 'index',
                path: 'semantic_index.db',
                download_url: 'https://packs.example.org/semantic_index.db',
                download_size_bytes: INDEX_BODY.length,
                sha256: sha256(INDEX_BODY),
              },
              {
                kind: 'model',
                path: badPath,
                download_url: 'https://packs.example.org/config.json',
                download_size_bytes: MODEL_BODY.length,
                sha256: sha256(MODEL_BODY),
              },
            ],
          });

          await expect(service.install(smuggled)).rejects.toMatchObject({
            code: 'invalid_layout',
          });
          // The manifest alone is enough to refuse: we never fetch the bytes to
          // find out what they are.
          expect(gateway.downloadCalls).toHaveLength(0);
        });
      }

      it('is case-insensitive, so .DLL is refused like .dll', async () => {
        serve(defaultBodies());
        const shouty = pack({
          artifacts: [
            {
              kind: 'index',
              path: 'semantic_index.db',
              download_url: 'https://packs.example.org/semantic_index.db',
              download_size_bytes: INDEX_BODY.length,
              sha256: sha256(INDEX_BODY),
            },
            {
              kind: 'model',
              path: 'models/ONNXRUNTIME.DLL',
              download_url: 'https://packs.example.org/config.json',
              download_size_bytes: MODEL_BODY.length,
              sha256: sha256(MODEL_BODY),
            },
          ],
        });

        await expect(service.install(shouty)).rejects.toMatchObject({
          code: 'invalid_layout',
        });
      });

      it('still accepts the extensions a real semantic pack needs', async () => {
        // The guard must not be so tight that a legitimate pack cannot install -
        // a security check that breaks the feature gets removed, not fixed.
        const bodies: Record<string, Buffer> = {
          'https://packs.example.org/semantic_index.db': Buffer.from(INDEX_BODY),
        };
        const artifacts: FeaturePack['artifacts'] = [
          {
            kind: 'index',
            path: 'semantic_index.db',
            download_url: 'https://packs.example.org/semantic_index.db',
            download_size_bytes: INDEX_BODY.length,
            sha256: sha256(INDEX_BODY),
          },
        ];

        for (const name of [
          'models/config.json',
          'models/onnx/model.onnx',
          'models/vocab.txt',
          'models/LICENSE.md',
        ]) {
          const url = `https://packs.example.org/${name}`;
          bodies[url] = Buffer.from(MODEL_BODY);
          artifacts.push({
            kind: 'model',
            path: name,
            download_url: url,
            download_size_bytes: MODEL_BODY.length,
            sha256: sha256(MODEL_BODY),
          });
        }

        serve(bodies);
        await expect(service.install(pack({ artifacts }))).resolves.toMatchObject({
          packType: 'semantic_search',
        });
      });
    });

    it('rejects a pack of the wrong type before any egress', async () => {
      serve(defaultBodies());
      await expect(
        service.install(pack({ pack_type: 'something_else' as FeaturePack['pack_type'] }))
      ).rejects.toMatchObject({ code: 'invalid_layout' });
      expect(gateway.downloadCalls).toHaveLength(0);
    });

    it('refuses to write outside the pack root even if a traversal path reaches it', async () => {
      // `parseFeaturePack` would already have rejected this path; the service
      // repeats the check because it is the step that actually writes.
      serve(defaultBodies());
      const traversal = pack({
        artifacts: [
          {
            kind: 'index',
            path: 'semantic_index.db',
            download_url: 'https://packs.example.org/semantic_index.db',
            download_size_bytes: INDEX_BODY.length,
            sha256: sha256(INDEX_BODY),
          },
          {
            kind: 'model',
            path: 'models/../../../escaped.json',
            download_url: 'https://packs.example.org/config.json',
            download_size_bytes: MODEL_BODY.length,
            sha256: sha256(MODEL_BODY),
          },
        ],
      });

      await expect(service.install(traversal)).rejects.toBeInstanceOf(SemanticPackInstallError);
      expect(fs.existsSync(path.join(tempDir, 'escaped.json'))).toBe(false);
      expect(fs.existsSync(path.join(path.dirname(tempDir), 'escaped.json'))).toBe(false);
    });
  });

  describe('uninstall', () => {
    it('removes the pack and releases the cached index handle first', async () => {
      serve(defaultBodies());
      await service.install(pack());
      onInstalled.mockClear();

      expect(service.uninstall()).toBe(true);

      expect(fs.existsSync(packRoot)).toBe(false);
      expect(service.getStatus().installed).toBe(false);
      // Called before the delete: Windows will not remove an open SQLite file.
      expect(onInstalled).toHaveBeenCalledTimes(1);
    });

    it('reports false when nothing is installed', () => {
      expect(service.uninstall()).toBe(false);
    });
  });

  describe('status', () => {
    it('does not report installed when the index file is missing', async () => {
      serve(defaultBodies());
      await service.install(pack());

      // Simulate a half-deleted pack directory: the manifest survives but the
      // file the runtime opens is gone.
      fs.rmSync(path.join(packRoot, 'semantic_index.db'));

      expect(service.getStatus().installed).toBe(false);
      expect(service.getStatus().manifest).not.toBeNull();
    });

    it('does not report installed when a model file is missing', async () => {
      serve(defaultBodies());
      await service.install(pack());

      fs.rmSync(path.join(packRoot, 'models', 'Xenova', 'nomic-embed-text-v1', 'config.json'));

      expect(service.getStatus().installed).toBe(false);
    });

    it('returns no manifest on a clean install', () => {
      const status = service.getStatus();
      expect(status.installed).toBe(false);
      expect(status.manifest).toBeNull();
      expect(status.progress).toBeNull();
    });
  });

  /**
   * Sideloading has to hold exactly the same line as a catalog install: same
   * layout contract, same containment, same digests, same all-or-nothing swap.
   * The cases below are the ones where a weaker local path would be a way in -
   * a traversing artifact path, a substituted file, an archive entry nobody
   * asked for - plus the plain "it works from a folder and from a zip".
   */
  describe('installFromPackage', () => {
    /** Write a package folder: manifest plus each file at its packaged name. */
    function writePackageDir(
      dir: string,
      manifest: Record<string, unknown>,
      files: Record<string, Buffer>
    ): string {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'feature-pack.json'), JSON.stringify(manifest), 'utf-8');
      for (const [name, body] of Object.entries(files)) {
        const target = path.join(dir, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, body);
      }
      return dir;
    }

    function localManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        format: 'bible-feature-pack@1',
        pack_id: 'semantic-kjv',
        pack_type: 'semantic_search',
        name: 'Semantic Search (KJV)',
        version: '1.0.0',
        description: 'Meaning-based search.',
        license: 'CC-BY-4.0',
        installed_size_bytes: INDEX_BODY.length + MODEL_BODY.length,
        artifacts: [
          {
            kind: 'index',
            path: 'semantic_index.db',
            size_bytes: INDEX_BODY.length,
            sha256: sha256(INDEX_BODY),
          },
          {
            kind: 'model',
            path: 'models/Xenova/nomic-embed-text-v1/config.json',
            size_bytes: MODEL_BODY.length,
            sha256: sha256(MODEL_BODY),
          },
        ],
        ...overrides,
      };
    }

    function defaultFiles(): Record<string, Buffer> {
      return {
        'semantic_index.db': Buffer.from(INDEX_BODY),
        'models/Xenova/nomic-embed-text-v1/config.json': Buffer.from(MODEL_BODY),
      };
    }

    it('installs from a package folder', async () => {
      const dir = writePackageDir(path.join(tempDir, 'pkg'), localManifest(), defaultFiles());

      const manifest = await service.installFromPackage(dir);

      expect(fs.readFileSync(path.join(packRoot, 'semantic_index.db'), 'utf-8')).toBe(INDEX_BODY);
      expect(
        fs.readFileSync(
          path.join(packRoot, 'models', 'Xenova', 'nomic-embed-text-v1', 'config.json'),
          'utf-8'
        )
      ).toBe(MODEL_BODY);
      expect(manifest.packId).toBe('semantic-kjv');
      expect(service.getStatus().installed).toBe(true);
      // Same bracketing as a download install: release the handle, swap, reopen.
      expect(onInstalled).toHaveBeenCalledTimes(2);
    });

    it('installs from a .biblepack archive', async () => {
      const files = defaultFiles();
      const archive = path.join(tempDir, 'semantic-kjv.biblepack');
      fs.writeFileSync(archive, makeZip([
        { path: 'feature-pack.json', content: JSON.stringify(localManifest()) },
        ...Object.entries(files).map(([name, content]) => ({ path: name, content })),
      ]));

      await service.installFromPackage(archive);

      expect(fs.readFileSync(path.join(packRoot, 'semantic_index.db'), 'utf-8')).toBe(INDEX_BODY);
      expect(service.getStatus().installed).toBe(true);
    });

    // Every "zip this folder" tool produces this shape, Explorer included.
    it('accepts an archive whose contents sit inside a single wrapping folder', async () => {
      const archive = path.join(tempDir, 'wrapped.zip');
      fs.writeFileSync(archive, makeZip([
        { path: 'semantic-kjv-1.0.0/feature-pack.json', content: JSON.stringify(localManifest()) },
        ...Object.entries(defaultFiles()).map(([name, content]) => ({
          path: `semantic-kjv-1.0.0/${name}`,
          content,
        })),
      ]));

      await service.installFromPackage(archive);

      expect(service.getStatus().installed).toBe(true);
    });

    it('expands a gzipped artifact after verifying the compressed bytes', async () => {
      const gz = zlib.gzipSync(Buffer.from(INDEX_BODY));
      const manifest = localManifest({
        artifacts: [
          {
            kind: 'index',
            path: 'semantic_index.db',
            size_bytes: gz.length,
            sha256: sha256(gz),
            gzipped: true,
          },
          {
            kind: 'model',
            path: 'models/Xenova/nomic-embed-text-v1/config.json',
            size_bytes: MODEL_BODY.length,
            sha256: sha256(MODEL_BODY),
          },
        ],
      });
      const dir = writePackageDir(path.join(tempDir, 'pkg'), manifest, {
        'semantic_index.db.gz': gz,
        'models/Xenova/nomic-embed-text-v1/config.json': Buffer.from(MODEL_BODY),
      });

      await service.installFromPackage(dir);

      expect(fs.readFileSync(path.join(packRoot, 'semantic_index.db'), 'utf-8')).toBe(INDEX_BODY);
      // The compressed copy is not left behind next to the expanded one.
      expect(fs.existsSync(path.join(packRoot, 'semantic_index.db.gz'))).toBe(false);
    });

    it('rejects a file whose bytes do not match the manifest digest', async () => {
      const dir = writePackageDir(path.join(tempDir, 'pkg'), localManifest(), {
        ...defaultFiles(),
        'semantic_index.db': Buffer.from('substituted payload of the right length'.slice(0, INDEX_BODY.length)),
      });

      await expect(service.installFromPackage(dir)).rejects.toMatchObject({
        code: 'checksum_mismatch',
      });
      expect(service.getStatus().installed).toBe(false);
    });

    it('rejects a truncated file rather than installing a partial index', async () => {
      const dir = writePackageDir(path.join(tempDir, 'pkg'), localManifest(), {
        ...defaultFiles(),
        'semantic_index.db': Buffer.from(INDEX_BODY.slice(0, 5)),
      });

      await expect(service.installFromPackage(dir)).rejects.toMatchObject({
        code: 'invalid_package',
      });
    });

    // The decompression-bomb shape: the manifest understates a file's size, so
    // the copy has to stop at the declared length rather than run to the end.
    it('stops copying a file that is larger than the manifest declares', async () => {
      const dir = writePackageDir(path.join(tempDir, 'pkg'), localManifest(), {
        ...defaultFiles(),
        'semantic_index.db': Buffer.alloc(INDEX_BODY.length * 50, 0x41),
      });

      await expect(service.installFromPackage(dir)).rejects.toMatchObject({ code: 'too_large' });
    });

    it('refuses an artifact path that would escape the pack root', async () => {
      const dir = writePackageDir(
        path.join(tempDir, 'pkg'),
        localManifest({
          artifacts: [
            {
              kind: 'index',
              path: '../../escaped.db',
              size_bytes: INDEX_BODY.length,
              sha256: sha256(INDEX_BODY),
            },
            {
              kind: 'model',
              path: 'models/config.json',
              size_bytes: MODEL_BODY.length,
              sha256: sha256(MODEL_BODY),
            },
          ],
        }),
        defaultFiles()
      );

      await expect(service.installFromPackage(dir)).rejects.toMatchObject({
        code: 'invalid_package',
      });
      expect(fs.existsSync(path.join(tempDir, 'escaped.db'))).toBe(false);
    });

    // Zip-slip, closed structurally: files are opened by manifest-derived name,
    // so an entry the manifest never mentions is never read or written.
    it('ignores archive entries the manifest does not list', async () => {
      const outsideTarget = path.join(tempDir, 'planted.txt');
      const archive = path.join(tempDir, 'slip.zip');
      fs.writeFileSync(archive, makeZip([
        { path: 'feature-pack.json', content: JSON.stringify(localManifest()) },
        ...Object.entries(defaultFiles()).map(([name, content]) => ({ path: name, content })),
        { path: '../planted.txt', content: 'should never be written' },
        { path: 'stowaway.exe', content: 'nor this' },
      ]));

      await service.installFromPackage(archive);

      expect(fs.existsSync(outsideTarget)).toBe(false);
      expect(fs.existsSync(path.join(packRoot, 'stowaway.exe'))).toBe(false);
      expect(service.getStatus().installed).toBe(true);
    });

    it('rejects a layout the runtime would not find', async () => {
      const dir = writePackageDir(
        path.join(tempDir, 'pkg'),
        localManifest({
          artifacts: [
            {
              kind: 'index',
              // Safe, but not where `resolveSemanticIndexPath` looks - an
              // install that "succeeded" here would change nothing.
              path: 'data/index.db',
              size_bytes: INDEX_BODY.length,
              sha256: sha256(INDEX_BODY),
            },
            {
              kind: 'model',
              path: 'models/config.json',
              size_bytes: MODEL_BODY.length,
              sha256: sha256(MODEL_BODY),
            },
          ],
        }),
        defaultFiles()
      );

      await expect(service.installFromPackage(dir)).rejects.toMatchObject({
        code: 'invalid_layout',
      });
    });

    it('rejects a folder that is not a feature pack', async () => {
      const dir = path.join(tempDir, 'not-a-pack');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'readme.txt'), 'hello');

      await expect(service.installFromPackage(dir)).rejects.toMatchObject({
        code: 'invalid_package',
      });
    });

    it('rejects a manifest that is not valid JSON', async () => {
      const dir = path.join(tempDir, 'bad-json');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'feature-pack.json'), '{ nope', 'utf-8');

      await expect(service.installFromPackage(dir)).rejects.toMatchObject({
        code: 'invalid_package',
      });
    });

    it('rejects a package built for a future format', async () => {
      const dir = writePackageDir(
        path.join(tempDir, 'pkg'),
        localManifest({ format: 'bible-feature-pack@2' }),
        defaultFiles()
      );

      await expect(service.installFromPackage(dir)).rejects.toMatchObject({
        code: 'invalid_package',
      });
    });

    it('reports a missing file instead of installing a partial pack', async () => {
      const dir = writePackageDir(path.join(tempDir, 'pkg'), localManifest(), {
        'semantic_index.db': Buffer.from(INDEX_BODY),
      });

      await expect(service.installFromPackage(dir)).rejects.toMatchObject({
        code: 'invalid_package',
      });
      expect(service.getStatus().installed).toBe(false);
    });

    // The reason a failed sideload must not touch the pack root: the user still
    // has a working feature, and finds out the package was bad, not the index.
    it('leaves an existing install untouched when a sideload fails', async () => {
      serve(defaultBodies());
      await service.install(pack());
      expect(service.getStatus().installed).toBe(true);

      const dir = writePackageDir(path.join(tempDir, 'pkg'), localManifest({ version: '2.0.0' }), {
        ...defaultFiles(),
        'semantic_index.db': Buffer.from('x'.repeat(INDEX_BODY.length)),
      });

      await expect(service.installFromPackage(dir)).rejects.toMatchObject({
        code: 'checksum_mismatch',
      });

      const status = service.getStatus();
      expect(status.installed).toBe(true);
      expect(status.manifest?.version).toBe('1.0.0');
      expect(fs.readFileSync(path.join(packRoot, 'semantic_index.db'), 'utf-8')).toBe(INDEX_BODY);
    });

    it('surfaces a failure through getStatus, since the IPC call has already returned', async () => {
      const dir = path.join(tempDir, 'not-a-pack');
      fs.mkdirSync(dir, { recursive: true });

      await expect(service.installFromPackage(dir)).rejects.toThrow();

      const progress = service.getStatus().progress;
      expect(progress?.phase).toBe('error');
      expect(progress?.error).toMatch(/feature-pack\.json/);
    });

    it('refuses to start while another install is running', async () => {
      const dir = writePackageDir(path.join(tempDir, 'pkg'), localManifest(), defaultFiles());
      gateway.downloadStreamImpl = () => new Promise(() => { /* never resolves */ });

      void service.install(pack()).catch(() => { /* abandoned by design */ });

      await expect(service.installFromPackage(dir)).rejects.toMatchObject({ code: 'busy' });
    });
  });
});
