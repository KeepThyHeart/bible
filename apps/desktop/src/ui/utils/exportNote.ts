/**
 * Export utilities for .bn notes
 * Converts TipTap HTML/JSON content to various formats
 */

/**
 * Convert TipTap editor HTML to Markdown
 * Uses a lightweight approach - no heavy library dependency
 */
export function htmlToMarkdown(html: string): string {
  // Create a temporary DOM element to parse HTML
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return nodeToMarkdown(doc.body).trim();
}

function nodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map(nodeToMarkdown).join('');

  switch (tag) {
    case 'h1': return `# ${children}\n\n`;
    case 'h2': return `## ${children}\n\n`;
    case 'h3': return `### ${children}\n\n`;
    case 'h4': return `#### ${children}\n\n`;
    case 'h5': return `##### ${children}\n\n`;
    case 'h6': return `###### ${children}\n\n`;
    case 'p': return `${children}\n\n`;
    case 'br': return '\n';
    case 'strong':
    case 'b': return `**${children}**`;
    case 'em':
    case 'i': return `*${children}*`;
    case 's':
    case 'del': return `~~${children}~~`;
    case 'sub': return `~${children}~`;
    case 'sup': return `^${children}^`;
    case 'code': return `\`${children}\``;
    case 'pre': return `\`\`\`\n${el.textContent ?? ''}\n\`\`\`\n\n`;
    case 'blockquote': return children.split('\n').filter(l => l.trim()).map(l => `> ${l}`).join('\n') + '\n\n';
    case 'hr': return '---\n\n';
    case 'a': {
      const href = el.getAttribute('href') ?? '';
      return `[${children}](${href})`;
    }
    case 'ul': return convertList(el, false);
    case 'ol': return convertList(el, true);
    case 'li': return children;
    case 'table': return convertTable(el);
    case 'img': {
      const src = el.getAttribute('src') ?? '';
      const alt = el.getAttribute('alt') ?? '';
      return `![${alt}](${src})`;
    }
    case 'body':
    case 'div':
    case 'span':
    case 'thead':
    case 'tbody':
    case 'tfoot':
      return children;
    default:
      return children;
  }
}

function convertList(el: HTMLElement, ordered: boolean): string {
  const items = Array.from(el.children);
  const lines = items.map((li, i) => {
    const prefix = ordered ? `${i + 1}. ` : '- ';
    const content = nodeToMarkdown(li).trim();
    return `${prefix}${content}`;
  });
  return lines.join('\n') + '\n\n';
}

function convertTable(el: HTMLElement): string {
  const rows = Array.from(el.querySelectorAll('tr'));
  if (rows.length === 0) return '';

  const result: string[][] = [];
  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll('th, td'));
    result.push(cells.map(c => (c.textContent ?? '').trim()));
  }

  if (result.length === 0) return '';

  const colCount = Math.max(...result.map(r => r.length));
  const colWidths = Array(colCount).fill(3);
  for (const row of result) {
    for (let i = 0; i < row.length; i++) {
      colWidths[i] = Math.max(colWidths[i], row[i].length);
    }
  }

  const formatRow = (row: string[]) =>
    '| ' + colWidths.map((w, i) => (row[i] ?? '').padEnd(w)).join(' | ') + ' |';

  const separator = '| ' + colWidths.map(w => '-'.repeat(w)).join(' | ') + ' |';

  const lines = [formatRow(result[0]), separator];
  for (let i = 1; i < result.length; i++) {
    lines.push(formatRow(result[i]));
  }

  return lines.join('\n') + '\n\n';
}

/**
 * Trigger a file download in the browser (for renderer process)
 */
export function downloadAsFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
