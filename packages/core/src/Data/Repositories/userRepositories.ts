/**
 * The browser-safe user-data repositories, re-exported as one small module so the web user-DB worker
 * (and anything else that needs them without the Node-only root barrel) can reach them through
 * `UserRepositories` in `browser.ts`. Each takes an `ISql`.
 */
export { UserNoteRepository } from './UserNoteRepository';
export { UserCommentaryRepository } from './UserCommentaryRepository';
export { UserTextMarkupRepository } from './UserTextMarkupRepository';
export { CollectionRepository } from './CollectionRepository';
export { UserCrossReferenceRepository } from './UserCrossReferenceRepository';
export { VerseLinkRepository } from './VerseLinkRepository';
export { UserDataRepository } from './UserDataRepository';
