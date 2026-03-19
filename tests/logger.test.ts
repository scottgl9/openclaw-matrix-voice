import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from '../src/utils/logger.js';

describe('Logger', () => {
  let stdoutSpy: any;
  let stderrSpy: any;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create a logger with a component name', () => {
    const log = createLogger('TestComponent');
    expect(log).toBeDefined();
  });

  it('should log info messages', () => {
    const log = createLogger('Test');
    log.info('hello');
    expect(stdoutSpy).toHaveBeenCalledWith('[Test]', 'hello');
  });

  it('should log error messages', () => {
    const log = createLogger('Test');
    log.error('oops');
    expect(stderrSpy).toHaveBeenCalledWith('[Test]', 'oops');
  });

  it('should include data in log messages', () => {
    const log = createLogger('Test');
    log.info('with data', { key: 'value' });
    expect(stdoutSpy).toHaveBeenCalledWith('[Test]', expect.stringContaining('"key":"value"'));
  });
});
