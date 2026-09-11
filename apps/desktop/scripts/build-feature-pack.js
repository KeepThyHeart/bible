#!/usr/bin/env node
/**
 * Build a sideloadable semantic-search feature pack from an index and a model.
 *
 * Produces, under --out:
 *   <pack-id>-<version>/            installable as a folder
 *     feature-pack.json             the package manifest (bible-feature-pack@1)
 *     semantic_index.db[.gz]        the embedding index
 *     models/<model-id>/...         exactly the model files the index needs
 *   <pack-id>-<version>.biblepack   the same folder as one archive
 *
 * The index says which query model it was built for (`query_model` and
 * `query_model_dtype` in its `index_metadata`), so the model files are chosen
 * from that rather than from a flag: a pack whose model does not match its
 * index would install cleanly and then rank every query wrongly. An index
 * with no `index_format` is the original full-width float32 kind, which the
 * app queries with `Xenova/nomic-embed-text-v1` at fp32.
 *
 * Before anything is written the pack is held to the same rules the installer
 * enforces - `parseLocalFeaturePack` from @bible/core, and the data-only
 * extension allowlist `FEATURE_PACK_ALLOWED_EXTENSIONS` - so this script cannot
 * produce a pack the app would refuse. Run `npm run build:core` first.
 *
 * Usage:
 *   node scripts/build-feature-pack.js --index=<semantic_index.db> --models=<models root>
 *     [--out=dist/feature-packs] [--version=1.0.0] [--pack-id=<id>] [--name=<name>]
 *     [--description=<text>] [--license=<spdx>] [--license-url=<url>]
 *     [--gzip-index] [--no-archive]
 *
 * `--models` is the directory that holds `<model-id>/` - the same layout
 * `env.localModelPath` expects, e.g. apps/web/data/models after `npm run
 * fetch:model -w @bible/web`.
 *
 * Reads the index with Node's built-in `node:sqlite` (Node 22.5+): the repo's
 * better-sqlite3 build targets Electron's ABI and does not load under Node.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { DatabaseSync } = require('node:sqlite');
const {
  FEATURE_PACK_ALLOWED_EXTENSIONS,
  FEATURE_PACK_FILE_FORMAT,
  FEATURE_PACK_MANIFEST_FILENAME,
  isSafeArtifactPath,
  packagedFileName,
  parseLocalFeaturePack,
} = require('@bible/core');

const DESKTOP_ROOT = path.resolve(__dirname, '..');

/** Must match SEMANTIC_INDEX_FILENAME / SEMANTIC_MODELS_DIRNAME in electron/utils/appPaths.ts. */
const INDEX_PATH = 'semantic_index.db';
const MODELS_DIR = 'models';

const LEGACY_QUERY_MODEL = { modelId: 'Xenova/nomic-embed-text-v1', dtype: 'fp32' };

/** ONNX file suffix per dtype - transformers.js' DEFAULT_DTYPE_SUFFIX_MAPPING. */
const DTYPE_SUFFIX = {
  fp32: '',
  fp16: '_fp16',
  int8: '_int8',
  uint8: '_uint8',
  q8: '_quantized',
  q4: '_q4',
  q4f16: '_q4f16',
  bnb4: '_bnb4',
};

/** Loaded alongside the graph when present; tokenizer.json and config.json are required. */
const MODEL_SIDE_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'vocab.txt'];
const REQUIRED_SIDE_FILES = new Set(['config.json', 'tokenizer.json']);

/** A stored-method zip without ZIP64 addresses at most this many bytes. */
const ZIP32_LIMIT = 0xffffffff;

// ── Arguments ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { out: path.join(DESKTOP_ROOT, 'dist', 'feature-packs'), version: '1.0.0', gzipIndex: false, archive: true };
  for (const arg of argv) {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    const value = rest.join('=');
    switch (key) {
      case 'index': args.index = path.resolve(value); break;
      case 'models': args.models = path.resolve(value); break;
      case 'out': args.out = path.resolve(value); break;
      case 'version': args.version = value; break;
      case 'pack-id': args.packId = value; break;
      case 'name': args.name = value; break;
      case 'description': args.description = value; break;
      case 'license': args.license = value; break;
      case 'license-url': args.licenseUrl = value; break;
      case 'gzip-index': args.gzipIndex = true; break;
      case 'no-archive': args.archive = false; break;
      default: fail(`Unknown argument: ${arg}`);
    }
  }
  if (!args.index || !args.models) {
    fail('Usage: node scripts/build-feature-pack.js --index=<semantic_index.db> --models=<models root> [options]');
  }
  return args;
}

function fail(message) {
  console.error(`build-feature-pack: ${message}`);
  process.exit(1);
}

// ── Index ───────────────────────────────────────────────────────────────────

