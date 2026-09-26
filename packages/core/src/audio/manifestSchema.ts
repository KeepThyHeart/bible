/**
 * JSON Schemas for the two published audio documents, as plain data.
 *
 * These are the machine-readable half of the contract between the web app and
 * whatever produces the recordings (a separate project). `manifest.ts` holds
 * the validators the app runs; these schemas describe the same shapes for
 * other tools. Cross-field rules a schema cannot express (ascending verse
 * numbers, no overlaps, verses inside the duration) live only in the validators.
 */

import { AUDIO_INDEX_SCHEMA, CHAPTER_MANIFEST_SCHEMA } from './types';

export const CHAPTER_MANIFEST_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://bible.keepthyheart.com/schemas/audio-chapter-1.json',
  title: 'Audio chapter manifest',
  type: 'object',
  required: ['schema', 'module', 'book', 'chapter', 'narrator', 'rev', 'duration', 'files', 'verses'],
  additionalProperties: true,
  properties: {
    schema: { const: CHAPTER_MANIFEST_SCHEMA },
    module: { type: 'string', minLength: 1 },
    book: { type: 'integer', minimum: 1, maximum: 66 },
    chapter: { type: 'integer', minimum: 1 },
    narrator: { type: 'string', minLength: 1 },
    rev: { type: 'string', minLength: 1 },
    textHash: { type: 'string', minLength: 1 },
    duration: { type: 'number', exclusiveMinimum: 0 },
    files: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['codec', 'mime', 'path', 'bytes'],
        properties: {
          codec: { type: 'string', minLength: 1 },
          mime: { type: 'string', minLength: 1 },
          path: { type: 'string', minLength: 1 },
          bytes: { type: 'number', minimum: 0 },
          sha256: { type: 'string', minLength: 1 },
        },
      },
    },
    intro: { type: 'array', items: { type: 'number', minimum: 0 }, minItems: 2, maxItems: 2 },
    verses: {
      type: 'array',
      minItems: 1,
      items: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    },
  },
} as const;

export const AUDIO_INDEX_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://bible.keepthyheart.com/schemas/audio-index-1.json',
  title: 'Translation audio index',
  type: 'object',
  required: ['schema', 'module', 'narrators'],
  additionalProperties: true,
  properties: {
    schema: { const: AUDIO_INDEX_SCHEMA },
    module: { type: 'string', minLength: 1 },
    narrators: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'label', 'language', 'rev', 'books'],
        properties: {
          id: { type: 'string', minLength: 1 },
          label: { type: 'string', minLength: 1 },
          language: { type: 'string', minLength: 1 },
          rev: { type: 'string', minLength: 1 },
          books: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 66 } },
          chapters: {
            type: 'object',
            additionalProperties: { type: 'array', items: { type: 'integer', minimum: 1 } },
          },
        },
      },
    },
  },
} as const;
