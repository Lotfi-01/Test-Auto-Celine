import { Page, Locator } from '@playwright/test';
import { VIEW_CART_STRATEGY } from '../utils/selectorStrategy';
import { safeClick, waitForApiResponse, waitForPageReady } from '../utils/pageHelpers';
import { retry } from '../utils/retryHelper';
import { TEST_CONFIG, TIMEOUTS } from '../config/testConfig';
import { SELECTORS } from './selectors';
import { logger } from '../utils/logger';

export class CelineProductPage {
  readonly page: Page;
  readonly productTitle: Locator;
  readonly productPrice: Locator;
  readonly sizeSelector: Locator;
  readonly colorSelector: Locator;
  readonly addToCartButton: Locator;
  readonly buyNowButton: Locator;
  readonly cartIcon: Locator;

  constructor(page: Page) {
    this.page = page;

    // Product information
    this.productTitle = page.locator(SELECTORS.PRODUCT.TITLE).first();
    this.productPrice = page.locator(SELECTORS.PRODUCT.PRICE).first();

    // Variant selectors
    this.sizeSelector = page.locator(SELECTORS.PRODUCT.SIZE_SELECTOR);
    this.colorSelector = page.locator(SELECTORS.PRODUCT.COLOR_SELECTOR);

    // Actions
    this.addToCartButton = page.locator(SELECTORS.PRODUCT.ADD_TO_CART).first();
    this.buyNowButton = page.locator(SELECTORS.PRODUCT.BUY_NOW).first();
    this.cartIcon = page.locator(SELECTORS.CART.ICON).first();
  }

  /**
   * Get product title
   * @returns Product title text or null
   */
  async getProductTitle(): Promise<string | null> {
    await this.productTitle.waitFor({
      state: 'visible',
      timeout: TEST_CONFIG.timeouts.element,
    });
    return await this.productTitle.textContent();
  }

  /**
   * Get product price
   * @returns Product price text or null
   */
  async getProductPrice(): Promise<string | null> {
    await this.productPrice.waitFor({
      state: 'visible',
      timeout: TEST_CONFIG.timeouts.element,
    });
    return await this.productPrice.textContent();
  }

  /**
   * Select first available size
   * @returns true if size was selected, false if no size selection needed
   */
  async selectFirstAvailableSize(): Promise<boolean> {
    try {
      // Primary: clickable size labels (Celine renders sizes as <label> tied to a hidden radio)
      const sizeLabels = await this.page.locator(SELECTORS.PRODUCT.SIZE_SELECTOR_LABEL).all();
      for (const label of sizeLabels) {
        const forId = await label.getAttribute('for');

        // Skip sizes flagged as disabled/out-of-stock by Celine via class or linked input state
        const isUnavailable = await label
          .evaluate((el) => {
            const cls = el.getAttribute('class') || '';
            if (/(s-disabled|s-inactive|is-disabled|disabled|out-of-stock|unavailable|s-oos)/i.test(cls)) return true;
            const forAttr = el.getAttribute('for');
            if (forAttr) {
              const linked = document.getElementById(forAttr) as HTMLInputElement | null;
              if (linked && (linked.disabled || (linked.getAttribute('class') || '').match(/disabled|oos/i)))
                return true;
            }
            return false;
          })
          .catch(() => false);
        if (isUnavailable) {
          logger.info(`[Product] Skipping unavailable size (label for=${forId})`);
          continue;
        }

        await safeClick(label, this.page, {
          maxRetries: 2,
          waitBeforeClick: 50,
        });

        // Brief JS update check (OOS)
        await this.page.waitForTimeout(20);
        const isOOS = await this.page.evaluate(() => {
          const notifyTrigger = document.querySelector(
            '[data-osidepaneltoggle-panel="notifyMe"]'
          ) as HTMLElement | null;
          if (notifyTrigger) {
            const cs = window.getComputedStyle(notifyTrigger);
            return cs.display !== 'none' && cs.visibility !== 'hidden' && notifyTrigger.offsetParent !== null;
          }
          return false;
        });
        if (isOOS) {
          logger.warn(`[Product] Size ${forId} is OOS (Get Notified visible) — trying next`);
          continue;
        }

        logger.success(`[Product] Size selected (label for=${forId})`);
        return true;
      }

      // Fallback: radio button size selectors
      const sizeRadios = await this.page.locator(SELECTORS.PRODUCT.SIZE_SELECTOR_RADIO).all();
      if (sizeRadios.length > 0) {
        for (const radio of sizeRadios) {
          const isDisabled = await radio.getAttribute('disabled');
          if (!isDisabled) {
            await safeClick(radio, this.page, {
              maxRetries: 2,
              waitBeforeClick: 100,
            });
            logger.success('[Product] Size selected (radio)');
            return true;
          }
        }
      }

      // Fallback: button-style size selectors
      const sizeButtons = await this.sizeSelector.all();

      if (sizeButtons.length === 0) {
        logger.info('[Product] No size selector found');
        return true; // Product doesn't require size selection
      }

      for (const sizeButton of sizeButtons) {
        const isDisabled = await sizeButton.getAttribute('disabled');

        if (!isDisabled) {
          await safeClick(sizeButton, this.page, {
            maxRetries: 2,
            waitBeforeClick: 100,
          });
          logger.success('[Product] Size selected');
          return true;
        }
      }

      logger.warn('[Product] No available size found');
      return false;
    } catch (_error) {
      logger.info('[Product] Size selection not required or failed');
      return true;
    }
  }

