import { describe, expect, it } from 'vitest';
import { CodeOpenLimiter } from './CodeOpenLimiter.js';

function limiterAt(limit: number, windowMs: number): { limiter: CodeOpenLimiter; advance(ms: number): void } {
  let clock = 0;
  return {
    limiter: new CodeOpenLimiter({ limit, windowMs, now: () => clock }),
    advance: (ms) => {
      clock += ms;
    },
  };
}

describe('the code-open limiter', () => {
  it('allows up to the limit and then reports the seconds left in the window', () => {
    const { limiter, advance } = limiterAt(2, 10_000);
    expect(limiter.take('198.51.100.1')).toBeNull();
    expect(limiter.take('198.51.100.1')).toBeNull();
    advance(4_000);
    expect(limiter.take('198.51.100.1')).toBe(6);
  });

  it('counts each client separately', () => {
    const { limiter } = limiterAt(1, 10_000);
    expect(limiter.take('198.51.100.1')).toBeNull();
    expect(limiter.take('198.51.100.2')).toBeNull();
    expect(limiter.take('198.51.100.1')).not.toBeNull();
  });

  it('opens a fresh window once the old one has passed', () => {
    const { limiter, advance } = limiterAt(1, 10_000);
    limiter.take('198.51.100.1');
    expect(limiter.take('198.51.100.1')).not.toBeNull();
    advance(10_000);
    expect(limiter.take('198.51.100.1')).toBeNull();
  });

  it('counts every address in one IPv6 /64 as one client', () => {
    const { limiter } = limiterAt(1, 10_000);
    expect(limiter.take('2001:db8:1:2::1')).toBeNull();
    expect(limiter.take('2001:db8:1:2:ffff::9')).not.toBeNull();
    expect(limiter.take('2001:db8:1:3::1')).toBeNull();
  });
});
