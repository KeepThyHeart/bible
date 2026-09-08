import { UserTextMarkupRepository } from '@bible/core';
import { UserTextMarkup, VerseId } from '@bible/core';
import type { ISql, TextMarkupMetadata } from '@bible/core';
import { getSharedUserDb } from '../services/sharedUserDb';
import { initializeUserSchema } from '../schema/userSchema';
import { validateMarkupColor } from '../utils/validation';
import { ipcHandler, IpcKnownError } from './handler-helper';

/**
 * Shape of highlight/markup data received over IPC.
 *
 * `color` is typed `string` because it is untrusted renderer input and because
 * stored colours are hex `#RRGGBB` (v2) or a v1 palette name - not necessarily
 * a `HighlightColor`. It is run through {@link validateMarkupColor} before it
 * reaches the database.
 */
interface HighlightData {
  markupId?: number;
  moduleId: number;
  verseIdStart: VerseId;
  verseIdEnd?: VerseId;
  textStart?: number;
  textEnd?: number;
  color: string;
  noteId?: number;
  createdDate?: string;
  metadata?: TextMarkupMetadata;
}

/** Serialized representation of a UserTextMarkup for IPC transmission */
interface SerializedMarkup {
  markupId?: number;
  moduleId: number;
  verseIdStart: VerseId;
  verseIdEnd?: VerseId;
  textStart?: number;
  textEnd?: number;
  /** Hex `#RRGGBB` (v2) or, for not-yet-migrated rows, a v1 palette name. */
  color: string;
  noteId?: number;
  createdDate?: string;
  metadata?: TextMarkupMetadata;
}

/**
 * Validate an untrusted colour from the renderer, reporting a rejection as a
 * classified `invalid_input` failure rather than an unexpected internal error.
 */
