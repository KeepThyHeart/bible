/**
 * Preprocess plain-text book content into HTML with proper paragraph breaks,
 * title/subtitle separation, and epigraph styling.
 *
 * SWORD-imported book modules store content as plain text with:
 *   - Multiple tabs (\t{2,}) as paragraph separators
 *   - The section title duplicated at the start of content
 *   - Subtitles/epigraphs immediately after the title, before the first tab separator
 *   - Multi-space runs for line-wrapping within paragraphs (collapse naturally in HTML)
 */
export function preprocessBookContent(content: string | null | undefined, title: string): string {
  if (!content) return '';

  // If content already has HTML block-level tags, return as-is
  if (/<(?:p|div|br|h[1-6]|blockquote|ul|ol|li)\b/i.test(content)) {
    return content;
  }

  let processed = content;

  // Strip leading title if content starts with it (title is already rendered as <h2>)
  const trimmed = processed.trimStart();
  if (trimmed.startsWith(title)) {
    processed = trimmed.substring(title.length);
  }

  // Split on runs of 2+ tabs (the paragraph separator used by SWORD imports)
  const rawParagraphs = processed.split(/\t{2,}/);
  const paragraphs = rawParagraphs
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 0);

  if (paragraphs.length === 0) return '';

  const result: string[] = [];
  let bodyStartIndex = 0;

  // First paragraph after title strip may be a subtitle or epigraph
  const first = paragraphs[0];
  const isEpigraph = /^[\u201c"']/.test(first) && /--\s/.test(first);
  const isSubtitle = first.length < 80 && !/^[\u201c"']/.test(first);

  if (isSubtitle) {
    result.push(`<h3 class="text-lg italic text-text-secondary mt-0 mb-md">${first}</h3>`);
    bodyStartIndex = 1;
  } else if (isEpigraph) {
    result.push(`<blockquote class="border-s-4 border-border ps-md my-md italic"><p>${first}</p></blockquote>`);
    bodyStartIndex = 1;
  }

  // Check if there's a multi-paragraph epigraph (quoted paragraphs ending with -- Attribution)
  if (bodyStartIndex === 1 && isSubtitle) {
    // After a subtitle, look for consecutive quoted paragraphs forming an epigraph block
    const epiParagraphs: string[] = [];
    let i = bodyStartIndex;
    while (i < paragraphs.length && /^[\u201c"']/.test(paragraphs[i])) {
      epiParagraphs.push(paragraphs[i]);
      // If this paragraph has the attribution (-- Reference), it's the last epigraph paragraph
      if (/--\s/.test(paragraphs[i])) {
        i++;
        break;
      }
      i++;
    }
    if (epiParagraphs.length > 0 && /--\s/.test(epiParagraphs[epiParagraphs.length - 1])) {
      const epiHtml = epiParagraphs.map(p => `<p>${p}</p>`).join('\n');
      result.push(`<blockquote class="border-s-4 border-border ps-md my-md italic">${epiHtml}</blockquote>`);
      bodyStartIndex = i;
    }
  } else if (bodyStartIndex === 0 && !isEpigraph && !isSubtitle) {
    // No subtitle or epigraph detected - check if first paragraph(s) form an epigraph block
    const epiParagraphs: string[] = [];
    let i = 0;
    while (i < paragraphs.length && /^[\u201c"']/.test(paragraphs[i])) {
      epiParagraphs.push(paragraphs[i]);
      if (/--\s/.test(paragraphs[i])) {
        i++;
        break;
      }
      i++;
    }
    if (epiParagraphs.length > 0 && /--\s/.test(epiParagraphs[epiParagraphs.length - 1])) {
      const epiHtml = epiParagraphs.map(p => `<p>${p}</p>`).join('\n');
      result.push(`<blockquote class="border-s-4 border-border ps-md my-md italic">${epiHtml}</blockquote>`);
      bodyStartIndex = i;
    }
  }

  // Remaining paragraphs are body text
  for (let i = bodyStartIndex; i < paragraphs.length; i++) {
    result.push(`<p>${paragraphs[i]}</p>`);
  }

  return result.join('\n');
}
