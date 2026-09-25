import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GeneralSection, selectableLocales } from './GeneralSection';
import type { LocaleMetadata } from '../../services/II18nService';

/**
 * Two properties of the language picker, both of them about *not* changing
 * language by accident:
 *
 * 1. The section is collapsed until asked for. It is the first thing in the
 *    first tab of Preferences, and an uncollapsed row would let one stray
 *    click switch the entire UI - including into a language the user may not
 *    read well enough to switch back from.
 * 2. A shipped catalog is offered only once its own `locale.status` is
 *    `beta` or `complete` - `draft` ones are withheld. A catalog the user
 *    dropped into `<userData>/locales/` is theirs and must keep working
 *    untouched, whatever its status.
 */

const BUILT_IN: LocaleMetadata[] = [
  { code: 'en', name: 'English', nativeName: 'English', status: 'complete', direction: 'ltr' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', status: 'draft', direction: 'ltr' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', status: 'draft', direction: 'rtl' },
  { code: 'xx-pseudo', name: 'Pseudo', nativeName: 'Pseudo', status: 'draft', direction: 'ltr' },
];

const USER_SUPPLIED: LocaleMetadata[] = [
  { code: 'fr', name: 'French', nativeName: 'Français', status: 'draft', direction: 'ltr' },
];

const h = vi.hoisted(() => ({
  locales: [] as LocaleMetadata[],
  locale: 'en',
  setLocale: vi.fn(async () => {}),
}));

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({
    // A `t` that echoes its key is a miss as far as `tf()` is concerned, so
    // the assertions below read the real English source copy.
    t: (key: string) => key,
    get locale() {
      return h.locale;
    },
    i18n: {
      get currentLocale() {
        return h.locale;
      },
      get availableLocaleInfos(): LocaleMetadata[] {
        return h.locales;
      },
      setLocale: h.setLocale,
    },
  }),
}));

beforeEach(() => {
  h.locales = [...BUILT_IN, ...USER_SUPPLIED];
  h.locale = 'en';
  h.setLocale.mockClear();
});

describe('selectableLocales', () => {
  it('drops shipped catalogs whose status is draft', () => {
    expect(selectableLocales(BUILT_IN).map((i) => i.code)).toEqual(['en']);
  });

  it('offers a shipped catalog once its status is promoted to beta', () => {
    const withBeta = BUILT_IN.map((info) =>
      info.code === 'es' ? { ...info, status: 'beta' as const } : info,
    );
    expect(selectableLocales(withBeta).map((i) => i.code)).toEqual(['en', 'es']);
  });

  it('never hides a locale the user dropped in themselves', () => {
    const codes = selectableLocales([...BUILT_IN, ...USER_SUPPLIED]).map((i) => i.code);
    expect(codes).toContain('fr');
  });

  it('keeps the active locale listed even after it stops being offered', () => {
    // Otherwise a user already running Spanish would see a radio group with
    // nothing checked and no way to see what they are on.
    expect(selectableLocales(BUILT_IN, 'es').map((i) => i.code)).toContain('es');
  });
});

describe('GeneralSection language picker', () => {
  it('starts collapsed, naming the active language rather than hiding it', () => {
    render(<GeneralSection />);

    const toggle = screen.getByTestId('language-disclosure');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('language-current')).toHaveTextContent('English');
    expect(screen.queryByTestId('language-picker')).not.toBeInTheDocument();
  });

  it('reveals the picker only when the disclosure is opened', async () => {
    render(<GeneralSection />);

    await userEvent.click(screen.getByTestId('language-disclosure'));

    expect(screen.getByTestId('language-disclosure')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('language-picker')).toBeInTheDocument();
  });

  it('offers English and the user-supplied locale, but no shipped draft', async () => {
    render(<GeneralSection />);
    await userEvent.click(screen.getByTestId('language-disclosure'));

    expect(screen.getByTestId('locale-option-en')).toBeInTheDocument();
    expect(screen.getByTestId('locale-option-fr')).toBeInTheDocument();
    for (const code of ['es', 'ar', 'xx-pseudo']) {
      expect(screen.queryByTestId(`locale-option-${code}`)).not.toBeInTheDocument();
    }
  });

  it('still badges a draft locale that is on offer', async () => {
    render(<GeneralSection />);
    await userEvent.click(screen.getByTestId('language-disclosure'));

    // The user's own catalog is unreviewed too - the badge is not English-only
    // logic and must not disappear along with the shipped drafts.
    expect(screen.getByTestId('locale-draft-badge-fr')).toBeInTheDocument();
    expect(screen.queryByTestId('locale-draft-badge-en')).not.toBeInTheDocument();
  });

  it('offers a promoted built-in locale with a beta badge, not a draft one', async () => {
    h.locales = BUILT_IN.map((info) =>
      info.code === 'es' ? { ...info, status: 'beta' as const } : info,
    );
    render(<GeneralSection />);
    await userEvent.click(screen.getByTestId('language-disclosure'));

    expect(screen.getByTestId('locale-option-es')).toBeInTheDocument();
    expect(screen.getByTestId('locale-beta-badge-es')).toBeInTheDocument();
    expect(screen.queryByTestId('locale-draft-badge-es')).not.toBeInTheDocument();
  });

  it('switches locale when a row is chosen', async () => {
    render(<GeneralSection />);
    await userEvent.click(screen.getByTestId('language-disclosure'));
    await userEvent.click(screen.getByTestId('locale-option-fr'));

    expect(h.setLocale).toHaveBeenCalledWith('fr');
  });

  it('names a locale that is no longer offered when the user is already on it', () => {
    h.locale = 'es';
    render(<GeneralSection />);

    expect(screen.getByTestId('language-current')).toHaveTextContent('Español');
  });
});