/** What the index says about itself, and therefore which model the pack needs. */
function describeIndex(indexPath) {
  if (!fs.existsSync(indexPath)) fail(`Index not found: ${indexPath}`);

  const db = new DatabaseSync(indexPath, { readOnly: true });
  const metadata = Object.fromEntries(
    db.prepare('SELECT key, value FROM index_metadata').all().map(row => [row.key, row.value])
  );
  const rows = db.prepare('SELECT COUNT(*) AS n FROM semantic_embeddings').get().n;
  db.close();

  if (rows === 0) fail(`Index has no rows: ${indexPath}`);

  const format = metadata.index_format ?? '1';
  const queryModel = format === '1'
    ? LEGACY_QUERY_MODEL
    : { modelId: metadata.query_model ?? metadata.embedding_model, dtype: metadata.query_model_dtype ?? 'fp32' };
  if (!queryModel.modelId) fail('Index names no query_model or embedding_model.');

  return {
    format,
    rows,
    dims: Number(metadata.embedding_dim ?? 768),
    encoding: format === '1' ? 'float32' : (metadata.vector_encoding ?? 'float32'),
    embeddingModel: metadata.embedding_model ?? queryModel.modelId,
    queryModel,
  };
}

// ── Model ───────────────────────────────────────────────────────────────────

/** The model files the index's query model needs, as [absolute source, pack path] pairs. */
function selectModelFiles(modelsRoot, { modelId, dtype }) {
  if (!(dtype in DTYPE_SUFFIX)) fail(`Unknown query_model_dtype "${dtype}".`);

  const modelDir = path.join(modelsRoot, ...modelId.split('/'));
  if (!fs.existsSync(modelDir)) fail(`Model directory not found: ${modelDir}`);

  const wanted = [...MODEL_SIDE_FILES, `onnx/model${DTYPE_SUFFIX[dtype]}.onnx`];
  const files = [];
  for (const relative of wanted) {
    const source = path.join(modelDir, ...relative.split('/'));
    if (!fs.existsSync(source)) {
      if (REQUIRED_SIDE_FILES.has(relative) || relative.endsWith('.onnx')) {
        fail(`Model file missing: ${source}`);
      }
      continue;
    }
    files.push({ source, packPath: `${MODELS_DIR}/${modelId}/${relative}` });
  }
  return files;
}

// ── Artifacts ───────────────────────────────────────────────────────────────

function assertPackable(packPath) {
  if (!isSafeArtifactPath(packPath)) fail(`Artifact path is not safe to install: ${packPath}`);
  const fileName = packPath.split('/').pop();
  const dot = fileName.lastIndexOf('.');
  const extension = dot > 0 ? fileName.slice(dot).toLowerCase() : '';
  if (!FEATURE_PACK_ALLOWED_EXTENSIONS.has(extension)) {
    fail(`Artifact "${packPath}" has ${extension ? `extension "${extension}"` : 'no extension'}; packs carry data only.`);
  }
}

