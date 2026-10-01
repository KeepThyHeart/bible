import { render, screen } from '@testing-library/react';
import { Bdi, ContentDir, DirectionProvider, resolveContentDir, useDirection, useIsRtl, useUiLocale } from './Direction';

function Probe() {
  const dir = useDirection();
  const rtl = useIsRtl();
  const locale = useUiLocale();
  return <span data-testid="probe">{`${dir}|${String(rtl)}|${locale ?? '-'}`}</span>;
}

describe('DirectionProvider / useDirection', () => {
  afterEach(() => document.documentElement.removeAttribute('dir'));

  it('reads the provider value', () => {
    render(
      <DirectionProvider value={{ ui: 'rtl', locale: 'he-IL' }}>
        <Probe />
      </DirectionProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('rtl|true|he-IL');
  });

  it('falls back to <html dir> without a provider', () => {
    document.documentElement.setAttribute('dir', 'rtl');
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('rtl|true|-');
  });

  it('defaults to ltr', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('ltr|false|-');
  });
});

describe('Bdi', () => {
  it('renders an isolating <bdi> and only emits a forced dir', () => {
    const { container, rerender } = render(<Bdi>KJV</Bdi>);
    const el = container.querySelector('bdi')!;
    expect(el.textContent).toBe('KJV');
    expect(el.hasAttribute('dir')).toBe(false);
    rerender(<Bdi dir="ltr" className="x">KJV</Bdi>);
    expect(container.querySelector('bdi')!.getAttribute('dir')).toBe('ltr');
    expect(container.querySelector('bdi')!.className).toBe('kth-bdi x');
  });
});

describe('ContentDir', () => {
  it('sets dir, lang and data-content-dir from the module language', () => {
    const { container } = render(<ContentDir lang="ar">نص</ContentDir>);
    const el = container.firstElementChild!;
    expect(el.getAttribute('dir')).toBe('rtl');
    expect(el.getAttribute('lang')).toBe('ar');
    expect(el.getAttribute('data-content-dir')).toBe('rtl');
    expect(el.className).toBe('kth-content');
  });

  it('honours an explicit override and the element type', () => {
    const { container } = render(
      <ContentDir lang="he" override="ltr" as="section">
        x
      </ContentDir>,
    );
    const el = container.firstElementChild!;
    expect(el.tagName).toBe('SECTION');
    expect(el.getAttribute('dir')).toBe('ltr');
  });

  it('resolveContentDir: auto follows the language', () => {
    expect(resolveContentDir('fa', 'auto')).toBe('rtl');
    expect(resolveContentDir('en')).toBe('ltr');
    expect(resolveContentDir(undefined, 'rtl')).toBe('rtl');
  });
});
