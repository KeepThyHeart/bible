/**
 * Built-in suggested verse lists for quick discovery and learning.
 *
 * Each list is a pure data structure with a key, display name, brief description,
 * and a fixed set of verse references. These are designed to be used as starting
 * points for users creating their own study plans.
 */

import { tc } from './messages';

export interface SuggestedList {
  /** Unique identifier for the list. */
  key: string;
  /** Display name shown to the user. */
  name: string;
  /** One-line description of the list's purpose. */
  blurb: string;
  /** Array of verse references in string format (e.g., "John 3:16", "Romans 3:23-25"). */
  references: string[];
}

/**
 * The built-in suggested verse lists.
 *
 * Each list is carefully chosen to stay under the MAX_PASSAGE_VERSES limit and to
 * serve a specific learning goal. References are formatted in a way that the user
 * can paste them into the app's reference input.
 */
export const SUGGESTED_LISTS: readonly SuggestedList[] = [
  {
    key: 'starter',
    get name() {
      return tc('memory.core.suggested.starter.name', 'Beginning Well');
    },
    get blurb() {
      return tc('memory.core.suggested.starter.blurb', 'Ten verses that carry most of the gospel.');
    },
    references: [
      'John 3:16',
      'Romans 3:23',
      'Romans 6:23',
      'Romans 5:8',
      'Romans 10:9',
      'Ephesians 2:8-9',
      '1 John 1:9',
      'Philippians 4:13',
      'Psalm 23:1',
      'Proverbs 3:5-6',
    ],
  },
  {
    key: 'romans-road',
    get name() {
      return tc('memory.core.suggested.romansRoad.name', 'The Romans Road');
    },
    get blurb() {
      return tc('memory.core.suggested.romansRoad.blurb', 'The classic six-step walk through Romans.');
    },
    references: [
      'Romans 3:10',
      'Romans 3:23',
      'Romans 5:8',
      'Romans 6:23',
      'Romans 10:9-10',
      'Romans 10:13',
    ],
  },
  {
    key: 'psalm-23',
    get name() {
      return tc('memory.core.suggested.psalm23.name', 'Psalm 23');
    },
    get blurb() {
      return tc('memory.core.suggested.psalm23.blurb', 'The shepherd psalm, whole.');
    },
    references: ['Psalm 23:1-6'],
  },
  {
    key: 'beatitudes',
    get name() {
      return tc('memory.core.suggested.beatitudes.name', 'The Beatitudes');
    },
    get blurb() {
      return tc('memory.core.suggested.beatitudes.blurb', 'The opening of the Sermon on the Mount.');
    },
    references: ['Matthew 5:3-12'],
  },
  {
    key: 'lords-prayer',
    get name() {
      return tc('memory.core.suggested.lordsPrayer.name', 'The Lord\'s Prayer');
    },
    get blurb() {
      return tc('memory.core.suggested.lordsPrayer.blurb', 'Matthew\'s form, as taught.');
    },
    references: ['Matthew 6:9-13'],
  },
  {
    key: 'anxious-days',
    get name() {
      return tc('memory.core.suggested.anxiousDays.name', 'Promises for Anxious Days');
    },
    get blurb() {
      return tc('memory.core.suggested.anxiousDays.blurb', 'Six places to go when the mind will not settle.');
    },
    references: [
      'Isaiah 41:10',
      'Philippians 4:6-7',
      '1 Peter 5:6-7',
      'Matthew 6:33-34',
      'Psalm 34:4',
      'John 14:27',
    ],
  },
  {
    key: 'fruit',
    get name() {
      return tc('memory.core.suggested.fruit.name', 'Fruit of the Spirit');
    },
    get blurb() {
      return tc('memory.core.suggested.fruit.blurb', 'One passage, nine words to keep straight.');
    },
    references: ['Galatians 5:22-23'],
  },
  {
    key: 'psalm-1',
    get name() {
      return tc('memory.core.suggested.psalm1.name', 'Psalm 1');
    },
    get blurb() {
      return tc('memory.core.suggested.psalm1.blurb', 'The two ways.');
    },
    references: ['Psalm 1:1-6'],
  },
  {
    key: 'ten-commandments',
    get name() {
      return tc('memory.core.suggested.tenCommandments.name', 'The Ten Commandments');
    },
    get blurb() {
      return tc('memory.core.suggested.tenCommandments.blurb', 'Exodus 20, in full.');
    },
    references: ['Exodus 20:1-17'],
  },
];
