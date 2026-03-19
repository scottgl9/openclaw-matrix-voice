/**
 * Retry utility with exponential backoff for external service calls.
 */

export interface RetryOptions {
  /** Maximum number of attempts (including initial) */
  maxAttempts: number;
  /** Initial delay in ms between retries */
  initialDelayMs: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Maximum delay in ms */
  maxDelayMs: number;
  /** Per-attempt timeout in ms (0 = no timeout) */
  timeoutMs: number;
  /** Label for logging */
  label?: string;
}

export const defaultRetryOptions: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 500,
  backoffMultiplier: 2,
  maxDelayMs: 5000,
  timeoutMs: 30000,
};

/**
 * Execute a function with retry and exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>
): Promise<T> {
  const opts = { ...defaultRetryOptions, ...options };
  let lastError: Error | null = null;
  let delay = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const result = opts.timeoutMs > 0
        ? await withTimeout(fn(), opts.timeoutMs)
        : await fn();
      return result;
    } catch (error: any) {
      lastError = error;
      const label = opts.label || 'operation';

      if (attempt < opts.maxAttempts) {
        console.warn(`[Retry] ${label} attempt ${attempt}/${opts.maxAttempts} failed: ${error.message}. Retrying in ${delay}ms...`);
        await sleep(delay);
        delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
      } else {
        console.error(`[Retry] ${label} failed after ${opts.maxAttempts} attempts: ${error.message}`);
      }
    }
  }

  throw lastError!;
}

/**
 * Wrap a promise with a timeout.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
