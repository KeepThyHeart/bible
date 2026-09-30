/**
 * Backup & restore for the desktop app: a thin caller of the format code in
 * `@bible/core` (`Backup.*`).
 *
 * Core owns the container (encrypted, streamed, versioned), the payload, the
 * table registry and the restore planner. This file supplies what only the
 * desktop has: the user database, the notes folder, extension data, files on
 * disk, Argon2id in a worker thread, and a safety snapshot before a restore.
 *
 * Restore is two calls: `inspectBackupFile` opens and fully verifies the file and
 * returns a plan to show the user (nothing is written); `applyInspection` then
 * applies the chosen sections. The verified payload stays in memory between the
 * two calls, never on disk in decrypted form.
 */
import { randomUUID } from 'crypto';
import { basename } from 'path';
import { statSync } from 'fs';
import log from 'electron-log';
import { Backup, repairUserSchema } from '@bible/core';
import type { ISql } from '@bible/core';
import {
  DesktopExtensionData, NotesDirStore, createPreRestoreSnapshot, notesSink, notesSource, readFileStream, writeFileFromStream,
} from './backup/nodeAdapters';
import type { ExtensionPort } from './backup/nodeAdapters';

export interface BackupContext {
  sql: ISql;
  appInfo: Backup.AppInfo;
  /** Root of the `.bn` notes folder, if there is one. */
  notesDir?: string;
  extensions?: ExtensionPort;
  /** Installed modules, recorded in the backup for information. */
  modules?: () => Promise<Backup.ModuleRef[]>;
  /** Key derivation; defaults to running Argon2id in this thread. */
  kdf?: Backup.KdfFunction;
  /** Where safety snapshots go, with the user database file that is copied into them. */
  snapshot?: { root: string; userDbPath: string };
  now?: () => Date;
}

export interface CreateOptions {
  destinationPath: string;
  includeHistory: boolean;
}

export interface CreateEncryptedOptions extends CreateOptions {
  password: string;
}

export interface BackupSummary {
  path: string;
  createdAt: string;
  sizeBytes: number;
  sections: number;
  warnings: Backup.BackupWarning[];
}

function sources(ctx: BackupContext): Backup.BackupSources {
  const notes = ctx.notesDir ? new NotesDirStore(ctx.notesDir) : undefined;
  return {
    sql: ctx.sql,
    notes: notes ? notesSource(notes) : undefined,
    extensions: ctx.extensions ? new DesktopExtensionData(ctx.extensions) : undefined,
    modules: ctx.modules,
  };
}

async function build(ctx: BackupContext, includeHistory: boolean): Promise<Backup.BackupPayload> {
  return Backup.createBackupPayload(sources(ctx), { includeHistory, app: ctx.appInfo, now: ctx.now });
}

function summarize(path: string, payload: Backup.BackupPayload): BackupSummary {
  return {
    path,
    createdAt: payload.manifest.createdAt,
    sizeBytes: statSync(path).size,
    sections: payload.manifest.sections.length,
    warnings: payload.warnings,
  };
}

/** Write an encrypted `.bbk` (password slot, Argon2id, streamed AES-256-GCM). */
export async function createEncryptedBackup(ctx: BackupContext, opts: CreateEncryptedOptions): Promise<BackupSummary> {
  log.info('[BackupService] Creating encrypted backup');
  const payload = await build(ctx, opts.includeHistory);
  const file = Backup.sealStream(
    Backup.chunked(payload.zip, 64 * 1024),
    [{ type: 'password', password: opts.password }],
    { kdf: ctx.kdf }
  );
  await writeFileFromStream(opts.destinationPath, file);
  return summarize(opts.destinationPath, payload);
}

/** Write the unencrypted portable export (the payload ZIP itself). Anyone with the file can read it. */
export async function createPlainExport(ctx: BackupContext, opts: CreateOptions): Promise<BackupSummary> {
  log.info('[BackupService] Creating unencrypted export');
  const payload = await build(ctx, opts.includeHistory);
  await writeFileFromStream(opts.destinationPath, Backup.chunked(payload.zip, 1024 * 1024));
  return summarize(opts.destinationPath, payload);
}

// --- restore ------------------------------------------------------------------------

