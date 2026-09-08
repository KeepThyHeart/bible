/**
 * Commentary Link Processor (desktop UI wrapper)
 *
 * Thin wrapper around @bible/core's CommentaryLinkProcessor that manages
 * global context state (setContextBook/getContextBook) and maps to the
 * core's context-parameter API.
 */

import {
  processCommentaryLinks as coreProcessLinks,
  reprocessCommentaryLinks as coreReprocessLinks,
  LinkProcessorContext
} from '@bible/core';

// Context for auto-linking chapter:verse references without book prefix
let contextBookNumber: number | null = null;

/**
 * Set the context book for processing links.
 * When set, chapter:verse references without a book prefix will use this book.
 */
export function setContextBook(bookNumber: number | null): void {
  contextBookNumber = bookNumber;
}

/**
 * Get the current context book number.
 */
export function getContextBook(): number | null {
  return contextBookNumber;
}

function buildContext(contextBook?: number): LinkProcessorContext {
  const bookNumber = contextBook ?? contextBookNumber ?? 0;
  return { bookNumber, chapter: 1, matchBareChapterVerse: bookNumber > 0 };
}

/**
 * Process commentary content to add clickable verse links.
 */
export function processCommentaryLinks(content: string, contextBook?: number): string {
  if (!content) return content;
  return coreProcessLinks(content, buildContext(contextBook));
}

/**
 * Remove existing links from commentary content and re-process.
 */
export function reprocessCommentaryLinks(content: string, contextBook?: number): string {
  if (!content) return content;
  return coreReprocessLinks(content, buildContext(contextBook));
}
