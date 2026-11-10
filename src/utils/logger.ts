/**
 * Log level type - ordered by severity (lowest to highest)
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** Numeric priority for each log level (higher = more severe) */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

/** Check if a level should be logged given the minimum level */
function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel];
}

const SENSITIVE_SUBSTRINGS = [
  'authorization',
  'apikey',
  'api_key',
  'api-key',
  'privatekey',
  'private_key',
  'private-key',
  'secretkey',
  'secret_key',
  'secret-key',
  'accesskey',
  'access_key',
  'access-key',
  'signingkey',
  'signing_key',
  'signing-key',
  'token',
  'secret',
  'password',
];

function isSensitiveFieldName(key: string): boolean {
  const lowerKey = key.toLowerCase();
  if (lowerKey === 'key') return true;
  return SENSITIVE_SUBSTRINGS.some((k) => lowerKey.includes(k));
}

/** Redact sensitive fields from log context */
function redactContext(context: unknown): unknown {
  if (!context || typeof context !== 'object') return context;

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context as Record<string, unknown>)) {
    if (isSensitiveFieldName(key)) {
      result[key] = '[REDACTED]';
    } else if (Array.isArray(value)) {
      // Preserve arrays by mapping each element through redactContext
      result[key] = value.map((item) => redactContext(item));
    } else if (value && typeof value === 'object') {
      result[key] = redactContext(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Logger interface for custom logger implementations.
 * Allows injection of application loggers (pino, winston, console, etc.)
 */
export interface Logger {
  debug(message: string, context?: unknown): void;
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
}

/** JSON log output format */
export interface JsonLogEntry {
  timestamp: string;
  level: string;
  scope: string;
  message: string;
  context?: unknown;
}

/**
 * Configuration options for SDKLogger
 */
export interface SDKLoggerOptions {
  /** Minimum log level to output (default: 'error') */
  minLevel?: LogLevel;
  /** Prefix for log lines (default: 'TrustFlow') */
  prefix?: string;
  /** Enable JSON structured output (default: false) */
  json?: boolean;
  /** Custom logger instance to delegate to */
  logger?: Logger;
}

/**
 * SDK Logger with configurable levels, JSON output, and custom logger support.
 *
 * @example
 * ```ts
 * // Basic usage with level control
 * const logger = new SDKLogger({ minLevel: 'debug', prefix: 'MyApp' });
 * logger.debug('Debug info', { foo: 'bar' });
 *
 * // JSON output for log aggregation
 * const jsonLogger = new SDKLogger({ minLevel: 'info', json: true });
 *
 * // Inject custom logger (pino, winston, etc.)
 * const customLogger = new SDKLogger({ logger: pinoLogger });
 * ```
 */
export class SDKLogger implements Logger {
  private minLevel: LogLevel;
  private prefix: string;
  private json: boolean;
  private customLogger?: Logger;

  constructor(options: SDKLoggerOptions = {}) {
    this.minLevel = options.minLevel ?? 'error';
    this.prefix = options.prefix ?? 'TrustFlow';
    this.json = options.json ?? false;
    this.customLogger = options.logger;
  }

  /** Update the minimum log level at runtime */
  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /** Get current minimum log level */
  getMinLevel(): LogLevel {
    return this.minLevel;
  }

  private log(level: Exclude<LogLevel, 'silent'>, message: string, context?: unknown): void {
    if (!shouldLog(level, this.minLevel)) return;

    const timestamp = new Date().toISOString();
    const redactedContext = context !== undefined ? redactContext(context) : undefined;

    if (this.customLogger) {
      // Delegate to custom logger (level is never 'silent' here)
      this.customLogger[level](message, redactedContext);
      return;
    }

    if (this.json) {
      const entry: JsonLogEntry = {
        timestamp,
        level: level.toUpperCase(),
        scope: this.prefix,
        message,
        ...(redactedContext !== undefined && { context: redactedContext }),
      };
      console[level === 'debug' ? 'log' : level](JSON.stringify(entry));
    } else {
      const line = `[${timestamp}] [${this.prefix}] [${level.toUpperCase()}] ${message}`;
      if (redactedContext !== undefined) {
        console[level](line, redactedContext);
      } else {
        console[level](line);
      }
    }
  }

  debug(message: string, context?: unknown): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: unknown): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: unknown): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: unknown): void {
    this.log('error', message, context);
  }
}

/** Default logger instance - logs errors only by default */
export const logger = new SDKLogger();

/**
 * Reduces a thrown value to its name, message and code for logging. Transport
 * errors (Axios, as used by the Soroban RPC client) carry the whole request,
 * headers included, so logging them as-is would print RPC header values such
 * as API keys (#344).
 */
export function describeError(error: unknown): {
  name?: string;
  message: string;
  code?: unknown;
} {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return { name: error.name, message: error.message, code };
  }
  return { message: String(error) };
}

/** Create a child logger with a different prefix */
export function createLogger(
  prefix: string,
  options: Omit<SDKLoggerOptions, 'prefix'> = {},
): SDKLogger {
  return new SDKLogger({ ...options, prefix });
}
