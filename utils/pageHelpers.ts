import { Page, Locator, Response } from '@playwright/test';
import { retryAction } from './retryHelper';
import { TIMEOUTS } from '../config/testConfig';
import { logger } from './logger';

/**
 * Standalone page helper utilities for common Playwright operations.
 * These are intended for use in classes that do NOT extend BasePage.
 * Classes extending BasePage should use the equivalent protected methods
 * (safeClick, safeFill, etc.) inherited from BasePage instead.
 */

export interface SafeClickOptions {
  maxRetries?: number;
  force?: boolean;
  checkOverlay?: boolean;
  scrollIntoView?: boolean;
  waitBeforeClick?: number;
}

/**
 * Safely click on an element with automatic retry and overlay detection
 * @param locator - Playwright Locator to click
 * @param page - Playwright Page object
 * @param options - Click configuration
 */
export async function safeClick(locator: Locator, page: Page, options: SafeClickOptions = {}): Promise<void> {
  const {
    maxRetries = 3,
    force = false,
    checkOverlay = true,
    scrollIntoView = true,
    waitBeforeClick = TIMEOUTS.animation / 2,  // reduced for speed
  } = options;

  await retryAction(
    async () => {
      // 1. Wait for element to be visible
      await locator.waitFor({ state: 'visible', timeout: TIMEOUTS.medium });

      // 2. Scroll element into view if needed
      if (scrollIntoView) {
        await locator.scrollIntoViewIfNeeded();
      }

      // 3. Wait for animations/transitions to complete
      if (waitBeforeClick > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitBeforeClick));
      }

      // 4. Check for overlays if not using force
      if (!force && checkOverlay) {
        const isClickable = await isElementClickable(locator);
        if (!isClickable) {
          throw new Error('Element is obscured by an overlay');
        }
      }

      // 5. Perform the click
      await locator.click({ force, timeout: TIMEOUTS.short });
    },
    {
      maxAttempts: maxRetries,
      delay: TIMEOUTS.animation * 2,
      onRetry: (err, attempt) => {
        logger.warn(`Safe click failed (attempt ${attempt}/${maxRetries}): ${err.message}`);
      },
    }
  );
}

/**
 * Check if an element is actually clickable (not obscured by overlay)
 * @param locator - Playwright Locator to check
 * @returns true if clickable, false otherwise
 */
export async function isElementClickable(locator: Locator): Promise<boolean> {
  try {
    const box = await locator.boundingBox();
    if (!box) return false;

    const elementHandle = await locator.elementHandle();
    if (!elementHandle) return false;

    try {
      const page = locator.page();
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;

      return await page.evaluate(
        ({ x, y, target }) => {
          const element = document.elementFromPoint(x, y);
          if (!element || !target) return false;
          return element === target || target.contains(element);
        },
        { x: centerX, y: centerY, target: elementHandle }
      );
    } finally {
      await elementHandle.dispose();
    }
  } catch {
    return false;
  }
}

/**
 * Wait for page to be fully loaded and stable
 * @param page - Playwright Page object
 * @param selector - Optional selector to wait for
 * @param timeout - Maximum wait time in milliseconds
 */
export async function waitForPageReady(
  page: Page,
  selector?: string,
  timeout = TIMEOUTS.navigation / 2
): Promise<void> {
  const promises: Promise<unknown>[] = [page.waitForLoadState('domcontentloaded')];

  if (selector) {
    promises.push(page.waitForSelector(selector, { state: 'visible', timeout }));
  }

  await Promise.all(promises);
}

/**
 * Wait for a network response matching a condition
 * @param page - Playwright Page object
 * @param urlPattern - URL pattern to match (string or regex)
 * @param options - Wait options
 * @returns Response object or null if timeout
 */
export async function waitForApiResponse(
  page: Page,
  urlPattern: string | RegExp,
  options: {
    timeout?: number;
    status?: number;
    method?: string;
  } = {}
): Promise<Response | null> {
  const { timeout = TIMEOUTS.element, status = 200, method } = options;

  try {
    const response = await page.waitForResponse(
      (resp) => {
        const urlMatches =
          typeof urlPattern === 'string' ? resp.url().includes(urlPattern) : urlPattern.test(resp.url());

        const statusMatches = resp.status() === status;
        const methodMatches = !method || resp.request().method() === method;

        return urlMatches && statusMatches && methodMatches;
      },
      { timeout }
    );

    return response;
  } catch (_error) {
    logger.warn(`API response timeout for pattern: ${urlPattern}`);
    return null;
  }
}

/**
 * Fill form field with validation
 * @param locator - Input field locator
 * @param value - Value to fill
 * @param options - Fill options
 */
export async function safeFill(
  locator: Locator,
  value: string,
  options: {
    validate?: boolean;
    clearFirst?: boolean;
    pressTab?: boolean;
  } = {}
): Promise<void> {
  const { validate = true, clearFirst = true, pressTab = false } = options;

  // Wait for field to be ready
  await locator.waitFor({ state: 'visible', timeout: TIMEOUTS.medium });
  await locator.scrollIntoViewIfNeeded();

  // Clear existing value if needed
  if (clearFirst) {
    await locator.clear();
  }

  // Fill the value
  await locator.fill(value);

  // Press Tab to trigger onChange events
  if (pressTab) {
    await locator.press('Tab');
  }

  // Validate the value was set correctly
  if (validate) {
    const filledValue = await locator.inputValue();
    if (filledValue !== value) {
      throw new Error(`Failed to fill field correctly. Expected: "${value}", Got: "${filledValue}"`);
    }
  }
}

/**
 * Close common overlays and popups
 * @param page - Playwright Page object
 */
export async function closeOverlays(page: Page): Promise<void> {
  const overlaySelectors = [
    'button[aria-label="Close"]',
    'button.close',
    '.modal-close',
    '[data-testid="close-button"]',
    'button:has-text("×")',
    'button:has-text("Close")',
    'button:has-text("Fermer")',
  ];

  for (const selector of overlaySelectors) {
    try {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: TIMEOUTS.animation * 2 })) {
        await button.click();
        await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.animation / 2));
      }
    } catch {
      // Overlay not found, continue
    }
  }
}

/**
 * Scroll to element with offset
 * @param locator - Element to scroll to
 * @param offset - Pixel offset from top (useful for fixed headers)
 */
export async function scrollToElement(locator: Locator, offset = 0): Promise<void> {
  await locator.evaluate((element, scrollOffset) => {
    const rect = element.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const targetY = rect.top + scrollTop - scrollOffset;

    window.scrollTo({
      top: targetY,
      behavior: 'smooth',
    });
  }, offset);

  // Wait for scroll to complete
  await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.animation));
}

/**
 * Wait for element count to stabilize (useful for dynamic lists)
 * @param locator - Locator for elements to count
 * @param options - Stabilization options
 * @returns Final count
 */
export async function waitForStableCount(
  locator: Locator,
  options: {
    timeout?: number;
    stabilityThreshold?: number;
  } = {}
): Promise<number> {
  const { timeout = TIMEOUTS.element, stabilityThreshold = TIMEOUTS.animation * 2 } = options;
  const startTime = Date.now();
  let lastCount = 0;
  let lastChangeTime = startTime;

  while (Date.now() - startTime < timeout) {
    const currentCount = await locator.count();

    if (currentCount !== lastCount) {
      lastCount = currentCount;
      lastChangeTime = Date.now();
    }

    // If count hasn't changed for stabilityThreshold ms, consider it stable
    if (Date.now() - lastChangeTime >= stabilityThreshold) {
      return lastCount;
    }

    await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.animation / 5));
  }

  return lastCount;
}
