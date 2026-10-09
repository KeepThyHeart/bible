/**
 * Central export for all IPC handlers
 */

export {
  registerNotesHandlers,
  initializeNotesDatabase,
  closeNotesDatabase
} from './notesHandlers';

export {
  registerCollectionHandlers,
  initializeCollectionService,
  closeCollectionService
} from './collectionHandlers';

export {
  registerFileNotesHandlers,
  initializeFileNotesService,
  getFileNotesService
} from './fileNotesHandlers';
