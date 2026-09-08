import { ReferenceParser } from '@bible/core';

/**
 * Determines whether user input looks like a Bible reference.
 *
 * Two-gate check:
 *  1. The input must contain at least one digit (avoids bare book names
 *     like "acts" being treated as references).
 *  2. The existing `ReferenceParser.isReference()` must accept it.
 */
export class ReferenceClassifier {
  private parser: ReferenceParser;

  constructor() {
    this.parser = new ReferenceParser();
  }

  looksLikeReference(input: string): boolean {
    if (!/\d/.test(input)) return false;
    return this.parser.isReference(input);
  }
}
