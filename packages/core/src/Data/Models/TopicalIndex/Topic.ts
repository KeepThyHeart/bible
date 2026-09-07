import { Metadata } from '../../Core/Types';

/**
 * Topic entity from a topical index module database.
 *
 * A topic is primarily a heading with verses hanging off it, so a topic with no
 * prose at all is the normal case, not a deficient one. Where a work does carry
 * prose, note the split:
 *
 *   {@link description}  A short annotation on the heading - a parenthetical
 *                        gloss, or the "See X. See Y." redirect lists Nave's
 *                        uses. Navigation and labelling. NOT full-text indexed,
 *                        so a redirect to "Bread" does not make the topic a hit
 *                        for "bread".
 *   {@link content}      The entry's own prose body: an explanatory note, a
 *                        definition, an editorial comment. Full-text indexed.
 */
export class Topic {
  topicId?: number;
  parentTopicId?: number;
  name: string;
  /** Short annotation on the heading. See the class note for the split. */
  description?: string;
  /** The topic's prose body, where the work has one. See the class note. */
  content?: string;
  /** Path to the body held outside the database; alternative to `content`. */
  contentFile?: string;
  /** Words in `content`; a snapshot taken at import, not maintained. */
  wordCount?: number;
  sortOrder?: number;
  metadata?: Metadata;

  constructor(data: {
    topicId?: number;
    parentTopicId?: number;
    name: string;
    description?: string;
    content?: string;
    contentFile?: string;
    wordCount?: number;
    sortOrder?: number;
    metadata?: Metadata;
  }) {
    this.topicId = data.topicId;
    this.parentTopicId = data.parentTopicId;
    this.name = data.name;
    this.description = data.description;
    this.content = data.content;
    this.contentFile = data.contentFile;
    this.wordCount = data.wordCount;
    this.sortOrder = data.sortOrder;
    this.metadata = data.metadata;
  }

  /** True if this topic carries a prose body of its own. */
  hasContent(): boolean {
    return (this.content !== undefined && this.content !== '')
      || (this.contentFile !== undefined && this.contentFile !== '');
  }

  /**
   * Check if this is a root-level topic (no parent)
   */
  isRoot(): boolean {
    return this.parentTopicId === undefined || this.parentTopicId === null;
  }

  /**
   * Get a description excerpt
   */
  getDescriptionExcerpt(maxLength: number = 100): string {
    if (!this.description) return '';
    const plainText = this.description.replace(/<[^>]*>/g, '');
    return plainText.length > maxLength
      ? plainText.substring(0, maxLength) + '...'
      : plainText;
  }
}
