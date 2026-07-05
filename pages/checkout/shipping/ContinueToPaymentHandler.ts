import type { Page, Locator } from '@playwright/test';
import { TIMEOUTS } from '../../../config/testConfig';
import { TestLogger } from '../../../utils/logger';
import { closeAllSidePanels } from '../../../utils/selectorStrategy';
import { redactUrl } from '../payment/urlRedaction';
import type { SafeClickOptions } from '../../BasePage';

/**
 * Sprint 22 — extracted from `CheckoutShippingPage.continueToPayment`.
 * Behavior preserved 1:1: same `waitForLoadState('domcontentloaded')`,
 * same `closeAllSidePanels` with the same `force: true` +
 * `exclude: ['shippingBillingForms']` options, same pre-check
 * `waitForURL(/payment|paiement/)`, same 4-strategy detection (URL
 * match → visible continue button + click + post-click waitForURL →
 * visible DOM markers via `page.evaluate` → throw). Same return
 * contract: `Promise<boolean>` with 3 `return true` branches and 1
 * outer throw when none of the strategies detect payment.
 *
 * Not coupled with `clickSubmitShipping` — these are two distinct
 * public methods on the façade. `completeShippingStep` orchestrates
 * both without shared state.
 *
 * Dependencies passed via constructor object:
 *  - `page: Page` — Playwright page.
 *  - `continueToPaymentButton: Locator` — the anchor button owned by
 *    the façade.
 *  - `safeClick: SafeClickFn` — bound to `BasePage.safeClick`.
 *  - `isVisible: IsVisibleFn` — bound to `BasePage.isVisible`.
 *
 * Primitives preserved 1:1 (delta net 0 tree-wide):
 *  - 1 `force: true` (inside the `closeAllSidePanels` options object —
 *    kept identical, this closes stray panels aggressively before the
 *    payment transition).
 *  - 1 `evaluate()` (visible-DOM-marker check for Adyen/Cybersource
 *    iframes — must be visible, hidden pre-loaded markers would
 *    false-positive).
 *  - 0 `waitForTimeout`, 0 `waitForFunction`.
 *
 * PII policy (Sprint 22 hardening): the pre-Sprint-22 outer throw
 * emitted `` `Failed to reach payment step — still at ${finalUrl}` ``
 * which surfaces the raw current URL (query params may carry session
 * tokens, order IDs, cart IDs). Sprint 22 replaces `finalUrl` with
 * `redactUrl(finalUrl)` (imported from the shared Payment helper) —
 * throw semantics stay identical (same Error, same failure mode), only
 * the string carries `origin + pathname` instead of the full URL.
 * `swallowOptional` uses `errorName` only.
 */

export type SafeClickFn = (
  locator: Locator,
  options?: SafeClickOptions
) => Promise<boolean>;

export type IsVisibleFn = (locator: Locator, timeout?: number) => Promise<boolean>;

export interface ContinueToPaymentDeps {
  page: Page;
  continueToPaymentButton: Locator;
  safeClick: SafeClickFn;
  isVisible: IsVisibleFn;
}

const scopedLogger = TestLogger.scoped('ContinueToPayment');

function errorName(err: unknown): string {
  return err instanceof Error && err.name ? err.name : 'UnknownError';
}

function swallowOptional(label: string): (err: unknown) => void {
  return (err) => {
    scopedLogger.debug(`Optional continue-to-payment step failed: ${label} (${errorName(err)})`);
  };
}

export class ContinueToPaymentHandler {
  private readonly page: Page;
  private readonly continueToPaymentButton: Locator;
  private readonly safeClick: SafeClickFn;
  private readonly isVisible: IsVisibleFn;

  constructor(deps: ContinueToPaymentDeps) {
    this.page = deps.page;
    this.continueToPaymentButton = deps.continueToPaymentButton;
    this.safeClick = deps.safeClick;
    this.isVisible = deps.isVisible;
  }

  /**
   * Click continue-to-payment button. After address validation, the page
   * may auto-navigate to payment. Preserved 1:1 from the pre-Sprint-22
   * façade body.
   *
   * Public entry point — same contract as the previous façade method
   * (returns `Promise<boolean>`, 3 truthy paths, throws when payment is
   * not detected by any strategy).
   */
  async continue(): Promise<boolean> {
    await this.page.waitForLoadState('domcontentloaded');

    // Close any remaining panels before attempting to move to payment.
    // Exclude shippingBillingForms (we may have just submitted it) and be conservative on payment page.
    await closeAllSidePanels(this.page, { timeout: 50, force: true, exclude: ['shippingBillingForms'] });

    // Wait up to navigation timeout for the URL to change. The address submit can take
    // 10-15s on slow regions (JP) before the URL flips to /payment.
    await this.page
      .waitForURL(/payment|paiement/, { timeout: TIMEOUTS.navigation })
      .catch(swallowOptional('waitForURL /payment (pre-check)'));

    // 1) URL on payment? Done.
    const currentUrl = this.page.url();
    if (currentUrl.includes('payment') || currentUrl.includes('paiement')) {
      scopedLogger.success('Already on payment section (URL-based check)');
      return true;
    }

    // 2) Click the explicit Continue-to-payment button if it's visible.
    const buttonVisible = await this.isVisible(this.continueToPaymentButton, TIMEOUTS.short);
    if (buttonVisible) {
      const clicked = await this.safeClick(this.continueToPaymentButton, { timeout: TIMEOUTS.short });
      if (clicked) {
        scopedLogger.success('Continued to payment (clicked button)');
        await this.page
          .waitForURL(/payment|paiement/, { timeout: TIMEOUTS.navigation })
          .catch(swallowOptional('waitForURL /payment (post-continue click)'));
        return true;
      }
    }

    // 3) Verify by DOM that the payment STEP is actually rendered. Use VISIBLE markers only —
    //    hidden pre-loaded payment iframes/markers on the delivery page would otherwise
    //    false-positive and we'd march into payment fill on a stale page.
    const onPaymentByDom = await this.page
      .evaluate(() => {
        const isVisible = (el: Element | null) => {
          if (!el) return false;
          const cs = window.getComputedStyle(el as HTMLElement);
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
          return (el as HTMLElement).offsetParent !== null;
        };
        // Strict markers — must be visible to count
        const visibleMarkers = [
          '#rb_scheme', // Adyen credit card radio
          'label[for="rb_scheme"]', // Adyen credit card label
          'iframe[src*="adyen"]:not([style*="display: none"])',
          'iframe[src*="cybersource"]:not([style*="display: none"])',
        ];
        return visibleMarkers.some((sel) => {
          const el = document.querySelector(sel);
          return isVisible(el);
        });
      })
      .catch(() => false);
    if (onPaymentByDom) {
      scopedLogger.success('Already on payment section (visible DOM marker check)');
      return true;
    }

    // 4) Stuck — surface a clear error so the failure mode is obvious.
    // Sprint 22 PII hardening: previous throw embedded the raw `finalUrl`
    // (query params can carry session tokens / order IDs / cart IDs).
    // Use `redactUrl` to keep origin + pathname only.
    const finalUrl = this.page.url();
    throw new Error(`Failed to reach payment step — still at ${redactUrl(finalUrl)}`);
  }
}
