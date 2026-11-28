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
  {
    key: 'great-commission',
    get name() {
      return tc('memory.core.suggested.greatCommission.name', 'The Great Commission');
    },
    get blurb() {
      return tc('memory.core.suggested.greatCommission.blurb', 'Jesus\' last charge to his followers.');
    },
    references: ['Matthew 28:18-20'],
  },
  {
    key: 'armor-of-god',
    get name() {
      return tc('memory.core.suggested.armorOfGod.name', 'The Armor of God');
    },
    get blurb() {
      return tc('memory.core.suggested.armorOfGod.blurb', 'Ephesians 6 on standing firm.');
    },
    references: ['Ephesians 6:10-18'],
  },
  {
    key: 'love-chapter',
    get name() {
      return tc('memory.core.suggested.loveChapter.name', 'The Love Chapter');
    },
    get blurb() {
      return tc('memory.core.suggested.loveChapter.blurb', '1 Corinthians 13, whole.');
    },
    references: ['1 Corinthians 13:1-13'],
  },
  {
    key: 'assurance',
    get name() {
      return tc('memory.core.suggested.assurance.name', 'Assurance of Salvation');
    },
    get blurb() {
      return tc('memory.core.suggested.assurance.blurb', 'Verses on the security of those who believe.');
    },
    references: ['John 5:24', 'John 6:37', 'John 10:27-29', 'Romans 8:1', '1 John 5:11-13'],
  },
  {
    key: 'comfort-in-grief',
    get name() {
      return tc('memory.core.suggested.comfortInGrief.name', 'Comfort in Grief');
    },
    get blurb() {
      return tc('memory.core.suggested.comfortInGrief.blurb', 'Words for times of loss.');
    },
    references: ['Matthew 5:4', 'Psalm 34:18', 'John 11:25-26', '2 Corinthians 1:3-4', '1 Thessalonians 4:13-14', 'Revelation 21:4'],
  },
  {
    key: 'prayer',
    get name() {
      return tc('memory.core.suggested.prayer.name', 'On Prayer');
    },
    get blurb() {
      return tc('memory.core.suggested.prayer.blurb', 'What Scripture says about asking.');
    },
    references: ['Jeremiah 33:3', 'Matthew 7:7-8', 'Philippians 4:6', '1 Thessalonians 5:16-18', 'James 5:16', '1 John 5:14-15'],
  },
  {
    key: 'forgiveness',
    get name() {
      return tc('memory.core.suggested.forgiveness.name', 'Forgiveness');
    },
    get blurb() {
      return tc('memory.core.suggested.forgiveness.blurb', 'Forgiven, and forgiving others.');
    },
    references: ['Psalm 103:10-12', 'Isaiah 1:18', 'Matthew 6:14-15', 'Ephesians 4:32', 'Colossians 3:13', '1 John 1:9'],
  },
  {
    key: 'proverbs',
    get name() {
      return tc('memory.core.suggested.proverbs.name', 'Wisdom from Proverbs');
    },
    get blurb() {
      return tc('memory.core.suggested.proverbs.blurb', 'Short sayings for daily life.');
    },
    references: ['Proverbs 1:7', 'Proverbs 3:5-6', 'Proverbs 4:23', 'Proverbs 9:10', 'Proverbs 15:1', 'Proverbs 16:3', 'Proverbs 27:17'],
  },
  {
    key: 'mind-of-christ',
    get name() {
      return tc('memory.core.suggested.mindOfChrist.name', 'The Mind of Christ');
    },
    get blurb() {
      return tc('memory.core.suggested.mindOfChrist.blurb', 'Philippians 2 on the humility of Christ.');
    },
    references: ['Philippians 2:5-11'],
  },
  {
    key: 'suffering-servant',
    get name() {
      return tc('memory.core.suggested.sufferingServant.name', 'The Suffering Servant');
    },
    get blurb() {
      return tc('memory.core.suggested.sufferingServant.blurb', 'The heart of Isaiah 53.');
    },
    references: ['Isaiah 53:3-6'],
  },
  {
    key: 'romans-8',
    get name() {
      return tc('memory.core.suggested.romans8.name', 'More Than Conquerors');
    },
    get blurb() {
      return tc('memory.core.suggested.romans8.blurb', 'The close of Romans 8, in three parts.');
    },
    references: ['Romans 8:28-30', 'Romans 8:31-34', 'Romans 8:35-39'],
  },
  {
    key: 'word-made-flesh',
    get name() {
      return tc('memory.core.suggested.wordMadeFlesh.name', 'The Word Made Flesh');
    },
    get blurb() {
      return tc('memory.core.suggested.wordMadeFlesh.blurb', 'The opening of John\'s Gospel.');
    },
    references: ['John 1:1-14'],
  },
  {
    key: 'psalm-121',
    get name() {
      return tc('memory.core.suggested.psalm121.name', 'Psalm 121');
    },
    get blurb() {
      return tc('memory.core.suggested.psalm121.blurb', 'A song for the road, whole.');
    },
    references: ['Psalm 121:1-8'],
  },
  {
    key: 'psalm-139',
    get name() {
      return tc('memory.core.suggested.psalm139.name', 'Psalm 139');
    },
    get blurb() {
      return tc('memory.core.suggested.psalm139.blurb', 'Known and made by God, in three parts.');
    },
    references: ['Psalm 139:1-6', 'Psalm 139:13-16', 'Psalm 139:23-24'],
  },
  {
    key: 'fear-not',
    get name() {
      return tc('memory.core.suggested.fearNot.name', 'Fear Not');
    },
    get blurb() {
      return tc('memory.core.suggested.fearNot.blurb', 'Verses for courage.');
    },
    references: ['Deuteronomy 31:6', 'Joshua 1:9', 'Psalm 27:1', 'Psalm 56:3', 'Isaiah 43:1-2', '2 Timothy 1:7'],
  },
];

/**
 * English book names, in canon order: index + 1 is the book number used in
 * verse ids (`book * 1_000_000 + chapter * 1000 + verse`, the same encoding
 * `reference.ts#resolveRange` decodes).
 */
const BOOK_NAMES: readonly string[] = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah',
  'Esther', 'Job', 'Psalm', 'Proverbs', 'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah',
  'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum',
  'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians', 'Galatians',
  'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy',
  '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John',
  '3 John', 'Jude', 'Revelation',
];

/**
 * The verse-id range of one starter-set reference, synchronously, for the
 * starter browser's text preview. Only the plain shape the built-in sets use
 * is read: an English book name, then "chapter:verse" or
 * "chapter:verse-verse", within one chapter. Anything else is `null`. Adding a
 * set still goes through the worker's own parser (`addPassage`), which has the
 * final say.
 */
export function starterRange(reference: string): { startVerseId: number; endVerseId: number; verseCount: number } | null {
  const m = /^(.+?)\s+(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?$/.exec(reference.trim());
  if (!m) return null;
  const name = m[1] === 'Psalms' ? 'Psalm' : m[1];
  const book = BOOK_NAMES.indexOf(name) + 1;
  if (book === 0) return null;
  const chapter = Number(m[2]);
  const start = Number(m[3]);
  const end = m[4] !== undefined ? Number(m[4]) : start;
  if (chapter < 1 || start < 1 || end < start) return null;
  const base = book * 1_000_000 + chapter * 1000;
  return { startVerseId: base + start, endVerseId: base + end, verseCount: end - start + 1 };
}