  /**
   * Select first available color
   */
  async selectFirstAvailableColor(): Promise<void> {
    try {
      const colorButtons = await this.colorSelector.all();

      if (colorButtons.length > 0) {
        await safeClick(colorButtons[0], this.page, {
          maxRetries: 2,
          waitBeforeClick: 100,
        });
        logger.success('[Product] Color selected');
      }
    } catch (_error) {
      logger.info('[Product] Color selection not required');
    }
  }

  /**
   * Check if product is available for purchase
   * @returns true if available, false otherwise
   */
  async isProductAvailable(): Promise<boolean> {
    try {
      const isVisible = await this.addToCartButton.isVisible({
        timeout: TEST_CONFIG.timeouts.element,
      });
      const isEnabled = await this.addToCartButton.isEnabled();

      return isVisible && isEnabled;
    } catch (_error) {
      return false;
    }
  }

  /**
   * Add product to cart with retry logic and API validation
   */
  async addToCart(): Promise<void> {
    await retry.interaction(async () => {
      // Defensive: close any active side panel via JS (instant, no timeouts).
      // Cookies are already accepted at page load and persist via consent cookie,
      // so we don't re-run COOKIE_ACCEPT_STRATEGY here (saves ~20s of dead retries).
      await this.page
        .evaluate(() => {
          document
            .querySelectorAll(
              'section[data-osidepanel-name].s-panel-active, section[data-behavior="oSidePanel"][aria-hidden="false"]'
            )
            .forEach((panel) => {
              const closeBtn = panel.querySelector('button[data-osidepanel-close]') as HTMLButtonElement | null;
              if (closeBtn) closeBtn.click();
            });
        })
        .catch(() => {});
      await this.page.waitForTimeout(50);

      // After size selection, the variant ADD TO BAG button is in the DOM with `hidden`.
      // Wait for it to lose `hidden` (i.e. become truly visible) — this is Celine's
      // signal that the size has been registered and the cart is ready to accept it.
      const variantBtn = this.page.locator('button.add-to-cart[form="form-product"]:not([hidden])').first();
      try {
        await variantBtn.waitFor({ state: 'visible', timeout: TEST_CONFIG.timeouts.element });
      } catch {
        // Fallback: pick any non-hidden add-to-cart button via JS
        const handle = await this.page.evaluateHandle(() => {
          const btns = Array.from(document.querySelectorAll('button.add-to-cart')) as HTMLButtonElement[];
          return btns.find((b) => !b.hasAttribute('hidden') && window.getComputedStyle(b).display !== 'none') || null;
        });
        if (!handle) throw new Error('No visible ADD TO BAG button found after size selection');
      }

      logger.step('[Product] Clicking ADD TO CART');

      // Close the site-locator popin right before clicking add to cart (this overlay blocks the button)
      const { CLOSE_SITE_LOCATOR_STRATEGY } = await import('../utils/selectorStrategy');
      await CLOSE_SITE_LOCATOR_STRATEGY.clickFirst(this.page, { timeout: 100, force: true }).catch(() => {});

      // Close the newsletter popin only if it appears, before Add to cart
      // Selector: button with data-osidepaneltoggle-panel="newsletter"
      const newsletterPopin = this.page.locator('button.a-btn.a-btn--as-link.o-side-panel__close[data-osidepaneltoggle-panel="newsletter"]');
      if (await newsletterPopin.isVisible({ timeout: 100 }).catch(() => false)) {
        await newsletterPopin.click({ force: true }).catch(() => {});
      }

      // noWaitAfter: true — Celine sometimes triggers a "scheduled navigation" on click
      // that never resolves; we don't care about navigation, only the AJAX response.
      const [response] = await Promise.all([
        waitForApiResponse(this.page, /Cart-AddProduct/, {
          timeout: TEST_CONFIG.timeouts.api,
          status: 200,
        }),
        variantBtn.click({ timeout: TIMEOUTS.medium, noWaitAfter: true }),
      ]);

      if (response) {
        logger.success('[Product] Product added to cart (Cart-AddProduct confirmed)');
      } else {
        logger.warn('[Product] Cart-AddProduct response not detected');
      }
    });
  }

  /**
   * Check if add to cart button is enabled
   * @returns true if enabled, false otherwise
   */
  async isAddToCartButtonEnabled(): Promise<boolean> {
    try {
      return await this.addToCartButton.isEnabled({
        timeout: TEST_CONFIG.timeouts.element,
      });
    } catch (_error) {
      return false;
    }
  }

