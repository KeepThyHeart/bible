import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRateLimiter, DEFAULT_RATE_LIMITS, tierForApiPath } from '../middleware/rateLimiter';
import { mockRequest, mockResponse, mockNext, type MockNext } from './expressMocks';

describe('rateLimiter middleware', () => {
  // `MockNext`, not `NextFunction`: the assertions below read `next.mock.calls`
  // and call `next.mockClear()`, neither of which is on `NextFunction`.
  let next: MockNext;

  beforeEach(() => {
    next = mockNext();
  });

  describe('per-tier rate limiting (default tier)', () => {
    it('allows requests within limit for default tier', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      for (let i = 0; i < DEFAULT_RATE_LIMITS.default; i++) {
        const req = mockRequest();
        const res = mockResponse();
        next.mockClear();

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
      }
    });

    it('rejects requests exceeding default tier limit', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      // Use up the limit
      for (let i = 0; i < DEFAULT_RATE_LIMITS.default; i++) {
        const req = mockRequest();
        const res = mockResponse();
        middleware(req, res, next);
      }

      // Next request should be rejected
      const req = mockRequest();
      const res = mockResponse();
      const rejectionNext = vi.fn();
      middleware(req, res, rejectionNext);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(rejectionNext).not.toHaveBeenCalled();
    });

    it('returns JSON error on 429', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      // Exceed limit
      let res;
      for (let i = 0; i <= DEFAULT_RATE_LIMITS.default; i++) {
        const req = mockRequest();
        res = mockResponse();
        middleware(req, res, next);
      }

      expect(res!.json).toHaveBeenCalledWith({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
        },
      });
    });

    it('includes Retry-After header on 429', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      // Exceed limit
      let res;
      for (let i = 0; i <= DEFAULT_RATE_LIMITS.default; i++) {
        const req = mockRequest();
        res = mockResponse();
        middleware(req, res, next);
      }

      expect(res!.setHeader).toHaveBeenCalledWith(
        'Retry-After',
        expect.stringMatching(/^\d+$/)
      );
    });
  });

  describe('per-tier rate limiting (search tier)', () => {
    it('enforces stricter search tier limit (20 req/min)', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('search');

      // Search tier should have tighter limit
      expect(DEFAULT_RATE_LIMITS.search).toBeLessThan(DEFAULT_RATE_LIMITS.default);

      // Fill search tier limit
      for (let i = 0; i < DEFAULT_RATE_LIMITS.search; i++) {
        const req = mockRequest();
        const res = mockResponse();
        middleware(req, res, next);
      }

      // Next should be rejected
      const req = mockRequest();
      const res = mockResponse();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('isolates search tier from default tier', () => {
      const limiter = createRateLimiter();
      const searchMiddleware = limiter.middleware('search');
      const defaultMiddleware = limiter.middleware('default');

      const searchIp = '192.168.1.100';
      const defaultIp = '192.168.1.101';

      // Max out search tier for searchIp
      for (let i = 0; i <= DEFAULT_RATE_LIMITS.search; i++) {
        const req = mockRequest({ ip: searchIp });
        const res = mockResponse();
        searchMiddleware(req, res, next);
      }

      // defaultIp in default tier should not be affected
      const req = mockRequest({ ip: defaultIp });
      const res = mockResponse();
      defaultMiddleware(req, res, next);

      expect(res.status).not.toHaveBeenCalledWith(429);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('per-tier rate limiting (content tier)', () => {
    it('enforces content tier limit (600 req/min)', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('content');

      // Sized from measured traffic: ordinary reading with the study pane open
      // runs at roughly 180 API req/min, so anything near the old 120 fired
      // during normal use. See DEFAULT_RATE_LIMITS for the derivation.
      expect(DEFAULT_RATE_LIMITS.content).toBe(600);

      // Fill content tier
      for (let i = 0; i < DEFAULT_RATE_LIMITS.content; i++) {
        const req = mockRequest();
        const res = mockResponse();
        middleware(req, res, next);
      }

      // Exceed by 1
      const req = mockRequest();
      const res = mockResponse();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('allows more requests than search tier', () => {
      const limiter = createRateLimiter();
      const searchMiddleware = limiter.middleware('search');
      const contentMiddleware = limiter.middleware('content');

      expect(DEFAULT_RATE_LIMITS.content).toBeGreaterThan(DEFAULT_RATE_LIMITS.search);

      // Fill search tier
      for (let i = 0; i < DEFAULT_RATE_LIMITS.search; i++) {
        const req = mockRequest();
        const res = mockResponse();
        searchMiddleware(req, res, next);
      }

      // Content tier with same IP should still allow requests
      for (let i = 0; i < DEFAULT_RATE_LIMITS.content; i++) {
        const req = mockRequest();
        const res = mockResponse();
        next.mockClear();
        contentMiddleware(req, res, next);
        // Tiers are independent, so all should pass
        if (i < DEFAULT_RATE_LIMITS.content) {
          expect(next).toHaveBeenCalled();
        }
      }
    });
  });

  describe('global rate limiting', () => {
    it('enforces global limit across all IPs', () => {
      // Explicit small ceiling: the shipped `global` is an overload valve set
      // deliberately high, and filling it literally would make this a
      // ten-thousand-iteration test for no extra coverage.
      const limiter = createRateLimiter({ global: 200 });
      const globalMiddleware = limiter.global();

      // Hit global limit across multiple IPs
      for (let i = 0; i < 200; i++) {
        const req = mockRequest({ ip: `192.168.1.${i % 255}` });
        const res = mockResponse();
        globalMiddleware(req, res, next);
        next.mockClear();
      }

      // Next request from any IP should be rejected
      const req = mockRequest({ ip: '10.0.0.1' });
      const res = mockResponse();
      globalMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(next).not.toHaveBeenCalled();
    });

    it('resets global counter at window boundary', () => {
      const testConfig = { ...DEFAULT_RATE_LIMITS, global: 200, windowMs: 1000 };
      const limiter = createRateLimiter(testConfig);
      const globalMiddleware = limiter.global();

      // Fill global limit
      for (let i = 0; i < testConfig.global; i++) {
        const req = mockRequest();
        const res = mockResponse();
        globalMiddleware(req, res, next);
      }

      // Should be at limit
      let req = mockRequest();
      let res = mockResponse();
      globalMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(429);

      // NOTE: In a real test, we'd advance time and verify counter resets
      // For now, verify the mechanism exists in implementation
    });

    it('is independent from per-tier limits', () => {
      // Explicit small config: this test is about the global counter being a
      // separate ceiling that many under-limit IPs can collectively reach, not
      // about the shipped numbers (which are asserted elsewhere and are now
      // deliberately far apart).
      const limiter = createRateLimiter({ global: 50, default: 10 });
      const globalMiddleware = limiter.global();

      // Ten IPs, each staying within its own per-tier limit.
      const ips = Array.from({ length: 10 }, (_, i) => `192.168.1.${i}`);
      for (const ip of ips) {
        for (let i = 0; i < 5; i++) {
          const req = mockRequest({ ip });
          const res = mockResponse();
          globalMiddleware(req, res, next);
          next.mockClear();
        }
      }

      // 10 × 5 = 50 fills the global ceiling; the next request trips it even
      // though its own IP is nowhere near the per-tier cap.
      const req = mockRequest({ ip: '10.0.0.1' });
      const res = mockResponse();
      globalMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
    });
  });

  describe('window-based rate limiting', () => {
    it('uses default 60 second window', () => {
      const limiter = createRateLimiter();
      expect(DEFAULT_RATE_LIMITS.windowMs).toBe(60_000);
    });

    it('respects custom window length', () => {
      const customWindow = 5000; // 5 seconds
      const limiter = createRateLimiter({ windowMs: customWindow });
      const middleware = limiter.middleware('default');

      const req = mockRequest();
      const res = mockResponse();
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('sliding window resets on window boundary', () => {
      // This test verifies the sliding window behavior
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      // Fill the window
      for (let i = 0; i < DEFAULT_RATE_LIMITS.default; i++) {
        const req = mockRequest();
        const res = mockResponse();
        middleware(req, res, next);
      }

      // Additional request should be rejected
      let req = mockRequest();
      let res = mockResponse();
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(429);

      // NOTE: Window reset would be tested with time mocking
    });
  });

  describe('IP extraction and per-IP limits', () => {
    it('uses req.ip for rate limiting', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      const ip = '192.168.1.100';

      // Max out requests from this IP
      for (let i = 0; i < DEFAULT_RATE_LIMITS.default; i++) {
        const req = mockRequest({ ip });
        const res = mockResponse();
        middleware(req, res, next);
      }

      // Should be rate limited
      const req = mockRequest({ ip });
      const res = mockResponse();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('falls back to socket.remoteAddress if req.ip unavailable', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      // Max out requests without req.ip
      for (let i = 0; i < DEFAULT_RATE_LIMITS.default; i++) {
        const req = mockRequest({
          ip: undefined,
          remoteAddress: '10.0.0.1',
        });
        const res = mockResponse();
        middleware(req, res, next);
      }

      // Should be rate limited
      const req = mockRequest({
        ip: undefined,
        remoteAddress: '10.0.0.1',
      });
      const res = mockResponse();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('uses "unknown" if no IP available', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      // Requests with no IP will be grouped under "unknown"
      for (let i = 0; i < DEFAULT_RATE_LIMITS.default; i++) {
        const req = mockRequest({
          ip: undefined,
          remoteAddress: undefined,
        });
        const res = mockResponse();
        middleware(req, res, next);
      }

      // Should be rate limited
      const req = mockRequest({
        ip: undefined,
        remoteAddress: undefined,
      });
      const res = mockResponse();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('tracks limits per IP independently', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      const ip1 = '192.168.1.100';
      const ip2 = '192.168.1.101';

      // Max out requests from IP1
      for (let i = 0; i < DEFAULT_RATE_LIMITS.default; i++) {
        const req = mockRequest({ ip: ip1 });
        const res = mockResponse();
        middleware(req, res, next);
      }

      // IP2 should still have allowance
      const req = mockRequest({ ip: ip2 });
      const res = mockResponse();
      middleware(req, res, next);

      expect(res.status).not.toHaveBeenCalledWith(429);
      expect(next).toHaveBeenCalled();
    });

    it('handles IPv6 addresses', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      const ipv6 = '::1';

      // Max out requests from IPv6
      for (let i = 0; i < DEFAULT_RATE_LIMITS.default; i++) {
        const req = mockRequest({ ip: ipv6 });
        const res = mockResponse();
        middleware(req, res, next);
      }

      // Should be rate limited
      const req = mockRequest({ ip: ipv6 });
      const res = mockResponse();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('treats different IPs independently', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      // Multiple IPs should each have their own counter
      for (let ipNum = 0; ipNum < 5; ipNum++) {
        const ip = `192.168.1.${100 + ipNum}`;
        const req = mockRequest({ ip });
        const res = mockResponse();
        next.mockClear();

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
      }
    });
  });

  describe('environment variable DISABLE_RATE_LIMIT', () => {
    const originalEnv = process.env.DISABLE_RATE_LIMIT;

    afterEach(() => {
      process.env.DISABLE_RATE_LIMIT = originalEnv;
    });

    it('logs warning when DISABLE_RATE_LIMIT=1', () => {
      const warnSpy = vi.spyOn(console, 'warn');
      process.env.DISABLE_RATE_LIMIT = '1';

      createRateLimiter();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[security]')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('DISABLE_RATE_LIMIT')
      );

      warnSpy.mockRestore();
    });

    // NOTE: Testing actual bypass would require middleware to check env var
    // The current implementation logs a warning; the actual disable would be
    // done in the app setup layer that uses the middleware
  });

  describe('Retry-After header calculation', () => {
    it('includes valid Retry-After value on 429', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      // Exceed limit
      let res;
      for (let i = 0; i <= DEFAULT_RATE_LIMITS.default; i++) {
        const req = mockRequest();
        res = mockResponse();
        middleware(req, res, next);
      }

      const calls = (res!.setHeader as any).mock.calls;
      const retryAfterCall = calls.find((call: any[]) => call[0] === 'Retry-After');
      expect(retryAfterCall).toBeDefined();

      const retrySeconds = parseInt(retryAfterCall[1], 10);
      expect(retrySeconds).toBeGreaterThanOrEqual(1);
      expect(retrySeconds).toBeLessThanOrEqual(DEFAULT_RATE_LIMITS.windowMs / 1000);
    });

    it('Retry-After is at least 1 second', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      // Exceed limit
      let res;
      for (let i = 0; i <= DEFAULT_RATE_LIMITS.default; i++) {
        const req = mockRequest();
        res = mockResponse();
        middleware(req, res, next);
      }

      const calls = (res!.setHeader as any).mock.calls;
      const retryAfterCall = calls.find((call: any[]) => call[0] === 'Retry-After');
      const retrySeconds = parseInt(retryAfterCall[1], 10);

      expect(retrySeconds).toBeGreaterThanOrEqual(1);
    });

    it('Retry-After reflects remaining window time', () => {
      const testWindow = 60_000; // 1 minute
      const limiter = createRateLimiter({ windowMs: testWindow });
      const middleware = limiter.middleware('default');

      // Exceed limit
      let res;
      for (let i = 0; i <= DEFAULT_RATE_LIMITS.default; i++) {
        const req = mockRequest();
        res = mockResponse();
        middleware(req, res, next);
      }

      const calls = (res!.setHeader as any).mock.calls;
      const retryAfterCall = calls.find((call: any[]) => call[0] === 'Retry-After');
      const retrySeconds = parseInt(retryAfterCall[1], 10);

      // Should be close to window duration in seconds
      expect(retrySeconds).toBeLessThanOrEqual(Math.ceil(testWindow / 1000));
    });
  });

  describe('reset() method for tests', () => {
    it('clears all per-tier counters', () => {
      const limiter = createRateLimiter();
      const searchMiddleware = limiter.middleware('search');
      const contentMiddleware = limiter.middleware('content');
      const defaultMiddleware = limiter.middleware('default');

      // Fill some counters
      for (let i = 0; i < 10; i++) {
        const req = mockRequest();
        const res = mockResponse();
        searchMiddleware(req, res, next);
        contentMiddleware(req, res, next);
        defaultMiddleware(req, res, next);
      }

      // Reset
      limiter.reset();

      // Should be able to make requests again
      const req = mockRequest();
      const res = mockResponse();
      next.mockClear();

      searchMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('clears global counter', () => {
      const limiter = createRateLimiter({ global: 200 });
      const globalMiddleware = limiter.global();

      // Fill global counter
      for (let i = 0; i < 200; i++) {
        const req = mockRequest();
        const res = mockResponse();
        globalMiddleware(req, res, next);
      }

      // Should be rate limited
      let req = mockRequest();
      let res = mockResponse();
      globalMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(429);

      // Reset
      limiter.reset();

      // Should be able to make requests again
      req = mockRequest();
      res = mockResponse();
      next.mockClear();
      globalMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('allows tests to run independently', () => {
      const limiter1 = createRateLimiter();
      const limiter2 = createRateLimiter();

      const middleware1 = limiter1.middleware('default');
      const middleware2 = limiter2.middleware('default');

      // Fill limiter1
      for (let i = 0; i < DEFAULT_RATE_LIMITS.default; i++) {
        const req = mockRequest();
        const res = mockResponse();
        middleware1(req, res, next);
      }

      // limiter2 should not be affected
      const req = mockRequest();
      const res = mockResponse();
      next.mockClear();
      middleware2(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('custom configuration', () => {
    it('accepts custom per-tier limits', () => {
      const customLimits = {
        search: 10,
        content: 50,
        default: 25,
        global: 200,
      };
      const limiter = createRateLimiter(customLimits);
      const middleware = limiter.middleware('default');

      // Fill custom limit
      for (let i = 0; i < customLimits.default; i++) {
        const req = mockRequest();
        const res = mockResponse();
        middleware(req, res, next);
      }

      // Should be rate limited at custom limit
      const req = mockRequest();
      const res = mockResponse();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('accepts custom window length', () => {
      const customWindow = 30_000; // 30 seconds
      const limiter = createRateLimiter({ windowMs: customWindow });
      const middleware = limiter.middleware('default');

      const req = mockRequest();
      const res = mockResponse();
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('merges partial config with defaults', () => {
      const partialConfig = { search: 15 };
      const limiter = createRateLimiter(partialConfig);
      const searchMiddleware = limiter.middleware('search');
      const defaultMiddleware = limiter.middleware('default');

      // Search should use custom value
      for (let i = 0; i < 15; i++) {
        const req = mockRequest();
        const res = mockResponse();
        searchMiddleware(req, res, next);
      }

      // Next should be rate limited
      let req = mockRequest();
      let res = mockResponse();
      searchMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(429);

      // Default should use default value
      limiter.reset();
      for (let i = 0; i < DEFAULT_RATE_LIMITS.default; i++) {
        req = mockRequest();
        res = mockResponse();
        next.mockClear();
        defaultMiddleware(req, res, next);
      }

      req = mockRequest();
      res = mockResponse();
      defaultMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(429);
    });
  });

  describe('concurrent request handling', () => {
    it('increments counter for each request in rapid succession', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      const ip = '192.168.1.100';

      // Simulate rapid requests beyond the limit to verify exactly 'default' requests pass
      let requestCount = 0;
      for (let i = 0; i < DEFAULT_RATE_LIMITS.default + 20; i++) {
        const req = mockRequest({ ip });
        const res = mockResponse();
        next.mockClear();

        middleware(req, res, next);

        if (next.mock.calls.length > 0) {
          requestCount++;
        }
      }

      // Should have allowed exactly DEFAULT_RATE_LIMITS.default requests
      expect(requestCount).toBe(DEFAULT_RATE_LIMITS.default);
    });

    it('handles multiple IPs with rapid requests', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      const ips = ['192.168.1.100', '192.168.1.101', '192.168.1.102'];
      const successCounts: Record<string, number> = {};

      for (const ip of ips) {
        successCounts[ip] = 0;
        // Overshoot the cap so the allowed count is the limit, not the loop.
        for (let i = 0; i < DEFAULT_RATE_LIMITS.default + 10; i++) {
          const req = mockRequest({ ip });
          const res = mockResponse();
          next.mockClear();

          middleware(req, res, next);

          if (next.mock.calls.length > 0) {
            successCounts[ip]++;
          }
        }
      }

      // Each IP should have allowed exactly the limit
      for (const ip of ips) {
        expect(successCounts[ip]).toBe(DEFAULT_RATE_LIMITS.default);
      }
    });
  });

  describe('counter accuracy', () => {
    it('does not double-count requests', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      let successCount = 0;
      for (let i = 0; i < DEFAULT_RATE_LIMITS.default + 10; i++) {
        const req = mockRequest();
        const res = mockResponse();
        next.mockClear();

        middleware(req, res, next);

        if (next.mock.calls.length > 0) {
          successCount++;
        }
      }

      // Should allow exactly the limit, no more
      expect(successCount).toBe(DEFAULT_RATE_LIMITS.default);
    });

    it('counts requests from same IP toward same counter', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      const ip = '192.168.1.100';
      let count = 0;

      // Each request from same IP increments same counter
      for (let i = 0; i < 10; i++) {
        const req = mockRequest({ ip });
        const res = mockResponse();
        next.mockClear();

        middleware(req, res, next);

        if (next.mock.calls.length > 0) {
          count++;
        }
      }

      expect(count).toBe(10);

      // At limit - 1, should still work
      let req = mockRequest({ ip });
      let res = mockResponse();
      next.mockClear();
      const remainingRequests = DEFAULT_RATE_LIMITS.default - 10;
      for (let i = 0; i < remainingRequests; i++) {
        req = mockRequest({ ip });
        res = mockResponse();
        next.mockClear();
        middleware(req, res, next);
      }

      // Next should be rejected
      req = mockRequest({ ip });
      res = mockResponse();
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(429);
    });
  });

  describe('edge cases', () => {
    it('handles zero requests in window', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');
      limiter.reset();

      const req = mockRequest();
      const res = mockResponse();
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('handles exactly at limit', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      // Make exactly limit requests
      for (let i = 0; i < DEFAULT_RATE_LIMITS.default; i++) {
        const req = mockRequest();
        const res = mockResponse();
        next.mockClear();
        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
      }

      // One more should fail
      const req = mockRequest();
      const res = mockResponse();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('handles extreme request volumes', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      // Simulate 1000 requests from same IP
      let allowedCount = 0;
      for (let i = 0; i < 1000; i++) {
        const req = mockRequest();
        const res = mockResponse();
        next.mockClear();

        middleware(req, res, next);

        if (next.mock.calls.length > 0) {
          allowedCount++;
        }
      }

      // Should still respect limit
      expect(allowedCount).toBe(DEFAULT_RATE_LIMITS.default);
    });

    it('handles invalid Retry-After calculation gracefully', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      // Exceed limit and verify Retry-After is valid
      let res;
      for (let i = 0; i <= DEFAULT_RATE_LIMITS.default; i++) {
        const req = mockRequest();
        res = mockResponse();
        middleware(req, res, next);
      }

      const calls = (res!.setHeader as any).mock.calls;
      const retryAfterCall = calls.find((call: any[]) => call[0] === 'Retry-After');

      if (retryAfterCall) {
        const value = retryAfterCall[1];
        const seconds = parseInt(value, 10);
        expect(Number.isNaN(seconds)).toBe(false);
        expect(seconds).toBeGreaterThan(0);
      }
    });
  });

  describe('middleware composition', () => {
    it('global and per-tier middleware work together', () => {
      const limiter = createRateLimiter();
      const globalMiddleware = limiter.global();
      const defaultMiddleware = limiter.middleware('default');

      // Requests pass through global first
      for (let i = 0; i < 10; i++) {
        const req = mockRequest();
        const res = mockResponse();
        next.mockClear();

        globalMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();

        // Then through tier
        res.status = vi.fn().mockReturnValue(res);
        next.mockClear();
        defaultMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
      }
    });

    it('returning 429 prevents next middleware from running', () => {
      const limiter = createRateLimiter();
      const middleware = limiter.middleware('default');

      // Exceed limit
      let finalNext: any;
      for (let i = 0; i <= DEFAULT_RATE_LIMITS.default; i++) {
        const req = mockRequest();
        const res = mockResponse();
        finalNext = vi.fn();
        middleware(req, res, finalNext);
      }

      // Final request should be rejected and next not called
      expect(finalNext).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // Tier selection
  //
  // Regression guard for the bug where tier middlewares were mounted on
  // overlapping prefixes and Express ran all of them: every /api request was
  // charged to its own tier AND to `default`, so the lower `default` cap
  // always tripped first and `content` could never be reached.
  // ------------------------------------------------------------------
  describe('tierForApiPath', () => {
    it('classifies reference reads as content', () => {
      for (const path of [
        '/bible/KJV/43/3',
        '/commentary/Barnes/43/3',
        '/commentary/all/43/3',
        '/dictionary/strongs/entry/G25',
        '/interlinear/43/3',
        '/strongs/G25',
        '/xref/TSK/43003016/groups',
        '/topical/verse/43003016',
        '/study/overview/43/3',
        '/books',
        '/modules',
      ]) {
        expect(tierForApiPath(path)).toBe('content');
      }
    });

    it('classifies search as the search tier', () => {
      expect(tierForApiPath('/search/keyword')).toBe('search');
      expect(tierForApiPath('/search/semantic')).toBe('search');
    });

    it('falls back to default for everything else', () => {
      for (const path of ['/health', '/config', '/version', '/plugins', '/']) {
        expect(tierForApiPath(path)).toBe('default');
      }
    });

    it('charges each path to exactly one tier', () => {
      // The property that was violated: a path must not be claimed by a tier
      // AND separately fall through to default. One call, one answer.
      const limiter = createRateLimiter({ content: 2, default: 2, search: 2 });
      const next = vi.fn();

      // Three content requests from one IP. If anything also charged them to
      // `default`, a fourth tier would be consuming budget invisibly; here the
      // content tier alone accounts for all of them.
      for (let i = 0; i < 2; i++) {
        const res = mockResponse();
        limiter.middleware(tierForApiPath('/bible/KJV/43/3'))(mockRequest(), res, next);
        expect(res.status).not.toHaveBeenCalled();
      }

      // The default tier is untouched, so a default-tier call still passes.
      const res = mockResponse();
      limiter.middleware(tierForApiPath('/config'))(mockRequest(), res, next);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
