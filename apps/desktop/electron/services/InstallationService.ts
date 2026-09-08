import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { ISql } from '@bible/core';
import { ModuleMetadata, ModuleMetadataRepository } from '@bible/core';
import type { InstallationResult } from '@bible/core';
import type { IInstallationService } from '@bible/core';
import { getSharedUserDb } from './sharedUserDb';
import { stabilizeModuleLinkage } from './moduleLinkStability';

/**
 * Installation service implementation
 * Handles module installation, verification, and removal
 */
/** RFC 4122 UUID (any version/variant) - `module_info.module_uuid` MUST match. */
const MODULE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUIRED_CANON = 'protestant-66';
const REQUIRED_VERSIFICATION = 'kjv-english';
const MAX_BOOK_NUMBER = 66;

export class InstallationService implements IInstallationService {
  private moduleMetadataRepo: ModuleMetadataRepository;
  private modulesBasePath: string;
  private mainDb: ISql;

  constructor(
    mainDb: ISql,
    modulesBasePath: string
  ) {
    this.mainDb = mainDb;
    this.moduleMetadataRepo = new ModuleMetadataRepository(mainDb);
    this.modulesBasePath = modulesBasePath;
  }

  /**
   * Install a native format module
   */
  async installModule(
    sourcePath: string,
    moduleInfo: Partial<ModuleMetadata>
  ): Promise<InstallationResult> {
    try {
      // Verify source file exists
      if (!fs.existsSync(sourcePath)) {
        return {
          success: false,
          error: 'Source file not found'
        };
      }

      // Decompress if .gz file
      let dbPath = sourcePath;
      if (sourcePath.endsWith('.gz')) {
        const decompressedPath = sourcePath.replace(/\.gz$/, '');
        await this.decompressModule(sourcePath, decompressedPath);
        dbPath = decompressedPath;
      }

      // Verify module - file-format header check first, then a structural +
      // canon conformance gate (E3). A downloaded module is UNTRUSTED: a
      // shifted-canon module resolves every reference to plausible text from the
      // wrong book, silently and permanently, so it must be refused before it is
      // ever registered - not merely "is this a SQLite file".
      const isValid = await this.verifyModule(dbPath);
      if (!isValid) {
        return {
          success: false,
          error: 'Module verification failed'
        };
      }

      const conformance = this.validateModuleForInstall(dbPath);
      if (!conformance.ok) {
        return {
          success: false,
          error: `Module failed conformance validation: ${conformance.errors.join('; ')}`
        };
      }

      // Stable identity gate. `module_metadata.module_uuid` is NOT NULL and
      // carries a full UNIQUE index, and core's schema is explicit that a
      // module file without a UUID is not installable -- reject it at import
      // rather than registering it with a NULL (see the 2.1 Module Metadata
      // note in packages/core/sql/schemas/initial/MainDatabase.sql). Pre-2.0
      // modules have no `module_info.module_uuid` and fail here; they also fail
      // `scripts/validate-module.js` for the same reason.
      //
      // This runs BEFORE the rename below: a refused module must be left where
      // it was found, not moved into the modules tree.
      if (!moduleInfo.moduleUuid) {
        return {
          success: false,
          error:
            'Module has no module_info.module_uuid. Pre-2.0 modules cannot be ' +
            'registered; re-export the module in the current format.'
        };
      }

      // Determine module type and ID from filename or metadata
      const moduleType = moduleInfo.moduleType!;
      const moduleId = moduleInfo.abbreviation || path.basename(dbPath, '.db');

      // Get final destination path
      const destinationPath = this.getModulePath(moduleType, moduleId);

      // Ensure parent directory exists
      const parentDir = path.dirname(destinationPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Move module to final location
      fs.renameSync(dbPath, destinationPath);

      // Get module size
      const sizeBytes = await this.getModuleSize(destinationPath);

      // Create metadata entity
      const metadata = new ModuleMetadata({
        moduleType: moduleType,
        // Carried through from `module_info.module_uuid` so the registry row
        // has the stable identity the install-policy check keys on. Guaranteed
        // present by the gate above.
        moduleUuid: moduleInfo.moduleUuid,
        moduleName: moduleInfo.moduleName!,
        abbreviation: moduleInfo.abbreviation,
        version: moduleInfo.version,
        languageCode: moduleInfo.languageCode,
        databasePath: path.relative(path.dirname(this.modulesBasePath), destinationPath),
        sizeBytes,
        isIndexed: false,
        features: moduleInfo.features || [],
        metadata: moduleInfo.metadata
      });

      // Register in database
      const registeredModuleId = await this.registerModule(metadata);

      // Clean up compressed file if it exists
      if (sourcePath.endsWith('.gz') && fs.existsSync(sourcePath)) {
        fs.unlinkSync(sourcePath);
      }

      return {
        success: true,
        moduleId: registeredModuleId,
        moduleName: metadata.moduleName
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Verify module integrity
   */
  async verifyModule(dbPath: string): Promise<boolean> {
    try {
      // Check if file exists and is readable
      if (!fs.existsSync(dbPath)) {
        return false;
      }

      const stats = fs.statSync(dbPath);
      if (stats.size === 0) {
        return false;
      }

      // Try to open the database (this will be platform-specific)
      // For now, we'll do a basic file format check
      const header = Buffer.alloc(16);
      const fd = fs.openSync(dbPath, 'r');
      fs.readSync(fd, header, 0, 16, 0);
      fs.closeSync(fd);

      // Check SQLite file header
      const sqliteHeader = 'SQLite format 3\0';
      const headerStr = header.toString('utf8', 0, 16);

      return headerStr === sqliteHeader;
    } catch (error) {
      return false;
    }
  }

  /**
   * Register module in main database
   */
  async registerModule(moduleInfo: ModuleMetadata): Promise<number> {
    // Set installation date if not already set
    if (!moduleInfo.installedDate) {
      moduleInfo.installedDate = new Date().toISOString();
    }

    // Create the module
    const created = this.moduleMetadataRepo.create(moduleInfo);
    const newModuleId = created.moduleId!;

    // A7: module_id is a fresh AUTOINCREMENT value on every (re-)registration,
    // but highlights in the user DB are keyed to it. Remap any highlights from
    // this module's previous id so removing and re-adding a translation doesn't
    // orphan them. Best-effort - never blocks the install.
    await stabilizeModuleLinkage(
      this.mainDb,
      () => getSharedUserDb(),
      moduleInfo.moduleType,
      moduleInfo.abbreviation,
      newModuleId
    );

    return newModuleId;
  }

  /**
   * Uninstall a module
   */
  async uninstallModule(moduleId: number, _removeUserData: boolean = false): Promise<boolean> {
    try {
      // Get module metadata
      const module = this.moduleMetadataRepo.getById(moduleId);
      if (!module) {
        return false;
      }

      // Delete module file - resolve relative databasePath against modules base
      const absolutePath = path.resolve(path.dirname(this.modulesBasePath), module.databasePath);
      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
      }

      // Remove from database
      this.moduleMetadataRepo.delete(moduleId);

      // TODO: If removeUserData is true, delete user highlights, notes, etc.
      // This would require access to user database

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get module installation path
   * Uses flat layout: modules/bible_asv.db (matching moduleDetector convention)
   */
  getModulePath(moduleType: string, moduleId: string): string {
    const filename = `${moduleType}_${moduleId.toLowerCase()}.db`;
    return path.join(this.modulesBasePath, filename);
  }

  /**
   * Decompress a gzipped module file
   */
  async decompressModule(sourcePath: string, destinationPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const input = fs.createReadStream(sourcePath);
      const output = fs.createWriteStream(destinationPath);
      const gunzip = zlib.createGunzip();

      input
        .pipe(gunzip)
        .pipe(output)
        .on('finish', resolve)
        .on('error', reject);
    });
  }

  /**
   * Get module size on disk
   */
  async getModuleSize(dbPath: string): Promise<number> {
    try {
      const stats = fs.statSync(dbPath);
      return stats.size;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Structural + canon conformance gate for the untrusted install path (E3).
   *
   * Mirrors the critical MUST checks of `scripts/validate-module.js`, but runs
   * under Electron's `better-sqlite3` (the script's `sqlite3` driver cannot be
   * loaded in the main process). The module is opened READ-ONLY so this never
   * mutates the file being validated.
   *
   * Checks: `module_info` present with a single `info_id = 1` row; a valid
   * `module_uuid`; `canon` / `versification` carry the only accepted values;
   * `verse_link` and `schema_version` are present; and no Bible verse falls
   * outside the 66-book canon or exceeds a book's canonical chapter/verse counts
   * (the shifted-canon rejection). Text-hygiene checks are intentionally omitted
   * here - they gauge conversion quality, not reference-space safety.
   */
  validateModuleForInstall(dbPath: string): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    const Database = require('better-sqlite3-multiple-ciphers');
    let db: any;
    try {
      db = new Database(dbPath, { readonly: true });
    } catch (e) {
      return { ok: false, errors: [`Cannot open database: ${(e as Error).message}`] };
    }

    try {
      const tables = new Set<string>(
        db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
          .all()
          .map((r: { name: string }) => r.name)
      );

      // module_info: present, single row at info_id = 1, valid identity block.
      if (!tables.has('module_info')) {
        errors.push('`module_info` table is missing.');
      } else {
        const info = db.prepare('SELECT * FROM module_info WHERE info_id = 1').get();
        if (!info) {
          errors.push('`module_info` has no row with info_id = 1.');
        } else {
          if (!info.module_uuid || !MODULE_UUID_RE.test(String(info.module_uuid))) {
            errors.push('`module_info.module_uuid` is missing or not a valid UUID.');
          }
          if (info.canon !== undefined && info.canon !== REQUIRED_CANON) {
            errors.push(`\`canon\` = ${JSON.stringify(info.canon)}; only '${REQUIRED_CANON}' is accepted.`);
          }
          if (info.versification !== undefined && info.versification !== REQUIRED_VERSIFICATION) {
            errors.push(`\`versification\` = ${JSON.stringify(info.versification)}; only '${REQUIRED_VERSIFICATION}' is accepted.`);
          }
        }
      }

      // Required uniform tables (section 8).
      for (const t of ['verse_link', 'schema_version']) {
        if (!tables.has(t)) errors.push(`Required table \`${t}\` is missing.`);
      }

      // Shifted-canon rejection for Bible modules.
      if (tables.has('bible_verse')) {
        errors.push(...this.checkBibleCanonForInstall(db));
      }
    } catch (e) {
      errors.push(`Validation error: ${(e as Error).message}`);
    } finally {
      try { db.close(); } catch { /* already closed */ }
    }

    return { ok: errors.length === 0, errors };
  }

  /**
   * The canonical (book -> per-chapter verse counts) map, from `main.db`.
   * Returns an empty map when the reference space is unpopulated, in which case
   * the canon check is skipped rather than failing a valid module.
   */
  private loadCanonChapters(): Map<number, number[]> {
    const chapters = new Map<number, number[]>();
    try {
      const rows = this.mainDb.queryAll<{ book_number: number; chapter: number; verse_count: number }>(`
        SELECT b.book_number AS book_number, ci.chapter AS chapter, ci.verse_count AS verse_count
        FROM chapter_info ci
        JOIN bible_book b ON b.book_id = ci.book_id
        ORDER BY b.book_number, ci.chapter
      `);
      for (const row of rows) {
        if (!chapters.has(row.book_number)) chapters.set(row.book_number, []);
        chapters.get(row.book_number)![row.chapter - 1] = row.verse_count;
      }
    } catch {
      // main.db reference space unavailable - caller skips the canon check.
    }
    return chapters;
  }

  /**
   * Reject shifted / out-of-canon numbering. A canonical *subset* passes; only a
   * book outside 1-66 or a chapter/verse that exceeds the canonical count fails.
   */
  private checkBibleCanonForInstall(db: any): string[] {
    const errors: string[] = [];
    const canon = this.loadCanonChapters();
    if (canon.size === 0) return errors; // no reference space to check against

    const rows: { book_number: number; chapter: number; max_verse: number }[] = db.prepare(`
      SELECT verse_id / 1000000            AS book_number,
             (verse_id % 1000000) / 1000   AS chapter,
             MAX(verse_id % 1000)          AS max_verse
      FROM bible_verse
      GROUP BY book_number, chapter
    `).all();

    const maxChapterSeen = new Map<number, number>();
    for (const row of rows) {
      maxChapterSeen.set(row.book_number, Math.max(maxChapterSeen.get(row.book_number) ?? 0, row.chapter));
    }

    for (const row of rows) {
      const canonChapters = canon.get(row.book_number);
      if (row.book_number < 1 || row.book_number > MAX_BOOK_NUMBER || !canonChapters) {
        errors.push(`Book ${row.book_number} is outside the 66-book Protestant canon.`);
        continue;
      }
      if ((maxChapterSeen.get(row.book_number) ?? 0) > canonChapters.length) {
        errors.push(`Book ${row.book_number} has chapters beyond its canonical count (${canonChapters.length}).`);
      }
      const expectedVerses = canonChapters[row.chapter - 1];
      if (row.chapter >= 1 && row.chapter <= canonChapters.length && row.max_verse > expectedVerses) {
        errors.push(`Book ${row.book_number} chapter ${row.chapter}: verse ${row.max_verse} exceeds canonical count ${expectedVerses}.`);
      }
    }

    // De-duplicate (book-level messages can repeat across chapters).
    return [...new Set(errors)];
  }

  /**
   * Extract module information from a module database file
   * @param dbPath Path to module database (.db or .db.gz)
   * @returns Module metadata extracted from module_info table
   */
  async extractModuleInfo(dbPath: string): Promise<Partial<ModuleMetadata>> {
    let tempPath: string | undefined;
    let dbToRead = dbPath;

    try {
      // If .gz file, decompress to temp location first
      if (dbPath.endsWith('.gz')) {
        tempPath = dbPath.replace(/\.gz$/, '.temp.db');
        await this.decompressModule(dbPath, tempPath);
        dbToRead = tempPath;
      }

      // Verify it's a valid SQLite database
      const isValid = await this.verifyModule(dbToRead);
      if (!isValid) {
        throw new Error('Invalid module database file');
      }

      // Open database and read module_info table
      // Note: We need to use better-sqlite3 for synchronous access
      const Database = require('better-sqlite3-multiple-ciphers');
      const db = new Database(dbToRead, { readonly: true });

      try {
        // Check if module_info table exists
        const tableExists = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='module_info'"
        ).get();

        if (!tableExists) {
          throw new Error('module_info table not found - invalid module format');
        }

        // Read module_info
        const info = db.prepare('SELECT * FROM module_info LIMIT 1').get();

        if (!info) {
          throw new Error('module_info table is empty');
        }

        // Extract metadata. v2 renamed columns: `name` -> `full_name`,
        // `version` -> `content_version`. Fall back to the v1 names so a legacy
        // module still reads, but prefer the v2 columns.
        const metadata: Partial<ModuleMetadata> = {
          moduleType: info.module_type,
          // v2 identity. Absent in v1 modules; the conformance gate in
          // `validateModuleConformance` is what requires it for new content,
          // so reading it optionally here keeps legacy files importable.
          moduleUuid: info.module_uuid ?? undefined,
          moduleName: info.full_name ?? info.name ?? info.title,
          abbreviation: info.abbreviation,
          version: info.content_version ?? info.version,
          languageCode: info.language_code,
          features: info.features ? JSON.parse(info.features) : [],
          metadata: info.metadata ? JSON.parse(info.metadata) : {}
        };

        return metadata;
      } finally {
        db.close();
      }
    } catch (error) {
      throw new Error(`Failed to extract module info: ${(error as Error).message}`);
    } finally {
      // Clean up temp file if we created one
      if (tempPath && fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
  }

}
