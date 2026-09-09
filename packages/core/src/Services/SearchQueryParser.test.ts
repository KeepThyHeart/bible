import { describe, it, expect } from 'vitest';
import { SearchQueryParser } from './SearchQueryParser';

describe('SearchQueryParser', () => {
  const parser = new SearchQueryParser();

  // ==========================================================================
  // Query Type Detection
  // ==========================================================================

  describe('Query Type Detection', () => {
    it('should detect multi-word search (default)', () => {
      const result = parser.parse('love joy peace');
      expect(result.searchType).toBe('multi-word');
      expect(result.terms).toEqual(['love', 'joy', 'peace']);
    });

    it('should detect phrase search with quotes', () => {
      const result = parser.parse('"For God so loved"');
      expect(result.searchType).toBe('phrase');
      expect(result.phrase).toBe('For God so loved');
    });

    it('should detect word proximity search (~50w)', () => {
      const result = parser.parse('love peace ~50w');
      expect(result.searchType).toBe('proximity');
      expect(result.proximity?.terms).toEqual(['love', 'peace']);
      expect(result.proximity?.distance).toBe(50);
    });

    it('should detect word proximity search (~50 without w)', () => {
      const result = parser.parse('ant sluggard ~50');
      expect(result.searchType).toBe('proximity');
      expect(result.proximity?.terms).toEqual(['ant', 'sluggard']);
      expect(result.proximity?.distance).toBe(50);
    });

    it('should detect verse proximity search (~5v)', () => {
      const result = parser.parse('faith hope ~5v');
      expect(result.searchType).toBe('verse-proximity');
      expect(result.verseProximity?.terms).toEqual(['faith', 'hope']);
      expect(result.verseProximity?.distance).toBe(5);
    });

    it('should detect boolean search with AND (requires parentheses)', () => {
      const result = parser.parse('(love AND peace)');
      expect(result.searchType).toBe('boolean');
      expect(result.boolean?.operator).toBe('AND');
      expect(result.boolean?.left).toBe('love');
      expect(result.boolean?.right).toBe('peace');
    });

    it('should detect boolean search with OR (requires parentheses)', () => {
      const result = parser.parse('(love OR hate)');
      expect(result.searchType).toBe('boolean');
      expect(result.boolean?.operator).toBe('OR');
    });

    it('should detect boolean search with NOT (requires parentheses)', () => {
      const result = parser.parse('(NOT evil)');
      expect(result.searchType).toBe('boolean');
      expect(result.boolean?.operator).toBe('NOT');
      expect(result.boolean?.left).toBe('evil');
    });

    it('should treat AND/OR/NOT as regular words without parentheses', () => {
      // Without parentheses, these are just multi-word searches
      const result1 = parser.parse('believed not');
      expect(result1.searchType).toBe('multi-word');
      expect(result1.terms).toEqual(['believed', 'not']);

      const result2 = parser.parse('love AND peace');
      expect(result2.searchType).toBe('multi-word');
      expect(result2.terms).toEqual(['love', 'AND', 'peace']);
    });

    it('should detect fuzzy search with ~word', () => {
      const result = parser.parse('~neighbor');
      expect(result.searchType).toBe('fuzzy');
      expect(result.fuzzy?.term).toBe('neighbor');
      expect(result.fuzzy?.distance).toBe(2);
    });

    it('should detect regex search with /pattern/', () => {
      const result = parser.parse('/beg[ai]n/');
      expect(result.searchType).toBe('regex');
      expect(result.regex).toBe('beg[ai]n');
    });

    it('should detect Strong\'s number search (Greek)', () => {
      const result = parser.parse('G26');
      expect(result.searchType).toBe('strongs');
      expect(result.strongs).toBe('G26');
    });

    it('should detect Strong\'s number search (Hebrew)', () => {
      const result = parser.parse('H430');
      expect(result.searchType).toBe('strongs');
      expect(result.strongs).toBe('H430');
    });

    it('should handle case-insensitive Strong\'s numbers', () => {
      const result = parser.parse('g26');
      expect(result.searchType).toBe('strongs');
      expect(result.strongs).toBe('G26');
    });
  });

  // ==========================================================================
  // Term Extraction
  // ==========================================================================

  describe('Term Extraction', () => {
    it('should extract simple terms', () => {
      const result = parser.parse('love peace joy');
      expect(result.terms).toEqual(['love', 'peace', 'joy']);
    });

    it('should extract terms with extra whitespace', () => {
      const result = parser.parse('  love   peace   joy  ');
      expect(result.terms).toEqual(['love', 'peace', 'joy']);
    });

    it('should handle single term', () => {
      const result = parser.parse('love');
      expect(result.terms).toEqual(['love']);
    });

    it('should extract phrases from mixed query', () => {
      const phrases = parser.extractPhrases('"greatest of these" love "faith hope"');
      expect(phrases).toEqual(['greatest of these', 'faith hope']);
    });

    it('should remove phrases from query', () => {
      const remaining = parser.removePhrases('"greatest of these" love "faith hope" charity');
      expect(remaining).toBe('love  charity');
    });
  });

  // ==========================================================================
  // Proximity Parsing
  // ==========================================================================

  describe('Proximity Parsing', () => {
    it('should parse word proximity with multiple terms', () => {
      const result = parser.parse('ant sluggard slothful ~50w');
      expect(result.searchType).toBe('proximity');
      expect(result.proximity?.terms).toEqual(['ant', 'sluggard', 'slothful']);
      expect(result.proximity?.distance).toBe(50);
    });

    it('should parse word proximity with two terms', () => {
      const result = parser.parse('faith works ~20w');
      expect(result.proximity?.terms).toEqual(['faith', 'works']);
      expect(result.proximity?.distance).toBe(20);
    });

    it('should parse verse proximity with multiple terms', () => {
      const result = parser.parse('Paul Timothy Ephesus ~3v');
      expect(result.searchType).toBe('verse-proximity');
      expect(result.verseProximity?.terms).toEqual(['Paul', 'Timothy', 'Ephesus']);
      expect(result.verseProximity?.distance).toBe(3);
    });

    it('should parse proximity distance correctly', () => {
      const result1 = parser.parse('word1 word2 ~10w');
      expect(result1.proximity?.distance).toBe(10);

      const result2 = parser.parse('word1 word2 ~100w');
      expect(result2.proximity?.distance).toBe(100);
    });

    it('should handle proximity with phrases', () => {
      const result = parser.parse('"greatest of these" love ~10w');
      expect(result.searchType).toBe('proximity');
      expect(result.proximity?.terms).toContain('greatest of these');
      expect(result.proximity?.terms).toContain('love');
    });
  });

  // ==========================================================================
  // Boolean Operator Parsing
  // ==========================================================================

  describe('Boolean Operator Parsing', () => {
    it('should parse AND operator (with parentheses)', () => {
      const result = parser.parse('(faith AND works)');
      expect(result.boolean?.operator).toBe('AND');
      expect(result.boolean?.left).toBe('faith');
      expect(result.boolean?.right).toBe('works');
    });

    it('should parse OR operator (with parentheses)', () => {
      const result = parser.parse('(Jerusalem OR Zion)');
      expect(result.boolean?.operator).toBe('OR');
      expect(result.boolean?.left).toBe('Jerusalem');
      expect(result.boolean?.right).toBe('Zion');
    });

    it('should parse NOT operator (with parentheses)', () => {
      const result = parser.parse('(NOT wicked)');
      expect(result.boolean?.operator).toBe('NOT');
      expect(result.boolean?.left).toBe('wicked');
    });

    // Nesting has to survive into the tree. Running each operand through
    // `.replace(/[()]/g, '')` makes an inner group arrive as a string nothing
    // ever parses again, silently losing the grouping.
    it('keeps a nested group as a subtree instead of flattening it to a string', () => {
      const result = parser.parse('(faith AND (hope OR love))');
      expect(result.boolean?.operator).toBe('AND');
      expect(result.boolean?.left).toBe('faith');

      const right = result.boolean?.right;
      expect(typeof right).toBe('object');
      expect(right).toMatchObject({ operator: 'OR', left: 'hope', right: 'love' });
    });

    it('gives NOT tighter binding than AND', () => {
      const result = parser.parse('(faith AND NOT works)');
      expect(result.boolean?.operator).toBe('AND');
      expect(result.boolean?.left).toBe('faith');
      expect(result.boolean?.right).toMatchObject({ operator: 'NOT', left: 'works' });
    });

    it('parses the binary exclusion form', () => {
      const result = parser.parse('(faith NOT works)');
      expect(result.boolean?.operator).toBe('NOT');
      expect(result.boolean?.left).toBe('faith');
      expect(result.boolean?.right).toBe('works');
    });

    it('gives AND tighter binding than OR', () => {
      const result = parser.parse('(a AND b OR c)');
      expect(result.boolean?.operator).toBe('OR');
      expect(result.boolean?.left).toMatchObject({ operator: 'AND', left: 'a', right: 'b' });
      expect(result.boolean?.right).toBe('c');
    });

    it('treats a run of bare words as one leaf', () => {
      const result = parser.parse('(kingdom of heaven OR kingdom of God)');
      expect(result.boolean?.operator).toBe('OR');
      expect(result.boolean?.left).toBe('kingdom of heaven');
      expect(result.boolean?.right).toBe('kingdom of God');
    });

    it('falls back to a single leaf rather than failing on unbalanced parentheses', () => {
      const result = parser.parse('(faith AND works');
      expect(result.searchType).toBe('boolean');
      expect(result.boolean?.operator).toBe('AND');
    });

    it('should handle case-insensitive operators (with parentheses)', () => {
      const result1 = parser.parse('(love and peace)');
      expect(result1.searchType).toBe('boolean');

      const result2 = parser.parse('(love or hate)');
      expect(result2.searchType).toBe('boolean');

      const result3 = parser.parse('(not evil)');
      expect(result3.searchType).toBe('boolean');
    });

    it('should detect parentheses as boolean indicator', () => {
      const result = parser.parse('(love peace)');
      expect(result.searchType).toBe('boolean');
    });

    it('should treat operators as regular words without parentheses', () => {
      // Without parentheses, AND/OR/NOT are just search terms
      const result1 = parser.parse('faith AND works');
      expect(result1.searchType).toBe('multi-word');

      const result2 = parser.parse('NOT wicked');
      expect(result2.searchType).toBe('multi-word');
      expect(result2.terms).toEqual(['NOT', 'wicked']);
    });
  });

  // ==========================================================================
  // Validation
  // ==========================================================================

  describe('Validation', () => {
    it('should reject empty query', () => {
      const error = parser.validate('');
      expect(error).toBe('Search query cannot be empty');
    });

    it('should reject whitespace-only query', () => {
      const error = parser.validate('   ');
      expect(error).toBe('Search query cannot be empty');
    });

    it('should detect unmatched opening quote', () => {
      const error = parser.validate('"love peace');
      expect(error).toBe('Unmatched quote in search query');
    });

    it('should detect unmatched closing quote', () => {
      const error = parser.validate('love peace"');
      expect(error).toBe('Unmatched quote in search query');
    });

    it('should detect unmatched opening parenthesis', () => {
      const error = parser.validate('(love AND peace');
      expect(error).toBe('Unmatched opening parenthesis');
    });

    it('should detect unmatched closing parenthesis', () => {
      const error = parser.validate('love AND peace)');
      expect(error).toBe('Unmatched closing parenthesis');
    });

    it('should detect closing before opening parenthesis', () => {
      const error = parser.validate(')love AND peace(');
      expect(error).toBe('Unmatched closing parenthesis');
    });

    it('should validate correctly matched quotes', () => {
      const error = parser.validate('"love" "peace"');
      expect(error).toBeUndefined();
    });

    it('should validate correctly matched parentheses', () => {
      const error = parser.validate('(love AND (peace OR joy))');
      expect(error).toBeUndefined();
    });

    it('should detect invalid regex pattern', () => {
      const error = parser.validate('/[unclosed/');
      expect(error).toContain('Invalid regular expression');
    });

    it('should accept valid regex pattern', () => {
      const error = parser.validate('/[abc]+/');
      expect(error).toBeUndefined();
    });

    it('should accept valid queries', () => {
      expect(parser.validate('love peace joy')).toBeUndefined();
      expect(parser.validate('"For God so loved"')).toBeUndefined();
      expect(parser.validate('love peace ~50w')).toBeUndefined();
      expect(parser.validate('(faith AND works)')).toBeUndefined();
      expect(parser.validate('~neighbor')).toBeUndefined();
      expect(parser.validate('G26')).toBeUndefined();
    });
  });

  // ==========================================================================
  // Reference Detection
  // ==========================================================================

  describe('Reference Detection', () => {
    it('should detect book and chapter reference', () => {
      expect(parser.isReference('John 3')).toBe(true);
      expect(parser.isReference('Genesis 1')).toBe(true);
      expect(parser.isReference('Romans 8')).toBe(true);
    });

    it('should detect full verse reference', () => {
      expect(parser.isReference('John 3:16')).toBe(true);
      expect(parser.isReference('Genesis 1:1')).toBe(true);
      expect(parser.isReference('Psalm 23:1')).toBe(true);
    });

    it('should detect verse range reference', () => {
      expect(parser.isReference('John 3:16-18')).toBe(true);
      expect(parser.isReference('Romans 8:28-30')).toBe(true);
    });

    it('should detect numbered books', () => {
      expect(parser.isReference('1 John 3:16')).toBe(true);
      expect(parser.isReference('2 Corinthians 5:17')).toBe(true);
      expect(parser.isReference('3 John 1:4')).toBe(true);
    });

    it('should not detect search queries as references', () => {
      expect(parser.isReference('love peace joy')).toBe(false);
      expect(parser.isReference('"For God so loved"')).toBe(false);
      expect(parser.isReference('(faith AND works)')).toBe(false);
    });

    it('should not detect proximity searches as references', () => {
      expect(parser.isReference('love peace ~50w')).toBe(false);
    });

    it('should handle abbreviations', () => {
      expect(parser.isReference('Jn 3:16')).toBe(true);
      expect(parser.isReference('Rom 8:28')).toBe(true);
      expect(parser.isReference('Gen 1:1')).toBe(true);
    });
  });

  // ==========================================================================
  // Spelling Suggestions (KJV Variants)
  // ==========================================================================

  describe('Spelling Suggestions', () => {
    it('should suggest KJV spelling for neighbor', () => {
      const suggestions = parser.getSuggestions('neighbor');
      expect(suggestions).toContain('neighbour');
    });

    it('should suggest KJV spelling for honor', () => {
      const suggestions = parser.getSuggestions('honor');
      expect(suggestions).toContain('honour');
    });

    it('should suggest KJV spelling for favor', () => {
      const suggestions = parser.getSuggestions('favor');
      expect(suggestions).toContain('favour');
    });

    it('should suggest KJV spelling for labor', () => {
      const suggestions = parser.getSuggestions('labor');
      expect(suggestions).toContain('labour');
    });

    it('should suggest KJV spelling for savior', () => {
      const suggestions = parser.getSuggestions('savior');
      expect(suggestions).toContain('saviour');
    });

    it('should handle queries with multiple words', () => {
      const suggestions = parser.getSuggestions('love your neighbor');
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]).toContain('neighbour');
    });

    it('should return empty array for words without variants', () => {
      const suggestions = parser.getSuggestions('love');
      expect(suggestions).toEqual([]);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle query with only empty quotes', () => {
      const result = parser.parse('""');
      // Empty quotes are treated as boolean (contains quotes but not a single phrase)
      expect(result.searchType).toBe('boolean');
    });

    it('should handle mixed quotes and terms', () => {
      const result = parser.parse('"greatest of these" love charity');
      expect(result.searchType).toBe('boolean'); // Has both phrase and terms
    });

    it('should preserve original query', () => {
      const original = 'love peace ~50w';
      const result = parser.parse(original);
      expect(result.originalQuery).toBe(original);
    });

    it('should handle unicode characters', () => {
      const result = parser.parse('αγάπη'); // Greek word for love
      expect(result.searchType).toBe('multi-word');
      expect(result.terms).toEqual(['αγάπη']);
    });

    it('should handle numbers in search terms', () => {
      const result = parser.parse('144000 sealed');
      expect(result.terms).toContain('144000');
      expect(result.terms).toContain('sealed');
    });

    it('should handle hyphenated words', () => {
      const result = parser.parse('long-suffering');
      expect(result.terms).toContain('long-suffering');
    });

    it('should trim whitespace from query', () => {
      const result = parser.parse('  love peace joy  ');
      expect(result.originalQuery).toBe('love peace joy');
    });
  });

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('Integration - Complex Queries', () => {
    it('should parse complex multi-component query', () => {
      const result = parser.parse('"greatest of these" love charity ~20w');
      expect(result.searchType).toBe('proximity');
      expect(result.proximity?.terms).toContain('greatest of these');
      expect(result.proximity?.distance).toBe(20);
    });

    it('should handle proximity with boolean (complex)', () => {
      // This tests that proximity takes precedence over implicit boolean
      const result = parser.parse('faith hope love ~10w');
      expect(result.searchType).toBe('proximity');
    });

    it('should validate and parse in sequence', () => {
      const query = '"love peace" joy ~30w';
      const error = parser.validate(query);
      expect(error).toBeUndefined();

      const result = parser.parse(query);
      expect(result.searchType).toBe('proximity');
    });

    it('should handle empty phrase in mixed query', () => {
      const result = parser.parse('"" love peace');
      // Should still work, treating empty phrase as part of boolean
      expect(result.searchType).toBe('boolean');
    });
  });
});
