import { Page, Locator } from '@playwright/test';
import { logger } from '../utils/logger';
import { retryAction } from '../utils/retryHelper';
import { TEST_CONFIG, TIMEOUTS } from '../config/testConfig';

/**
 * Click options for safeClick method
 */
export interface SafeClickOptions {
  timeout?: number;
  force?: boolean;
  waitAfter?: number;
  scrollIntoView?: boolean;
}

/**
 * Fill options for safeFill method
 */
export interface SafeFillOptions {
  timeout?: number;
  clearFirst?: boolean;
  scrollIntoView?: boolean;
}

/**
 * Wait options for waitForElement method
 */
export interface WaitOptions {
  timeout?: number;
  state?: 'attached' | 'detached' | 'visible' | 'hidden';
}

/**
 * Base Page Object class
 * Provides common functionality for all page objects:
 * - Safe interactions with error handling
 * - Consistent logging
 * - Retry logic
 * - Timeout management
 */
export abstract class BasePage {
  protected readonly componentName: string;

  constructor(
    protected readonly page: Page,
    componentName?: string
  ) {
    this.componentName = componentName || this.constructor.name;
  }

  /**
   * Get default timeout from config
   */
  protected get defaultTimeout(): number {
    return TEST_CONFIG.timeouts.element;
  }

  /**
   * Log a message with the component prefix
   */
  protected log(message: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info'): void {
    const prefixed = `[${this.componentName}] ${message}`;
    switch (level) {
      case 'warn':
        logger.warn(prefixed);
        break;
      case 'error':
        logger.error(prefixed);
        break;
      case 'debug':
        if (typeof logger.debug === 'function') {
          logger.debug(prefixed);
        } else {
          logger.info(`[debug] ${prefixed}`);
        }
        break;
      default:
        logger.info(prefixed);
    }
  }

  /**
   * Log a step in the test execution
   */
  protected logStep(stepName: string): void {
    logger.step(`[${this.componentName}] ${stepName}`);
  }

  /**
   * Log success
   */
  protected logSuccess(message: string): void {
    logger.success(`[${this.componentName}] ${message}`);
  }

  /**
   * Safely click an element with error handling and retry
   * @returns true if click succeeded, false otherwise
   */
  protected async safeClick(locator: Locator, options: SafeClickOptions = {}): Promise<boolean> {
    const { timeout = this.defaultTimeout, force = false, waitAfter = 0, scrollIntoView = true } = options;

    try {
      if (scrollIntoView) {
        // Optional pre-step — a failure here is not fatal; the click below is
        // the invariant. Log at debug so the trail exists without breaking the
        // caller's contract (safeClick can still return true on click success).
        await locator.scrollIntoViewIfNeeded().catch((error) => {
          this.log(
            `scrollIntoViewIfNeeded skipped: ${error instanceof Error ? error.message : String(error)}`,
            'debug'
          );
        });
      }

      await locator.click({ timeout, force });

      if (waitAfter > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitAfter));
      }