function checkColor(value: unknown): string {
  try {
    return validateMarkupColor(value);
  } catch (err) {
    throw new IpcKnownError('invalid_input', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Build a `UserTextMarkup` from untrusted IPC input, rejecting a colour the
 * core palette rules do not recognise.
 */
function toMarkup(data: HighlightData): UserTextMarkup {
  return new UserTextMarkup({ ...data, color: checkColor(data.color) });
}

let highlightRepository: UserTextMarkupRepository | null = null;
/**
 * In-flight initialization, so concurrent callers await the same open instead
 * of each starting their own.
 */
let highlightRepositoryInit: Promise<UserTextMarkupRepository> | null = null;

/**
 * Initialize the highlight repository using shared user database
 */
export async function initializeHighlightRepository(username: string = 'default') {
  if (highlightRepository) return highlightRepository;
  if (!highlightRepositoryInit) {
    highlightRepositoryInit = (async () => {
      const userDb = await getSharedUserDb(username);
      ensureMarkupTable(userDb);
      const repository = new UserTextMarkupRepository(userDb);
      highlightRepository = repository;
      console.log('Highlight repository initialized successfully');
      return repository;
    })().catch(err => {
      // Clear the memo so a later call retries rather than being stuck on a
      // rejected promise for the life of the process.
      highlightRepositoryInit = null;
      throw err;
    });
  }
  return highlightRepositoryInit;
}

/**
 * Ensure user_text_markup table exists (delegates to centralized schema)
 */
function ensureMarkupTable(db: ISql): void {
  initializeUserSchema(db);
}

/**
 * Get the highlight repository, opening the user database if this is the first
 * call.
 *
 * Deliberately async: kicking off `initializeHighlightRepository()` without
 * awaiting it and re-checking the module-level variable on the next line
 * cannot work, because that variable is not set yet. Every call before
 * `main.ts`'s background pre-warm finished would throw `unavailable`, and that
 * rejection is swallowed further up, so it looks like the click did nothing.
 */
async function getHighlightRepository(): Promise<UserTextMarkupRepository> {
  if (highlightRepository) return highlightRepository;
  try {
    return await initializeHighlightRepository();
  } catch (err) {
    throw new IpcKnownError(
      'unavailable',
      `Highlight repository not initialized: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Register all IPC handlers for highlight operations.
 *
 * This handler family uses the `ipcHandler` envelope helper. Replies use
 * `Result<T> = { ok, value } | { ok: false, error }`.
 * The renderer side lives in `src/ui/services/highlightsAPI.ts` and uses
 * `unwrap` from `src/ui/services/ipcResult.ts`.
 */
export function registerHighlightHandlers() {
  ipcHandler<[HighlightData], SerializedMarkup>('highlights:create', async (highlightData) => {
    const repository = await getHighlightRepository();
    const created = await repository.create(toMarkup(highlightData));
    return serializeMarkup(created);
  });

  ipcHandler<[HighlightData], void>('highlights:update', async (highlightData) => {
    const repository = await getHighlightRepository();
    await repository.update(toMarkup(highlightData));
  });

  ipcHandler<[number], void>('highlights:delete', async (markupId) => {
    const repository = await getHighlightRepository();
    await repository.delete(markupId);
  });

  ipcHandler<[number], SerializedMarkup | null>('highlights:get-by-id', async (markupId) => {
    const repository = await getHighlightRepository();
    const markup = await repository.getById(markupId);
    return markup ? serializeMarkup(markup) : null;
  });

  ipcHandler<[VerseId, number], SerializedMarkup[]>(
    'highlights:get-for-verse',
    async (verseId, moduleId) => {
      const repository = await getHighlightRepository();
      const markups = await repository.getForVerse(verseId, moduleId);
      return markups.map(serializeMarkup);
    }
  );

  ipcHandler<[VerseId, VerseId, number], SerializedMarkup[]>(
    'highlights:get-for-verse-range',
    async (startVerseId, endVerseId, moduleId) => {
      const repository = await getHighlightRepository();
      const markups = await repository.getForVerseRange(startVerseId, endVerseId, moduleId);
      return markups.map(serializeMarkup);
    }
  );

  ipcHandler<[number], SerializedMarkup[]>('highlights:get-for-module', async (moduleId) => {
    const repository = await getHighlightRepository();
    const markups = await repository.getForModule(moduleId);
    return markups.map(serializeMarkup);
  });

  ipcHandler<[string, number | undefined], SerializedMarkup[]>(
    'highlights:get-by-color',
    async (color, moduleId) => {
      const repository = await getHighlightRepository();
      const markups = await repository.getByColor(checkColor(color), moduleId);
      return markups.map(serializeMarkup);
    }
  );

  ipcHandler<[VerseId, number], void>(
    'highlights:delete-for-verse',
    async (verseId, moduleId) => {
      const repository = await getHighlightRepository();
      await repository.deleteForVerse(verseId, moduleId);
    }
  );

  ipcHandler<[number], number>('highlights:count-for-module', async (moduleId) => {
    const repository = await getHighlightRepository();
    return repository.countForModule(moduleId);
  });

  ipcHandler<[number], SerializedMarkup[]>('highlights:get-by-note', async (noteId) => {
    const repository = await getHighlightRepository();
    const markups = await repository.getByNote(noteId);
    return markups.map(serializeMarkup);
  });

  ipcHandler<[VerseId, VerseId, number], void>(
    'highlights:delete-for-verse-range',
    async (startVerseId, endVerseId, moduleId) => {
      const repository = await getHighlightRepository();
      await repository.deleteForVerseRange(startVerseId, endVerseId, moduleId);
    }
  );

  ipcHandler<[VerseId, VerseId | null, number], SerializedMarkup[]>(
    'highlights:find-overlapping',
    async (start, end, moduleId) => {
      const repository = await getHighlightRepository();
      const markups = await repository.findOverlapping(start, end, moduleId);
      return markups.map(serializeMarkup);
    }
  );
}

/**
 * Serialize UserTextMarkup for IPC transmission
 */
function serializeMarkup(markup: UserTextMarkup): SerializedMarkup {
  return {
    markupId: markup.markupId,
    moduleId: markup.moduleId,
    verseIdStart: markup.verseIdStart,
    verseIdEnd: markup.verseIdEnd,
    textStart: markup.textStart,
    textEnd: markup.textEnd,
    color: markup.color,
    noteId: markup.noteId,
    createdDate: markup.createdDate,
    metadata: markup.metadata
  };
}

/**
 * Clean up highlight repository (DB is closed by sharedUserDb)
 */
export function closeHighlightRepository() {
  highlightRepository = null;
}
