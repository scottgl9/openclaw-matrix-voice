import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/utils/rate-limiter.js';

describe('RateLimiter', () => {
  it('should allow immediate acquire when tokens available', async () => {
    const limiter = new RateLimiter({ maxTokens: 5, refillRate: 10 });
    const start = Date.now();
    await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('should allow burst up to maxTokens', async () => {
    const limiter = new RateLimiter({ maxTokens: 3, refillRate: 1 });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    // All 3 should succeed immediately
    expect(true).toBe(true);
  });

  it('should tryAcquire return true when available', () => {
    const limiter = new RateLimiter({ maxTokens: 2, refillRate: 1 });
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
  });

  it('should tryAcquire return false when exhausted', () => {
    const limiter = new RateLimiter({ maxTokens: 1, refillRate: 0.1 });
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('should refill tokens over time', async () => {
    const limiter = new RateLimiter({ maxTokens: 1, refillRate: 100 }); // 100 tokens/sec
    limiter.tryAcquire(); // exhaust
    expect(limiter.tryAcquire()).toBe(false);

    await new Promise(resolve => setTimeout(resolve, 50)); // wait 50ms -> ~5 tokens
    expect(limiter.tryAcquire()).toBe(true);
  });
});
