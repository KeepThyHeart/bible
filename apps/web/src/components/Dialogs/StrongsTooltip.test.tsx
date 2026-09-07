/**
 * Component tests for StrongsTooltip.
 *
 * Pattern: Pure presentational component with complex prop-driven rendering.
 * No store integration — tests verify conditional rendering, CSS classes,
 * and the parseDefinition logic via rendered output.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { StrongsTooltip } from './StrongsTooltip';
import type { StrongsEntryData } from '../../types';

function makeEntry(overrides: Partial<StrongsEntryData> = {}): StrongsEntryData {
  return {
    strongsNumber: 'G25',
    word: 'ἀγαπάω',
    transliteration: 'agapaō',
    definition: 'to love (in a social or moral sense):--beloved, love.',
    partOfSpeech: 'verb',
    ...overrides,
  };
}

describe('StrongsTooltip', () => {
  it('renders nothing when entry is null', () => {
    const { container } = render(<StrongsTooltip entry={null} position={{ top: 100, left: 100 }} />);
    expect(container.querySelector('.strongs-tooltip')).toBeNull();
  });

  it('renders nothing when position is null', () => {
    const { container } = render(<StrongsTooltip entry={makeEntry()} position={null} />);
    expect(container.querySelector('.strongs-tooltip')).toBeNull();
  });

  it('renders the tooltip when entry and position are provided', () => {
    const { container } = render(
      <StrongsTooltip entry={makeEntry()} position={{ top: 100, left: 200 }} />,
    );

    expect(container.querySelector('.strongs-tooltip')).toBeTruthy();
  });

  it('renders the Strong\'s number', () => {
    render(<StrongsTooltip entry={makeEntry()} position={{ top: 100, left: 100 }} />);
    expect(screen.getByText('G25')).toBeTruthy();
  });

  it('renders the Greek/Hebrew word', () => {
    render(<StrongsTooltip entry={makeEntry()} position={{ top: 100, left: 100 }} />);
    expect(screen.getByText('ἀγαπάω')).toBeTruthy();
  });

  it('renders the transliteration when provided', () => {
    render(<StrongsTooltip entry={makeEntry()} position={{ top: 100, left: 100 }} />);
    expect(screen.getByText('agapaō')).toBeTruthy();
  });

  it('applies position styles', () => {
    const { container } = render(
      <StrongsTooltip entry={makeEntry()} position={{ top: 150, left: 250 }} />,
    );

    const tooltip = container.querySelector('.strongs-tooltip') as HTMLElement;
    expect(tooltip.style.top).toBe('150px');
    expect(tooltip.style.left).toBe('250px');
  });

  it('renders part of speech when provided', () => {
    render(
      <StrongsTooltip entry={makeEntry({ partOfSpeech: 'verb' })} position={{ top: 100, left: 100 }} />,
    );

    const { container } = render(
      <StrongsTooltip entry={makeEntry({ partOfSpeech: 'verb' })} position={{ top: 100, left: 100 }} />,
    );
    expect(container.querySelector('.strongs-tooltip__pos')).toBeTruthy();
  });

  it('does not render part of speech element when absent and not extractable', () => {
    // A definition with no detectable part of speech
    const entry = makeEntry({
      partOfSpeech: '',
      definition: ':--love',  // minimal definition with just the gloss separator
    });
    const { container } = render(
      <StrongsTooltip entry={entry} position={{ top: 100, left: 100 }} />,
    );
    expect(container.querySelector('.strongs-tooltip__pos')).toBeNull();
  });

  it('renders glosses when definition contains :-- separator', () => {
    const entry = makeEntry({
      definition: 'to love in a moral sense:--beloved, love.',
      partOfSpeech: '',
    });
    const { container } = render(
      <StrongsTooltip entry={entry} position={{ top: 100, left: 100 }} />,
    );

    expect(container.querySelector('.strongs-tooltip__glosses')).toBeTruthy();
  });

  it('does not render glosses element when definition has no :-- separator', () => {
    const entry = makeEntry({
      definition: 'to love in a moral sense',
      partOfSpeech: '',
    });
    const { container } = render(
      <StrongsTooltip entry={entry} position={{ top: 100, left: 100 }} />,
    );

    expect(container.querySelector('.strongs-tooltip__glosses')).toBeNull();
  });

  it('renders the definition description', () => {
    const entry = makeEntry({
      definition: 'to love deeply:--love, beloved',
      partOfSpeech: 'verb',
    });
    const { container } = render(
      <StrongsTooltip entry={entry} position={{ top: 100, left: 100 }} />,
    );

    expect(container.querySelector('.strongs-tooltip__def')).toBeTruthy();
  });

  it('truncates long descriptions to 200 chars with ellipsis', () => {
    const longDesc = 'a '.repeat(120); // 240 chars
    const entry = makeEntry({
      definition: `${longDesc}:--love`,
      partOfSpeech: 'verb',
    });
    const { container } = render(
      <StrongsTooltip entry={entry} position={{ top: 100, left: 100 }} />,
    );

    const defEl = container.querySelector('.strongs-tooltip__def');
    expect(defEl?.textContent?.endsWith('…')).toBe(true);
    expect((defEl?.textContent?.length ?? 0)).toBeLessThanOrEqual(210);
  });

  // The gloss list used to render whole. It is a few words for most entries and
  // 564 characters for G1722 (the preposition ev), which made the tooltip taller
  // than the verse the reader was hovering over.
  it('truncates a long gloss list at a word boundary', () => {
    const longGloss = 'about, after, against, almost, altogether, among, as, at, '
      + 'before, between, by, for, in, mightily, of, on, openly, outwardly, one, quickly';
    const entry = makeEntry({ definition: `a primary preposition:--${longGloss}` });
    const { container } = render(
      <StrongsTooltip entry={entry} position={{ top: 100, left: 100 }} />,
    );

    const glossEl = container.querySelector('.strongs-tooltip__glosses');
    const text = glossEl?.textContent ?? '';
    expect(text).toContain('about, after, against');
    expect(text).toContain('…');
    expect(text).not.toContain('quickly');
    expect(text.length).toBeLessThan(longGloss.length);
  });

  it('renders the header section', () => {
    const { container } = render(
      <StrongsTooltip entry={makeEntry()} position={{ top: 100, left: 100 }} />,
    );

    expect(container.querySelector('.strongs-tooltip__header')).toBeTruthy();
    expect(container.querySelector('.strongs-tooltip__number')).toBeTruthy();
    expect(container.querySelector('.strongs-tooltip__word')).toBeTruthy();
    expect(container.querySelector('.strongs-tooltip__translit')).toBeTruthy();
  });

  it('extracts transliteration from definition when not provided separately', () => {
    const entry = makeEntry({
      transliteration: '',
      definition: '1722 ἐν ejn en {en} \na primary preposition:--about, after',
    });
    const { container } = render(
      <StrongsTooltip entry={entry} position={{ top: 100, left: 100 }} />,
    );

    // Should extract transliteration from definition
    expect(container.querySelector('.strongs-tooltip__translit')).toBeTruthy();
  });

  it('does not render pronunciation when it matches transliteration', () => {
    // When pronunciation equals transliteration, no separate pron element shown
    const entry = makeEntry({
      transliteration: '',
      definition: '25 ἀγαπάω agapaō agapaō {agapaō} \nto love:--love',
    });
    const { container } = render(
      <StrongsTooltip entry={entry} position={{ top: 100, left: 100 }} />,
    );

    expect(container.querySelector('.strongs-tooltip__pron')).toBeNull();
  });
});
