import type { Page, Locator } from '@playwright/test';
import { TIMEOUTS } from '../../../config/testConfig';
import { TestLogger } from '../../../utils/logger';
import type { SafeClickOptions } from '../../BasePage';

/**
 * Sprint 21 — extracted from `CheckoutShippingPage.continueToShipping`.
 * Behavior preserved 1:1: same `waitFor` attached, same scroll-into-view
 * evaluate, same `isEnabled` + `waitForFunction` gate, same
 * `safeClick` → JS `evaluate` click fallback, same belt-and-suspenders
 * `evaluate` that fires `form.requestSubmit()` (or `form.submit()`), and
 * same `Promise.race` between `waitForURL(/payment|paiement/)` and the
 * continue-to-payment button becoming visible. Same throw semantics on
 * outer catch (rethrow after logging).
 *
 * Dependencies passed via constructor object:
 *  - `page: Page` — Playwright page.
 *  - `validateAddressButton` / `continueToPaymentButton` — the 2 anchor
 *    Locators the handler needs (owned by the façade).
 *  - `safeClick: SafeClickFn` — bound callback to `BasePage.safeClick`,
 *    so the primitive's internal behavior stays owned by BasePage
 *    (no duplication, no inheritance coupling — Sprint 18/19 pattern).
 *
 * Primitives preserved 1:1 (delta net 0 tree-wide):
 *  - 3 `evaluate()` calls (scrollIntoView, JS click fallback, belt-and-suspenders form.requestSubmit)
 *  - 1 `waitForFunction` (button-enabled gate)
 *  - 2 `requestSubmit` code refs (typeof check + call, inside the belt-and-suspenders evaluate)
 *  - 0 `force: true`
 *  - 0 `waitForTimeout`
 *
 * PII policy (Sprint 21 hardening): the pre-Sprint-21 outer catch
 * emitted `` `Error validating address: ${(error as Error).message}` ``
 * which surfaces raw Playwright errors (can carry selectors, URLs,
 * timeouts). Sprint 21 replaces `.message` with `errorName(error)` — the
 * throw semantics stay identical (the original error is still rethrown),
 * only the log string is PII-safe.
 */

export type SafeClickFn = (
  locator: Locator,
  options?: SafeClickOptions
) => Promise<boolean>;

export interface ContinueToShippingDeps {
  page: Page;
  validateAddressButton: Locator;
  continueToPaymentButton: Locator;
  safeClick: SafeClickFn;
}

const scopedLogger = TestLogger.scoped('ContinueToShipping');

function errorName(err: unknown): string {
  return err instanceof Error && err.name ? err.name : 'UnknownError';
}

function swallowOptional(label: string): (err: unknown) => void {
  return (err) => {
    scopedLogger.debug(`Optional continue-to-shipping step failed: ${label} (${errorName(err)})`);
  };
}

export class ContinueToShippingHandler {
  private readonly page: Page;
  private readonly validateAddressButton: Locator;
  private readonly continueToPaymentButton: Locator;
  private readonly safeClick: SafeClickFn;

  constructor(deps: ContinueToShippingDeps) {
    this.page = deps.page;
    this.validateAddressButton = deps.validateAddressButton;
    this.continueToPaymentButton = deps.continueToPaymentButton;
    this.safeClick = deps.safeClick;
  }

  /**
   * Click submit address button to validate address, then wait for the
   * transition to the payment step. Preserved 1:1 from the pre-Sprint-21
   * `CheckoutShippingPage.continueToShipping` body.
   *
   * Public entry point — same contract as the previous façade method
   * (returns `Promise<void>`, rethrows on outer catch).
   */
  async continue(): Promise<void> {
    try {
      await this.validateAddressButton.waitFor({ state: 'attached', timeout: TIMEOUTS.element });

      // Scroll to button
      await this.validateAddressButton.evaluate((el) => {
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
      });

      // Wait for button to be enabled
      const isEnabled = await this.validateAddressButton.isEnabled();
      if (!isEnabled) {
        scopedLogger.warn('Submit address button disabled, waiting...');
        await this.page
          .waitForFunction(
            (btn) => !(btn as HTMLButtonElement).disabled,
            await this.validateAddressButton.elementHandle(),
            { timeout: TIMEOUTS.medium }
          )
          .catch(() => scopedLogger.warn('Button still disabled, attempting click...'));
      }

      // Click button — try Playwright click first, then JS click + form.requestSubmit()
      // as a fallback. JP standard delivery's SUBMIT ADDRESS sometimes needs the form
      // submit event explicitly fired (the JS click handler doesn't always trigger).
      const clicked = await this.safeClick(this.validateAddressButton, { timeout: TIMEOUTS.short });
      if (!clicked) {
        await this.validateAddressButton.evaluate((el: HTMLElement) => el.click());
      }
      scopedLogger.success('Submit address button clicked');

      // Belt-and-suspenders: also fire the form submit event explicitly. No-op if the
      // first click already navigated; otherwise it triggers the onsubmit handler.
      await this.page
        .evaluate(() => {
          const btn = document.querySelector(
            'button#submitAddressShipping, button.submit-address[type="submit"], button[type="submit"][class*="address"]'
          ) as HTMLButtonElement | null;
          const form = btn?.closest('form') as HTMLFormElement | null;
          if (form) {
            if (typeof form.requestSubmit === 'function') {
              try {
                form.requestSubmit(btn || undefined);
              } catch {
                form.submit();
              }
            } else {
              form.submit();
            }
          }
        })
        .catch(swallowOptional('address form belt-and-suspenders requestSubmit'));

      // Wait for actual transition — URL change OR continue-to-payment button.
      // Use the navigation timeout (30s) not formSubmit (3s) — JP server-side validation
      // of the address can take 10-15s before the page transitions.
      // NOTE: do NOT race against networkIdle here. Pages have continuous GTM/analytics
      // polling that resolves quickly but does NOT mean the form has been processed.
      await Promise.race([
        this.page.waitForURL(/payment|paiement/, { timeout: TIMEOUTS.navigation }),
        this.continueToPaymentButton.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation }),
      ]).catch(() => {
        scopedLogger.warn('Address submit did not transition to payment within navigation timeout');
      });
    } catch (error) {
      // Sprint 21 PII hardening: previous log embedded `.message` (raw
      // Playwright error can carry selectors / URLs / timeouts). Emit
      // only `error.name`. The original error object is rethrown
      // unchanged — same throw semantics as before.
      scopedLogger.error(`Error validating address: ${errorName(error)}`);
      throw error;
    }
  }
}