      return true;
    } catch (error) {
      this.log(`Click failed: ${(error as Error).message}`, 'warn');
      return false;
    }
  }

  /**
   * Safely click with label fallback
   * Useful for radio buttons where the input is intercepted by its label
   */
  protected async safeClickWithLabelFallback(locator: Locator, options: SafeClickOptions = {}): Promise<boolean> {
    const { timeout = this.defaultTimeout, force = false } = options;

    // First try: direct click — propagate caller-supplied `force` to honor SafeClickOptions contract
    try {
      await locator.click({ timeout: Math.min(timeout, 3000), force });
      return true;
    } catch {
      // Click intercepted, try label
    }

    // Second try: click the associated label
    try {
      const inputId = await locator.getAttribute('id').catch(() => null);
      if (inputId) {
        const label = this.page.locator(`label[for="${inputId}"]`).first();
        if (await label.isVisible({ timeout: TIMEOUTS.short })) {
          await label.click({ force: true });
          return true;
        }
      }
    } catch {
      // Label click failed
    }

    // Last resort: force click
    try {
      await locator.click({ force: true, timeout });
      return true;
    } catch (error) {
      this.log(`Click with label fallback failed: ${(error as Error).message}`, 'warn');
      return false;
    }
  }

  /**
   * Safely fill an input field with error handling
   * @returns true if fill succeeded, false otherwise
   */
  protected async safeFill(locator: Locator, value: string, options: SafeFillOptions = {}): Promise<boolean> {
    const { timeout = this.defaultTimeout, clearFirst = true, scrollIntoView = true } = options;

    try {
      // Wait for element to be visible first
      await locator.waitFor({ state: 'visible', timeout });

      if (scrollIntoView) {
        // Optional — the fill itself is the invariant.
        await locator.scrollIntoViewIfNeeded().catch((error) => {
          this.log(
            `scrollIntoViewIfNeeded skipped: ${error instanceof Error ? error.message : String(error)}`,
            'debug'
          );
        });
      }

      if (clearFirst) {
        // Some inputs cannot be cleared (readonly wrappers) but still accept
        // fill(). Log at debug and keep going — the value verification below
        // catches a real mismatch.
        await locator.clear().catch((error) => {
          this.log(
            `clear() skipped: ${error instanceof Error ? error.message : String(error)}`,
            'debug'
          );
        });
      }

      await locator.fill(value, { timeout });

      // Verify the value was actually set
      const actualValue = await locator.inputValue().catch(() => '');
      if (actualValue !== value) {
        this.log(`Fill verification failed: expected "${value}", got "${actualValue}"`, 'warn');
        return false;
      }

      return true;
    } catch (error) {
      this.log(`Fill failed: ${(error as Error).message}`, 'warn');
      return false;
    }
  }

  /**
   * Wait for an element to be in a specific state
   * @returns The locator if found, null otherwise
   */
  protected async waitForElement(selector: string, options: WaitOptions = {}): Promise<Locator | null> {
    const { timeout = this.defaultTimeout, state = 'visible' } = options;

    try {
      const locator = this.page.locator(selector).first();
      await locator.waitFor({ state, timeout });
      return locator;
    } catch {
      return null;
    }
  }

  /**
   * Check if an element is visible.
   * Errors are logged at debug level to reduce noise while still providing traceability.
   */
  protected async isVisible(locator: Locator, timeout: number = 2000): Promise<boolean> {
    try {
      return await locator.isVisible({ timeout });
    } catch (err) {
      // Do not swallow completely — log for debugging (helps root cause analysis on guest/payment flows)
      this.log(`isVisible check failed (timeout=${timeout}ms): ${(err as Error)?.message || err}`, 'debug');
      return false;
    }
  }

  /**
   * Wait for page to stabilize after an action (DOM loaded).
   * Prefer using specific selector waits when possible.
   *
   * A timeout here is not fatal — the caller decides what to do next (typically
   * moves on to a targeted waitFor / expect). We log at debug so a slow load
   * still leaves a trace without breaking the flow.
   */
  protected async waitForNetworkIdle(timeout: number = TIMEOUTS.medium): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded', { timeout }).catch((error) => {
      this.log(
        `waitForLoadState('domcontentloaded') timed out: ${error instanceof Error ? error.message : String(error)}`,
        'debug'
      );
    });
  }

  /**
   * Wait for DOM content to be loaded (see `waitForNetworkIdle` for the
   * catch-and-log rationale).
   */
  protected async waitForDomContent(timeout: number = 10000): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded', { timeout }).catch((error) => {
      this.log(
        `waitForLoadState('domcontentloaded') timed out: ${error instanceof Error ? error.message : String(error)}`,
        'debug'
      );
    });
  }

  /**
   * Select an option from a dropdown
   * @returns true if selection succeeded, false otherwise
   */
  protected async safeSelect(locator: Locator, value: string, options: { timeout?: number } = {}): Promise<boolean> {
    const { timeout = this.defaultTimeout } = options;

    try {
      await locator.selectOption(value, { timeout });
      return true;
    } catch (error) {
      this.log(`Select failed: ${(error as Error).message}`, 'warn');
      return false;
    }
  }

  /**
   * Check a checkbox if not already checked
   */
  protected async safeCheck(locator: Locator, options: { timeout?: number; force?: boolean } = {}): Promise<boolean> {
    const { timeout = this.defaultTimeout, force = false } = options;

    try {
      const isChecked = await locator.isChecked().catch(() => false);
      if (!isChecked) {
        await locator.check({ timeout, force });
      }
      return true;
    } catch (error) {
      this.log(`Check failed: ${(error as Error).message}`, 'warn');
      return false;
    }
  }

  /**
   * Get text content from an element
   */
  protected async getTextContent(locator: Locator, options: { timeout?: number } = {}): Promise<string | null> {
    const { timeout = this.defaultTimeout } = options;

    try {
      await locator.waitFor({ state: 'visible', timeout });
      return await locator.textContent();
    } catch {
      return null;
    }
  }

  /**
   * Execute an action with retry logic
   * Delegates to retryAction() from retryHelper for a single implementation.
   */
  protected async withRetry<T>(
    action: () => Promise<T>,
    options: {
      maxAttempts?: number;
      delay?: number;
      backoff?: boolean;
      onRetry?: (attempt: number, error: Error) => void;
    } = {}
  ): Promise<T> {
    return retryAction(action, {
      maxAttempts: options.maxAttempts ?? 3,
      delay: options.delay ?? 500,
      exponentialBackoff: options.backoff ?? true,
      onRetry: options.onRetry ? (error, attempt) => options.onRetry!(attempt, error) : undefined,
    });
  }
}
