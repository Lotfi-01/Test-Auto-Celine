import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import { COOKIE_ACCEPT_STRATEGY } from '../utils/selectorStrategy';
import { waitForPageReady } from '../utils/pageHelpers';
import { TEST_CONFIG, TIMEOUTS } from '../config/testConfig';
import { SELECTORS } from './selectors';

/**
 * Celine Home Page
 * Handles navigation, cookie acceptance, and popup management
 *
 * Extends BasePage for consistent error handling and logging
 */
export class CelineHomePage extends BasePage {
  readonly cartIcon: Locator;
  readonly cartBadge: Locator;
  readonly newCollectionLink: Locator;
  readonly giftsForHerLink: Locator;

  constructor(page: Page) {
    super(page, 'HomePage');

    // Navigation elements - using centralized selectors
    this.cartIcon = page.locator(SELECTORS.CART.ICON).first();
    this.cartBadge = page.locator('.minicart-quantity, [class*="cart-count"]').first();

    // Category links
    this.newCollectionLink = page.locator('a[href*="/nouvelle-collection"], a[href*="/new-collection"]');
    this.giftsForHerLink = page.locator('a[href*="/cadeaux"], a[href*="/gifts"]');
  }

  /**
   * Navigate to home page and wait for it to be ready
   */
  async goto(): Promise<void> {
    // Extract locale from test product URL
    const localeMatch = TEST_CONFIG.urls.testProduct.match(/^\/(en-us|fr-fr|it-it|es-es|de-de|ja-jp|zh-cn)\//);
    const locale = localeMatch ? localeMatch[1] : 'en-us';

    await this.page.goto(`${TEST_CONFIG.urls.base}/${locale}/home`);
    await waitForPageReady(this.page, SELECTORS.NAV.HOME_LINK, TIMEOUTS.navigation);
  }

  /**
   * Accept cookie banner if present
   * Uses SelectorStrategy for robustness
   */
  async acceptCookies(): Promise<boolean> {
    try {
      const clicked = await COOKIE_ACCEPT_STRATEGY.clickFirst(this.page, {
        timeout: TIMEOUTS.short,
        waitAfter: TIMEOUTS.animation * 2,
      });

      if (!clicked) {
        this.log('No cookie banner detected', 'info');
      }

      return clicked;
    } catch (error) {
      this.log(`Error accepting cookies: ${(error as Error).message}`, 'warn');
      return false;
    }
  }

  /**
   * Navigate to a specific category
   * @param categoryUrl - Relative URL path for category
   */
  async navigateToCategory(categoryUrl: string): Promise<void> {
    const fullUrl = categoryUrl.startsWith('/')
      ? `${TEST_CONFIG.urls.base}${categoryUrl}`
      : `${TEST_CONFIG.urls.base}/${categoryUrl}`;

    await this.page.goto(fullUrl);
    await waitForPageReady(this.page, undefined, TIMEOUTS.navigation);
  }

  /**
   * Get cart item count from badge
   * @returns Cart item count as string, '0' if empty
   */
  async getCartItemCount(): Promise<string> {
    const text = await this.getTextContent(this.cartBadge, {
      timeout: TIMEOUTS.element,
    });
    return text || '0';
  }

  /**
   * Navigate to cart page
   */
  async goToCart(): Promise<boolean> {
    const clicked = await this.safeClick(this.cartIcon, {
      timeout: TIMEOUTS.element,
    });

    if (clicked) {
      await waitForPageReady(this.page);
    }

    return clicked;
  }

  /**
   * Check if page is loaded correctly
   * @returns true if on Celine homepage
   */
  async isLoaded(): Promise<boolean> {
    try {
      const title = await this.page.title();
      const url = this.page.url();

      return title.includes('CELINE') && url.includes('celine.com');
    } catch {
      return false;
    }
  }
}
