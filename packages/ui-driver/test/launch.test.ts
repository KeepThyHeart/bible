import { describe, expect, it } from 'vitest';
import { isLoopback } from '../src/launch.ts';

describe('isLoopback (start --url to a shared local server)', () => {
  it('accepts this machine', () => {
    for (const u of ['http://127.0.0.1:4000', 'http://localhost:5173/#/KJV/1/1', 'http://[::1]:3000', 'http://app.localhost:80', 'https://127.1.2.3']) {
      expect(isLoopback(u), u).toBe(true);
    }
  });
  it('rejects everything else, including look-alikes', () => {
    for (const u of ['https://bible.keepthyheart.com', 'http://127.0.0.1.example.com', 'http://localhost.example.com', 'file:///tmp/x', 'not a url', 'http://10.0.0.1']) {
      expect(isLoopback(u), u).toBe(false);
    }
  });
});
