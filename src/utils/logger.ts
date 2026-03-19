/**
 * Structured logger with levels and JSON output.
 *
 * Uses LOG_LEVEL env var (debug, info, warn, error). Defaults to 'info'.
 * In production (NODE_ENV=production), outputs JSON lines.
 * In development, outputs human-readable colored text.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'debug',
  [LogLevel.INFO]: 'info',
  [LogLevel.WARN]: 'warn',
  [LogLevel.ERROR]: 'error',
};

function parseLevel(s: string | undefined): LogLevel {
  switch (s?.toLowerCase()) {
    case 'debug': return LogLevel.DEBUG;
    case 'info': return LogLevel.INFO;
    case 'warn': return LogLevel.WARN;
    case 'error': return LogLevel.ERROR;
    default: return LogLevel.INFO;
  }
}

const isProduction = process.env.NODE_ENV === 'production';
const minLevel = parseLevel(process.env.LOG_LEVEL);

class Logger {
  private component: string;

  constructor(component: string) {
    this.component = component;
  }

  debug(msg: string, data?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, msg, data);
  }

  info(msg: string, data?: Record<string, any>): void {
    this.log(LogLevel.INFO, msg, data);
  }

  warn(msg: string, data?: Record<string, any>): void {
    this.log(LogLevel.WARN, msg, data);
  }

  error(msg: string, data?: Record<string, any>): void {
    this.log(LogLevel.ERROR, msg, data);
  }

  private log(level: LogLevel, msg: string, data?: Record<string, any>): void {
    if (level < minLevel) return;

    const levelName = LEVEL_NAMES[level];

    if (isProduction) {
      const entry: Record<string, any> = {
        ts: new Date().toISOString(),
        level: levelName,
        component: this.component,
        msg,
      };
      if (data) {
        Object.assign(entry, data);
      }
      const out = level >= LogLevel.ERROR ? process.stderr : process.stdout;
      out.write(JSON.stringify(entry) + '\n');
    } else {
      const prefix = `[${this.component}]`;
      const extra = data ? ' ' + JSON.stringify(data) : '';
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(prefix, msg + extra);
          break;
        case LogLevel.INFO:
          console.log(prefix, msg + extra);
          break;
        case LogLevel.WARN:
          console.warn(prefix, msg + extra);
          break;
        case LogLevel.ERROR:
          console.error(prefix, msg + extra);
          break;
      }
    }
  }
}

/**
 * Create a logger scoped to a component name.
 */
export function createLogger(component: string): Logger {
  return new Logger(component);
}
