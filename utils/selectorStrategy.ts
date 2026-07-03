import { Page, Locator } from '@playwright/test';
import { logger } from './logger';
import { TIMEOUTS } from '../config/testConfig';

/**
 * SelectorStrategy provides a flexible way to find elements using multiple selector strategies.
 * This pattern improves maintainability by centralizing selector logic and reduces flakiness
 * by trying multiple selectors in priority order.
 */
export class SelectorStrategy {
  constructor(
    private selectors: string[],
    private description: string
  ) {
    if (selectors.length === 0) {
      throw new Error(`SelectorStrategy for "${description}" must have at least one selector`);
    }
  }

  /**
   * Find the first visible element matching any of the selectors
   * @param page - Playwright Page object
   * @param options - Optional timeout and visibility settings
   * @returns Locator if found, null otherwise
   */
  async findFirst(
    page: Page,
    options: {
      timeout?: number;
      state?: 'attached' | 'detached' | 'visible' | 'hidden';
    } = {}
  ): Promise<Locator | null> {
    const { timeout = TIMEOUTS.short, state = 'visible' } = options;

    // Fast path: try combined selector first (parallel search across all selectors)
    try {
      const combined = this.selectors.join(', ');
      const locator = page.locator(combined).first();
      await locator.waitFor({ state, timeout });
      return locator;
    } catch {
      // Combined selector failed, fall back to sequential search
    }

    // Slow path: try each selector individually with a short timeout
    const shortTimeout = Math.min(timeout, TIMEOUTS.sectionTransition);
    for (const selector of this.selectors) {
      try {
        const locator = page.locator(selector).first();
        await locator.waitFor({ state, timeout: shortTimeout });
        return locator;
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Find all elements matching any of the selectors
   * @param page - Playwright Page object
   * @param options - Optional timeout setting
   * @returns Array of Locators
   */
  async findAll(page: Page, options: { timeout?: number } = {}): Promise<Locator[]> {
    const { timeout = TIMEOUTS.short } = options;
    const foundLocators: Locator[] = [];

    for (const selector of this.selectors) {
      try {
        const locators = await page.locator(selector).all();

        // Filter visible elements
        for (const locator of locators) {
          if (await locator.isVisible({ timeout })) {
            foundLocators.push(locator);
          }
        }
      } catch {
        continue;
      }
    }

    return foundLocators;
  }

  /**
   * Click on the first found element
   * @param page - Playwright Page object
   * @param options - Click and wait options
   */
  async clickFirst(
    page: Page,
    options: {
      timeout?: number;
      force?: boolean;
      waitAfter?: number;
    } = {}
  ): Promise<boolean> {
    const { timeout = TIMEOUTS.medium, force = false, waitAfter = TIMEOUTS.sectionTransition } = options;

    const locator = await this.findFirst(page, { timeout });

    if (!locator) {
      logger.warn(`Cannot click ${this.description}: element not found`);
      return false;
    }

    try {
      await locator.click({ force, timeout });
      if (waitAfter > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitAfter));
      }
      logger.success(`Clicked on ${this.description}`);
      return true;
    } catch (error) {
      logger.error(`Failed to click ${this.description}`, error as Error);
      return false;
    }
  }

  /**
   * Get text content from the first found element
   * @param page - Playwright Page object
   * @param options - Optional timeout
   * @returns Text content or null
   */
  async getTextContent(page: Page, options: { timeout?: number } = {}): Promise<string | null> {
    const locator = await this.findFirst(page, options);

    if (!locator) {
      return null;
    }

    try {
      return await locator.textContent();
    } catch (_error) {
      logger.warn(`Failed to get text from ${this.description}`);
      return null;
    }
  }
}

// Predefined selector strategies for common elements
export const COOKIE_ACCEPT_STRATEGY = new SelectorStrategy(
  [
    '#onetrust-accept-btn-handler',
    'button[id*="accept" i]',
    'button[class*="accept" i]',
    'button[data-testid*="accept"]',
    '.cookie-accept-btn',
    'button:has-text("Accepter")',
    'button:has-text("Accept")',
    'button:has-text("J\'accepte")',
    'button:has-text("Accepter tout")',
    'button:has-text("Accept all")',
  ],
  'Cookie accept button'
);

export const CLOSE_SITE_LOCATOR_STRATEGY = new SelectorStrategy(
  [
    'button.o-side-panel__close[data-osidepaneltoggle-panel="site-locator"][data-osidepanel-close]',
    'button[data-osidepaneltoggle-panel="site-locator"][data-osidepanel-close]',
    'button.a-btn--as-link.o-side-panel__close[data-osidepaneltoggle-panel="site-locator"]',
    'button[aria-label="CLOSE"][data-osidepaneltoggle-panel="site-locator"]',
  ],
  'Site locator close button'
);

export const CLOSE_NEWSLETTER_STRATEGY = new SelectorStrategy(
  [
    'button.o-side-panel__close[data-osidepaneltoggle-panel="newsletter"][data-osidepanel-close]',
    'button[data-osidepaneltoggle-panel="newsletter"][data-osidepanel-close]',
    'button.a-btn.a-btn--as-link.o-side-panel__close[data-osidepaneltoggle-panel="newsletter"]',
    'button[aria-label="CLOSE"][data-osidepaneltoggle-panel="newsletter"]',
  ],
  'Newsletter close button'
);

export const CLOSE_SHIPPING_BILLING_PANEL_STRATEGY = new SelectorStrategy(
  [
    'button.o-side-panel__close[data-osidepaneltoggle-panel="shippingBillingForms"][data-osidepanel-close]',
    'button[data-osidepaneltoggle-panel="shippingBillingForms"]',
    '.o-side-panel--checkout-shipping .o-side-panel__close',
    'button.o-side-panel__close[data-osidepanel-close]',
  ],
  'Shipping billing forms close button'
);

export async function closeAllSidePanels(
  page: Page,
  options: {
    timeout?: number;
    force?: boolean;
    /** Panel names (from data-osidepanel-name) to never close. Use when filling a form inside a panel. */
    exclude?: string[];
  } = {}
): Promise<void> {
  const { timeout = 300, force = true, exclude = [] } = options; // Increased default to be less aggressive

  const shouldClose = (name: string) => !exclude.includes(name);

  // Close known disruptive panels first using dedicated strategies (fast and targeted)
  // Use .catch without logging to reduce noise
  if (shouldClose('site-locator')) {
    await CLOSE_SITE_LOCATOR_STRATEGY.clickFirst(page, { timeout, force }).catch(() => {});
  }
  if (shouldClose('newsletter')) {
    await CLOSE_NEWSLETTER_STRATEGY.clickFirst(page, { timeout, force }).catch(() => {});
  }
  if (shouldClose('shippingBillingForms')) {
    await CLOSE_SHIPPING_BILLING_PANEL_STRATEGY.clickFirst(page, { timeout, force }).catch(() => {});
  }

  // Targeted close for other common panels
  const badPanels = ['sitemap', 'changelogin', 'social', 'giftoption'];
  for (const panel of badPanels) {
    if (shouldClose(panel)) {
      await page
        .locator(`section[data-osidepanel-name="${panel}"] button[data-osidepanel-close]`)
        .first()
        .click({ timeout: Math.min(timeout, 300), force })
        .catch(() => {});
    }
  }
  // We do a final pass but only on panels that are not excluded.
  const genericClose = page.locator('.o-side-panel__close, button[aria-label*="close" i], button[aria-label*="fermer" i], [data-osidepanel-close]').first();
  if (genericClose) {
    await genericClose.click({ timeout: Math.min(timeout, 300), force: true }).catch(() => {});
  }

  // Best-effort: wait briefly for the most common disruptive panels to actually disappear
  // This improves robustness without adding significant time.
  await Promise.all(
    ['newsletter', 'sitemap', 'changelogin', 'site-locator']
      .filter((n) => shouldClose(n))
      .map((name) =>
        page
          .locator(`section[data-osidepanel-name="${name}"], [data-osidepaneltoggle-panel="${name}"]`)
          .first()
          .waitFor({ state: 'detached', timeout: Math.min(timeout, 400) })
          .catch(() => {})
      )
  );
}

export const VIEW_CART_STRATEGY = new SelectorStrategy(
  [
    '.minicart button[type="submit"]',
    '.minicart a[class*="view-cart" i]',
    'button[data-testid*="view-cart"]',
    'a[data-testid*="view-cart"]',
    '.minicart .checkout-btn',
    'a[href*="/cart"]',
    'button:has-text("Voir le panier")',
    'a:has-text("Voir le panier")',
    'button:has-text("View cart")',
    'a:has-text("View cart")',
  ],
  'View cart button'
);

export const SHIPPING_METHOD_STRATEGY = new SelectorStrategy(
  [
    'input[type="radio"][id*="shipping" i]:not([disabled])',
    'input[type="checkbox"][id*="shipping" i]:not([disabled])',
    'input[type="radio"][name*="shipping" i]:not([disabled])',
    'input[type="checkbox"][name*="delivery" i]:not([disabled])',
    '[class*="shipping-method"] input[type="radio"]:not([disabled])',
    '[class*="delivery-option"] input[type="checkbox"]:not([disabled])',
    'label:has-text("EXPRESS")',
    '.m-field__label--checkbox:has-text("EXPRESS")',
    'div[class*="shipping"]:has-text("EXPRESS")',
  ],
  'Shipping method selector'
);
