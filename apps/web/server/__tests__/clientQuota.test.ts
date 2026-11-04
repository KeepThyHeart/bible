import { describe, it, expect } from 'vitest';
import { clientKeyFor } from '../utils/clientQuota';

describe('clientKeyFor', () => {
  it('keeps IPv4 addresses as they are', () => {
    expect(clientKeyFor('203.0.113.7')).toBe('203.0.113.7');
  });

  it('unwraps IPv4-mapped IPv6', () => {
    expect(clientKeyFor('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientKeyFor('::FFFF:203.0.113.7')).toBe('203.0.113.7');
  });

  it('groups IPv6 addresses by /64', () => {
    const a = clientKeyFor('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    expect(a).toBe('2001:db8:1:2::/64');
    expect(clientKeyFor('2001:db8:1:2::1')).toBe(a);
    expect(clientKeyFor('2001:0DB8:0001:0002:ffff::')).toBe(a);
    expect(clientKeyFor('2001:db8:1:3::1')).not.toBe(a);
  });

  it('expands compressed prefixes', () => {
    expect(clientKeyFor('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientKeyFor('::1')).toBe('0:0:0:0::/64');
    expect(clientKeyFor('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('passes through anything that is not an address', () => {
    expect(clientKeyFor('unknown')).toBe('unknown');
  });
});
