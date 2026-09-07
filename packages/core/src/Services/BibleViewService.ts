import { IBibleRepository } from '../Data/Repositories/IBibleRepository';
import { IEnrichmentRepository, EnrichmentUnit } from '../Data/Repositories/IEnrichmentRepository';
import { VerseIdHelper } from '../Data/Core/Types';
import { formatVerseText } from './VerseFormatter';
import { VerseOfTheDayService } from './VerseOfTheDayService';

export interface ChapterVerse {
  verse_id: number;
  book_number: number;
  chapter: number;
  verse: number;
  text: string;
  text_html: string;
  is_paragraph_start: boolean;
  words_of_christ: boolean;
  footnotes?: Array<{ marker: string; text: string }>;
  section_heading?: string;
}

export interface DeduplicatedTopic {
  title: string;
  chapter: number;
  verse: number;
  endChapter: number;
  endVerse: number;
}

export interface VotdResult {
  book: number;
  chapter: number;
  verse: number;
  verse_id: number;
  text: string;
  text_html: string;
  holiday?: string;
}

/**
 * Service for assembling Bible view data - chapter formatting, topic deduplication,
 * and verse-of-the-day retrieval. Framework-agnostic: usable by both web routes
 * and desktop IPC handlers.
 */
export class BibleViewService {
  constructor(
    private enrichmentRepo: IEnrichmentRepository | null,
  ) {}

  /**
   * Format a chapter's verses into display-ready objects.
   */
  getFormattedChapter(repo: IBibleRepository, book: number, chapter: number): ChapterVerse[] {
    const verses = repo.getChapter(book, chapter);
    return verses.map((verse) => {
      const parsed = VerseIdHelper.parse(verse.verseId);
      const { textHtml, isParagraphStart, sectionHeading } = formatVerseText(verse);
      const footnotes = verse.getFootnotes();
      return {
        verse_id: verse.verseId,
        book_number: parsed.bookNumber,
        chapter: parsed.chapter,
        verse: parsed.verse,
        text: verse.text,
        text_html: textHtml,
        is_paragraph_start: isParagraphStart,
        words_of_christ: verse.hasWordsOfChrist(),
        footnotes: footnotes.length > 0 ? footnotes : undefined,
        section_heading: sectionHeading,
      };
    });
  }

  /**
   * Get section topics for a book from the enrichments database,
   * deduplicating by title text within each chapter.
   */
  getBookTopics(bookNumber: number): DeduplicatedTopic[] {
    if (!this.enrichmentRepo) return [];

    const rows = this.enrichmentRepo.getBookTopics(bookNumber);
    return BibleViewService.deduplicateTopics(rows);
  }

  /**
   * Deduplicate enrichment unit topics: group by title text + chapter, prefer wider ranges.
   */
  static deduplicateTopics(rows: EnrichmentUnit[]): DeduplicatedTopic[] {
    const titleMap = new Map<string, DeduplicatedTopic>();

    for (const row of rows) {
      let titleText: string;
      try {
        const parsed = JSON.parse(row.title);
        titleText = Array.isArray(parsed) ? parsed[0] : String(parsed);
      } catch {
        titleText = row.title;
      }

      const chapter = Math.floor((row.startVerseId % 1000000) / 1000);
      const verse = row.startVerseId % 1000;
      const endChapter = Math.floor((row.endVerseId % 1000000) / 1000);
      const endVerse = row.endVerseId % 1000;

      const key = `${titleText}:${chapter}`;
      const existing = titleMap.get(key);
      if (!existing || row.level === 'paragraph' || row.level === 'chapter') {
        titleMap.set(key, { title: titleText, chapter, verse, endChapter, endVerse });
      }
    }

    return Array.from(titleMap.values());
  }

  /**
   * Get the verse of the day with formatted text.
   */
  getVerseOfTheDay(votdService: VerseOfTheDayService, repo: IBibleRepository): VotdResult {
    const votd = votdService.getToday();
    const verseId = VerseIdHelper.calculate(votd.book, votd.chapter, votd.verse);

    let text = '';
    let textHtml = '';
    const verse = repo.getVerse(verseId);
    if (verse) {
      const formatted = formatVerseText(verse);
      text = verse.textPlain || verse.text;
      textHtml = formatted.textHtml;
    }

    return {
      book: votd.book,
      chapter: votd.chapter,
      verse: votd.verse,
      verse_id: verseId,
      text,
      text_html: textHtml,
      holiday: votd.holiday,
    };
  }
}