async function sha256Of(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

/**
 * Stage the index as a clean single file. `VACUUM INTO` folds in any WAL and
 * drops free pages, so the pack never carries a -wal sidecar or dead space.
 */
function stageIndex(indexPath, destination) {
  const db = new DatabaseSync(indexPath, { readOnly: true });
  db.prepare('VACUUM INTO ?').run(destination);
  db.close();
}

async function gzipFile(source, destination) {
  await pipeline(fs.createReadStream(source), zlib.createGzip({ level: 9 }), fs.createWriteStream(destination));
}

// ── Archive ─────────────────────────────────────────────────────────────────

async function crc32Of(file) {
  let crc = 0;
  for await (const chunk of fs.createReadStream(file)) crc = zlib.crc32(chunk, crc);
  return crc >>> 0;
}

/**
 * Write a stored (uncompressed) zip of `entries`, streaming each file.
 *
 * Stored because the payload does not deflate usefully - ONNX weights and int8
 * vectors are near-random bytes, and an index that does compress is gzipped as
 * its own artifact - and because it keeps this writer to one short format.
 * No ZIP64: a pack past 4 GiB is refused rather than written in a form the
 * reader might mis-parse.
 */
async function writeStoredZip(zipPath, entries) {
  const out = fs.createWriteStream(zipPath);
  const write = buffer => new Promise((resolve, reject) => out.write(buffer, error => (error ? reject(error) : resolve())));
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const size = fs.statSync(entry.source).size;
    const name = Buffer.from(entry.name, 'utf-8');
    const crc = await crc32Of(entry.source);
    if (size > ZIP32_LIMIT || offset + 30 + name.length + size > ZIP32_LIMIT) {
      fail('Pack exceeds 4 GiB; this writer does not produce ZIP64. Ship it as a folder instead.');
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(0, 10); // mod time + date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    await write(local);
    await write(name);
    for await (const chunk of fs.createReadStream(entry.source)) await write(chunk);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, so the mode below is read
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt32LE(0, 12);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(size, 20);
    header.writeUInt32LE(size, 24);
    header.writeUInt16LE(name.length, 28);
    // extra length, comment length, disk number, internal attributes: all zero
    // A regular file (0o100644); zero would read as a symlink to some readers,
    // which the installer deliberately skips.
    header.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + size;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  await write(directory);
  await write(end);
  await new Promise((resolve, reject) => out.end(error => (error ? reject(error) : resolve())));
}

// ── Main ────────────────────────────────────────────────────────────────────

function defaultPackId(index) {
  const model = index.embeddingModel.split('/').pop().replace(/^nomic-embed-text-/, 'nomic-');
  return `semantic-search-${model}-${index.dims}d-${index.encoding}`.toLowerCase();
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const index = describeIndex(args.index);
  const modelFiles = selectModelFiles(args.models, index.queryModel);

  const packId = args.packId ?? defaultPackId(index);
  const stageDir = path.join(args.out, `${packId}-${args.version}`);
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  console.log(`Index: ${index.rows.toLocaleString()} rows, ${index.dims}-d ${index.encoding} (format ${index.format})`);
  console.log(`Query model: ${index.queryModel.modelId} (${index.queryModel.dtype})`);

  const artifacts = [];
  let installedBytes = 0;

  // Index
  assertPackable(INDEX_PATH);
  const stagedIndex = path.join(stageDir, INDEX_PATH);
  stageIndex(args.index, stagedIndex);
  installedBytes += fs.statSync(stagedIndex).size;
  if (args.gzipIndex) {
    await gzipFile(stagedIndex, `${stagedIndex}.gz`);
    fs.rmSync(stagedIndex);
  }
  artifacts.push({ kind: 'index', path: INDEX_PATH, ...(args.gzipIndex ? { gzipped: true } : {}) });

  // Model
  for (const { source, packPath } of modelFiles) {
    assertPackable(packPath);
    const destination = path.join(stageDir, ...packPath.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    installedBytes += fs.statSync(destination).size;
    artifacts.push({ kind: 'model', path: packPath });
  }

  // Digests over the bytes as packaged - what the installer verifies.
  for (const artifact of artifacts) {
    const packaged = path.join(stageDir, ...packagedFileName(artifact).split('/'));
    artifact.size_bytes = fs.statSync(packaged).size;
    artifact.sha256 = await sha256Of(packaged);
  }

  const modelName = index.queryModel.modelId.split('/').pop();
  const manifest = {
    format: FEATURE_PACK_FILE_FORMAT,
    pack_id: packId,
    pack_type: 'semantic_search',
    name: args.name ?? `Semantic Search (${index.embeddingModel.split('/').pop()}, ${index.dims}-d ${index.encoding})`,
    version: args.version,
    description: args.description ??
      `Search the Bible by meaning. ${index.rows.toLocaleString()} passage embeddings ` +
      `(${index.dims}-d ${index.encoding}) and the ${modelName} ${index.queryModel.dtype} query model.`,
    license: args.license ?? 'Apache-2.0',
    license_url: args.licenseUrl ?? `https://huggingface.co/${index.embeddingModel}`,
    installed_size_bytes: installedBytes,
    artifacts,
    metadata: {
      index_format: Number(index.format),
      embedding_model: index.embeddingModel,
      embedding_dim: index.dims,
      vector_encoding: index.encoding,
      query_model: index.queryModel.modelId,
      query_model_dtype: index.queryModel.dtype,
      rows: index.rows,
    },
  };

  const parsed = parseLocalFeaturePack(manifest);
  if (!parsed.ok) fail(`Manifest would be rejected by the installer:\n  ${parsed.errors.join('\n  ')}`);

  const manifestPath = path.join(stageDir, FEATURE_PACK_MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Staged ${stageDir}`);
  for (const artifact of artifacts) {
    console.log(`  ${packagedFileName(artifact).padEnd(64)} ${formatBytes(artifact.size_bytes)}`);
  }
  console.log(`  installed size ${formatBytes(installedBytes)}`);

  if (args.archive) {
    const zipPath = `${stageDir}.biblepack`;
    await writeStoredZip(zipPath, [
      { name: FEATURE_PACK_MANIFEST_FILENAME, source: manifestPath },
      ...artifacts.map(artifact => ({
        name: packagedFileName(artifact),
        source: path.join(stageDir, ...packagedFileName(artifact).split('/')),
      })),
    ]);
    console.log(`Wrote ${zipPath} (${formatBytes(fs.statSync(zipPath).size)})`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
