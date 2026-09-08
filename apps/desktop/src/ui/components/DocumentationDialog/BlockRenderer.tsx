import React from 'react';
import { sanitizeHtml } from '../../utils/sanitize';
import { DocBlock } from './types';

/** Render a single documentation content block. */
export function renderBlock(block: DocBlock, index: number): React.ReactNode {
  switch (block.type) {
    case 'paragraph':
      return (
        <p
          key={index}
          className="text-sm leading-relaxed text-text-primary mb-3"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.text) }}
        />
      );

    case 'heading':
      return (
        <h3 key={index} className="text-base font-semibold text-text-heading mt-5 mb-2">
          {block.text}
        </h3>
      );

    case 'subheading':
      return (
        <h4 key={index} className="text-sm font-semibold text-text-heading mt-4 mb-1">
          {block.text}
        </h4>
      );

    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag
          key={index}
          className={`text-sm leading-relaxed text-text-primary mb-3 ps-5 space-y-1.5 ${
            block.ordered ? 'list-decimal' : 'list-disc'
          }`}
        >
          {block.items.map((item, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: sanitizeHtml(item) }} />
          ))}
        </Tag>
      );
    }

    case 'shortcut-table':
      return (
        <div key={index} className="mb-4 overflow-hidden rounded border border-border">
          <table className="w-full text-sm">
            <tbody>
              {block.rows.map(([shortcut, description], i) => (
                <tr
                  key={i}
                  className={i % 2 === 0 ? 'bg-background-warm' : 'bg-surface'}
                >
                  <td className="px-3 py-1.5 font-mono text-xs text-accent whitespace-nowrap w-40">
                    {shortcut}
                  </td>
                  <td className="px-3 py-1.5 text-text-primary">{description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'tip':
      return (
        <div
          key={index}
          className="flex items-start gap-2 p-3 mb-3 rounded bg-accent-light border border-accent-soft text-sm text-accent-strong"
        >
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
          <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.text) }} />
        </div>
      );

    case 'note':
      return (
        <div
          key={index}
          className="flex items-start gap-2 p-3 mb-3 rounded bg-warning-soft border border-warning-border text-sm text-warning-text"
        >
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.text) }} />
        </div>
      );

    case 'divider':
      return <hr key={index} className="my-4 border-border" />;

    default:
      return null;
  }
}