  /**
   * Buy now - goes directly to checkout
   */
  async buyNow(): Promise<void> {
    await retry.interaction(async () => {
      // Verify product is available
      const isAvailable = await this.isProductAvailable();

      if (!isAvailable) {
        // Try selecting size/color if not available
        await this.selectFirstAvailableSize();
        await this.selectFirstAvailableColor();
      }

      // Wait for Buy Now button to be ready
      await this.buyNowButton.waitFor({
        state: 'visible',
        timeout: TEST_CONFIG.timeouts.element,
      });

      logger.step('[Product] Clicking BUY NOW');

      // Buy Now triggers an XHR + JS-driven redirect. On JP, Playwright's native
      // .click() can hang indefinitely at "performing click action" — the page becomes
      // unresponsive while the JS handler runs. Dispatch the click via in-page JS
      // so we sidestep Playwright's internal action tracking entirely.
      await this.buyNowButton.scrollIntoViewIfNeeded().catch(() => {});
      await this.buyNowButton.evaluate((el: HTMLElement) => el.click());

      logger.success('[Product] Buy Now clicked - redirecting to checkout');

      // Wait for the actual checkout URL — most reliable signal of redirect.
      await this.page
        .waitForURL(/\/checkout/, { timeout: TEST_CONFIG.timeouts.navigation })
        .catch(() => waitForPageReady(this.page, undefined, TEST_CONFIG.timeouts.navigation));
    });
  }

  /**
   * Navigate to cart page after adding product
   * Uses SelectorStrategy for robustness
   */
  async goToCart(): Promise<void> {
    // Close side panels before trying to go to cart (they can block mini-cart)
    const { closeAllSidePanels } = await import('../utils/selectorStrategy');
    await closeAllSidePanels(this.page, { timeout: 50, force: true });

    // Wait for mini-cart to appear after adding product
    // Wait for mini-cart badge or icon to update
    await this.page.waitForLoadState('domcontentloaded');
    await this.cartIcon.waitFor({ state: 'visible', timeout: TIMEOUTS.short }).catch(() => {});

    // Try to click the view cart button in mini-cart
    const clicked = await VIEW_CART_STRATEGY.clickFirst(this.page, {
      timeout: TIMEOUTS.short,
      waitAfter: TIMEOUTS.sectionTransition,
    });

    if (!clicked) {
      logger.warn('[Product] Mini-cart button not found - navigating directly');
      // Fallback: navigate directly to cart (extract locale from current URL)
      const currentUrl = this.page.url();
      const localeMatch = currentUrl.match(/\/([a-z]{2}-[a-z]{2})\//);
      const locale = localeMatch ? localeMatch[1] : 'en-us';
      await this.page.goto(`${TEST_CONFIG.urls.base}/${locale}/cart`);
    }

    // More robust cart ready wait: URL or common cart selectors
    try {
      await Promise.race([
        this.page.waitForURL(/\/cart/i, { timeout: TEST_CONFIG.timeouts.navigation }),
        waitForPageReady(this.page, 'h2, [class*="cart-title"], .cart, [data-testid*="cart"]', TEST_CONFIG.timeouts.navigation / 2),
      ]);
    } catch {
      // Last fallback: just ensure dom loaded
      await this.page.waitForLoadState('domcontentloaded');
    }
  }

  /**
   * Proceed to checkout from the cart page.
   * Prefers clicking the checkout button (user-like flow).
   * Falls back to direct navigation if needed (with locale detection).
   */
  async proceedToCheckout(): Promise<void> {
    const { closeAllSidePanels } = await import('../utils/selectorStrategy');
    await closeAllSidePanels(this.page, { timeout: 50, force: true });

    const checkoutBtn = this.page.locator(SELECTORS.CART.CHECKOUT_BUTTON).first();

    try {
      await checkoutBtn.waitFor({ state: 'visible', timeout: TIMEOUTS.medium });
      await checkoutBtn.click({ timeout: TIMEOUTS.medium });

      await this.page
        .waitForURL(/checkout|paiement/i, { timeout: TEST_CONFIG.timeouts.navigation })
        .catch(() => {});
    } catch {
      logger.warn('[Product] Checkout button not clickable from cart, using direct navigation fallback');
      // Fallback: direct goto with proper locale
      const currentUrl = this.page.url();
      const localeMatch = currentUrl.match(/\/([a-z]{2}-[a-z]{2})\//);
      const locale = localeMatch ? localeMatch[1] : 'en-us';
      await this.page.goto(`${TEST_CONFIG.urls.base}/${locale}/checkout`);
    }
  }

  /**
   * Right after addToCart(), the mini-cart side panel is usually open
   * with a direct CHECKOUT button. Click it if present (preferred flow).
   * Does NOT close side panels first.
   */
  async tryCheckoutFromMiniCart(): Promise<boolean> {
    const checkoutBtn = this.page
      .locator(SELECTORS.CART.CHECKOUT_BUTTON)
      .first();

    try {
      await checkoutBtn.waitFor({ state: 'visible', timeout: 1500 });
      await checkoutBtn.click({ timeout: 2000 });

      await this.page
        .waitForURL(/checkout|paiement/i, { timeout: TEST_CONFIG.timeouts.navigation })
        .catch(() => {});

      return true;
    } catch {
      return false;
    }
  }
}
