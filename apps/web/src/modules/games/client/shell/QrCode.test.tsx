// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QrCode } from './QrCode.js';

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
});

function draw(url: string): void {
  act(() => {
    render(<QrCode url={url} label="QR code to join" />, host);
  });
}

describe('a QR code pointed at a loopback address', () => {
  it('warns that a phone cannot reach localhost', () => {
    draw('http://localhost:5173/play?room=QK7P');
    expect(host.textContent).toContain('only works on this computer');
  });

  it('warns for 127.0.0.1 too', () => {
    draw('http://127.0.0.1:5173/play?room=QK7P');
    expect(host.textContent).toContain('only works on this computer');
  });

  it('says nothing for a real address', () => {
    draw('https://games.example.org/play?room=QK7P');
    expect(host.textContent).not.toContain('only works on this computer');
  });

  it('says nothing for a LAN address, which a phone on the same wifi can reach', () => {
    draw('http://192.168.1.42:5173/play?room=QK7P');
    expect(host.textContent).not.toContain('only works on this computer');
  });
});
