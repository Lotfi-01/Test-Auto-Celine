import { test as base, Page } from '@playwright/test';
import { CelineHomePage } from '../pages/CelineHomePage';
import { CelineProductPage } from '../pages/CelineProductPage';
import { CelineCheckoutPage } from '../pages/CelineCheckoutPage';
import { TEST_CONFIG } from '../config/testConfig';

/**
 * Extended fixtures for Celine tests
 * These fixtures provide pre-initialized page objects and utilities
 */

type CelineFixtures = {
  homePage: CelineHomePage;
  productPage: CelineProductPage;
  checkoutPage: CelineCheckoutPage;
  authenticatedPage: Page;
};

/**
 * Extend Playwright test with Celine-specific fixtures
 */
export const test = base.extend<CelineFixtures>({
  /**
   * HomePage fixture - automatically initialized
   * Does NOT navigate or accept cookies (use in tests as needed)
   */
  homePage: async ({ page }, use) => {
    const homePage = new CelineHomePage(page);
    await use(homePage);
  },

  /**
   * ProductPage fixture - automatically initialized
   */
  productPage: async ({ page }, use) => {
    const productPage = new CelineProductPage(page);
    await use(productPage);
  },

  /**
   * CheckoutPage fixture - automatically initialized
   */
  checkoutPage: async ({ page }, use) => {
    const checkoutPage = new CelineCheckoutPage(page);
    await use(checkoutPage);
  },

  /**
   * Authenticated page - page with HTTP credentials already set
   * Useful for tests that need to bypass the initial auth
   */
  authenticatedPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      httpCredentials: {
        username: TEST_CONFIG.auth.username,
        password: TEST_CONFIG.auth.password,
      },
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

/**
 * Export expect from @playwright/test for convenience
 */
export { expect } from '@playwright/test';