/** What the renderer is shown: the plan without the (large) verified payload. */
export interface InspectionDto {
  token: string;
  fileName: string;
  encrypted: boolean;
  source: Backup.RestorePlan['source'];
  sections: Backup.SectionPlan[];
  unknownSections: Backup.RestorePlan['unknownSections'];
  extensions: Backup.RestorePlan['extensions'];
  noteFiles: number;
  historyNoteFiles: number;
  warnings: Backup.RestoreWarning[];
  preview?: Backup.RestorePlan['preview'];
  defaults: { replace: string[]; merge: string[] };
}

export interface ApplyOptions {
  token: string;
  mode: Backup.RestoreMode;
  sections: string[];
}

export interface ApplyResult {
  report: Backup.RestoreReport;
  /** Where the pre-restore snapshot was written. */
  snapshotDir?: string;
}

const INSPECTION_TTL_MS = 30 * 60 * 1000;
let active: { token: string; plan: Backup.RestorePlan; expires: number; busy: boolean } | null = null;

export class NoActiveInspectionError extends Error {
  constructor() {
    super('The backup is no longer open. Open it again.');
    this.name = 'NoActiveInspectionError';
  }
}

function targetOf(ctx: BackupContext): Backup.RestoreTarget {
  const notes = ctx.notesDir ? new NotesDirStore(ctx.notesDir) : undefined;
  const ext = ctx.extensions ? new DesktopExtensionData(ctx.extensions) : undefined;
  return { sql: ctx.sql, notes: notes ? notesSink(notes) : undefined, extensions: ext, now: ctx.now };
}

/**
 * Open a backup file (asking for the password only if it is encrypted), verify
 * every byte of it, and describe what restoring it would do. Writes nothing.
 */
export async function inspectBackupFile(ctx: BackupContext, opts: { backupPath: string; password?: string }): Promise<InspectionDto> {
  if (!statSync(opts.backupPath).isFile()) throw new Backup.NotABackupError('Not a backup file');
  const archive = await Backup.readBackupFile(
    readFileStream(opts.backupPath),
    opts.password ? { password: opts.password } : undefined,
    { kdf: ctx.kdf }
  );
  const plan = Backup.inspectBackup(archive, targetOf(ctx));
  const token = randomUUID();
  active = { token, plan, expires: Date.now() + INSPECTION_TTL_MS, busy: false };
  return {
    token,
    fileName: basename(opts.backupPath),
    encrypted: archive.encrypted,
    source: plan.source,
    sections: plan.sections,
    unknownSections: plan.unknownSections,
    extensions: plan.extensions,
    noteFiles: plan.noteFiles,
    historyNoteFiles: plan.historyNoteFiles,
    warnings: plan.warnings,
    preview: plan.preview,
    defaults: { replace: Backup.defaultSections(plan, 'replace'), merge: Backup.defaultSections(plan, 'merge') },
  };
}

export function discardInspection(token?: string): void {
  if (!token || active?.token === token) active = null;
}

/**
 * Apply an inspected backup. A safety snapshot (the encrypted user database file
 * and the notes folder) is taken first; if that fails, nothing is restored.
 */
export async function applyInspection(ctx: BackupContext, opts: ApplyOptions): Promise<ApplyResult> {
  if (!active || active.token !== opts.token || active.expires < Date.now() || active.busy) {
    if (active && active.expires < Date.now()) active = null;
    throw new NoActiveInspectionError();
  }
  // One restore at a time: a second call with the same token must not start while the first is running.
  const entry = active;
  entry.busy = true;
  const { plan } = entry;

  try {
    let snapshotDir: string | undefined;
    if (ctx.snapshot) {
      snapshotDir = createPreRestoreSnapshot({
        userDbPath: ctx.snapshot.userDbPath,
        notesDir: ctx.notesDir,
        root: ctx.snapshot.root,
        now: ctx.now,
      });
      log.info(`[BackupService] Safety snapshot written to ${snapshotDir}`);
    }

    log.info(`[BackupService] Restoring (mode: ${opts.mode}, ${opts.sections.length} section(s))`);
    const report = await Backup.applyRestore(plan, targetOf(ctx), { mode: opts.mode, sections: opts.sections });
    try {
      repairUserSchema(ctx.sql);
    } catch (err) {
      log.warn('[BackupService] repairUserSchema after restore failed:', err);
    }
    active = null;
    return { report, snapshotDir };
  } finally {
    entry.busy = false;
  }
}
