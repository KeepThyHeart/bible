import { describe, it, expect, afterEach } from 'vitest';
import { inertBackground } from './inertBackground';

afterEach(() => { document.body.innerHTML = ''; });

describe('inertBackground', () => {
  it('inerts siblings up to body and restores only what it marked', () => {
    document.body.innerHTML = `
      <div id="app"><main id="page"></main><aside id="rail" inert></aside></div>
      <div id="overlay"><div id="dialog"></div></div>`;
    const release = inertBackground(document.getElementById('dialog')!);
    expect(document.getElementById('app')).toHaveAttribute('inert');
    expect(document.getElementById('overlay')).not.toHaveAttribute('inert');
    release();
    expect(document.getElementById('app')).not.toHaveAttribute('inert');
  });

  it('keeps live regions reachable but still inerts the rest of the branch that holds them', () => {
    document.body.innerHTML = `
      <div id="app">
        <div id="chrome"><span id="live" aria-live="polite"></span><button id="btn">x</button></div>
        <main id="page"></main>
      </div>
      <div id="overlay"><div id="dialog"></div></div>`;
    const release = inertBackground(document.getElementById('dialog')!);
    expect(document.getElementById('app')).not.toHaveAttribute('inert');
    expect(document.getElementById('live')).not.toHaveAttribute('inert');
    expect(document.getElementById('btn')).toHaveAttribute('inert');
    expect(document.getElementById('page')).toHaveAttribute('inert');
    release();
    expect(document.getElementById('btn')).not.toHaveAttribute('inert');
    expect(document.getElementById('page')).not.toHaveAttribute('inert');
  });
});
