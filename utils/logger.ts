/**
 * Structured Test Logger
 * Provides consistent logging format across all test files
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogContext {
  [key: string]: unknown;
}

/**
 * TestLogger provides structured logging for test execution
 * Usage:
 *   import { logger } from '../utils/logger';
 *   logger.info('Message');
 *   logger.step('Filling form');
 *   logger.success('Form submitted');
 */
export class TestLogger {
  private static readonly EMOJIS = {
    info: 'ℹ️ ',
    warn: '⚠️ ',
    error: '❌',
    debug: '🔍',
    step: '📝',
    success: '✅',
    start: '🚀',
    end: '🏁',
  };

  private static isCI = !!process.env.CI;
  private static debugEnabled = process.env.DEBUG === 'true';

  /**
   * Format message with timestamp and level
   */
  private static format(level: LogLevel, emoji: string, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    return `[${timestamp}] ${emoji} ${message}${contextStr}`;
  }

  /**
   * Log info message
   */
  static info(message: string, context?: LogContext): void {
    if (this.isCI) return; // Suppress info in CI
    console.log(this.format('info', this.EMOJIS.info, message, context));
  }

  /**
   * Log warning message
   */
  static warn(message: string, context?: LogContext): void {
    console.warn(this.format('warn', this.EMOJIS.warn, message, context));
  }

  /**
   * Log error message
   * Includes stack trace when an Error is provided — critical for post-mortem debugging
   * in CI where the only signal is the captured log output.
   */
  static error(message: string, error?: Error): void {
    const errorContext = error ? { error: error.message, stack: error.stack } : undefined;
    console.error(this.format('error', this.EMOJIS.error, message, errorContext));
  }

  /**
   * Log debug message (only when DEBUG=true)
   */
  static debug(message: string, context?: LogContext): void {
    if (!this.debugEnabled) return;
    console.log(this.format('debug', this.EMOJIS.debug, message, context));
  }

  /**
   * Log a step in the test execution
   */
  static step(stepName: string): void {
    console.log(`   ${this.EMOJIS.step} ${stepName}...`);
  }

  /**
   * Log success message
   */
  static success(message: string): void {
    console.log(`   ${this.EMOJIS.success} ${message}`);
  }

  /**
   * Log test start
   */
  static testStart(testName: string, context?: LogContext): void {
    console.log(`\n${this.EMOJIS.start} Starting: ${testName}`);
    if (context) {
      Object.entries(context).forEach(([key, value]) => {
        console.log(`   ${key}: ${value}`);
      });
    }
  }

  /**
   * Log test end
   */
  static testEnd(testName: string, status: 'passed' | 'failed', duration?: number): void {
    const emoji = status === 'passed' ? this.EMOJIS.success : this.EMOJIS.error;
    const durationStr = duration ? ` (${Math.round(duration / 1000)}s)` : '';
    console.log(`${this.EMOJIS.end} ${emoji} ${testName} ${status.toUpperCase()}${durationStr}\n`);
  }

  /**
   * Create a scoped logger for a specific component
   */
  static scoped(component: string): ScopedLogger {
    return new ScopedLogger(component);
  }
}

/**
 * Scoped logger for component-specific logging
 */
class ScopedLogger {
  constructor(private component: string) {}

  private prefix(message: string): string {
    return `[${this.component}] ${message}`;
  }

  info(message: string, context?: LogContext): void {
    TestLogger.info(this.prefix(message), context);
  }

  warn(message: string, context?: LogContext): void {
    TestLogger.warn(this.prefix(message), context);
  }

  error(message: string, error?: Error): void {
    TestLogger.error(this.prefix(message), error);
  }

  debug(message: string, context?: LogContext): void {
    TestLogger.debug(this.prefix(message), context);
  }

  step(stepName: string): void {
    TestLogger.step(this.prefix(stepName));
  }

  success(message: string): void {
    TestLogger.success(this.prefix(message));
  }
}

/**
 * Default logger instance
 */
export const logger = TestLogger;

/**
 * Mask email for logs only (keeps first 2 chars of local part and TLD)
 * Real email values are still passed to APIs.
 */
export function maskEmailForLog(value: string): string {
  const [localPart, domainPart] = value.split('@');
  if (!localPart || !domainPart) return '***';
  const visibleLocal = localPart.slice(0, 2);
  const extension = domainPart.includes('.') ? domainPart.slice(domainPart.lastIndexOf('.')) : '';
  return `${visibleLocal}***@***${extension}`;
}
