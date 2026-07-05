import { Page, Locator } from '@playwright/test';
import { TIMEOUTS } from '../../../config/testConfig';
import { SELECTORS } from '../../selectors';
import { TestLogger } from '../../../utils/logger';
import { SafeClickOptions, SafeFillOptions } from '../../BasePage';

/**
 * Sprint 19 — extracted from `CheckoutShippingPage.enterPostalCode` +
 * `clickOkButton`. Behavior preserved 1:1: same postal code input
 * lookup, same `safeFill` + Tab-press blur, same 4-strategy OK button
 * fallback (`#submitZipCodeButton` waitForFunction-enabled →
 * generic ZIPCODE_OK_BUTTON → ZIPCODE_OK_LINK → Enter key), same
 * network-idle waits, same fail-open early-return when the zipcode
 * field is not visible on page load. No new `force: true`, no new
 * `evaluate()`, no new `waitForTimeout` — the block never had any of
 * these primitives in the first place (delta net 0 tree-wide).
 *
 * Dependencies passed via constructor object — the 4 `BasePage`
 * primitives (`safeFill`, `safeClick`, `waitForNetworkIdle`,
 * `waitForDomContent`) are bound at the façade so their internal
 * behavior (retries, error handling) stays owned by `BasePage` — no
 * duplication, no inheritance coupling (Sprint 18 pattern extended).
 *
 * PII policy (Sprint 19 hardening): the pre-Sprint-19 log
 * `` `Postal code filled: ${postalCode}` `` echoed the raw user
 * postcode — Sprint 19 replaces it with the static label
 * `'Postal code filled'` (same behavior, PII-safe). No other log or
 * throw references the user value.
 */

export type SafeFillFn = (
  locator: Locator,
  value: string,
  options?: SafeFillOptions
) => Promise<boolean>;

export type SafeClickFn = (
  locator: Locator,
  options?: SafeClickOptions
) => Promise<boolean>;

export type WaitForNetworkIdleFn = (timeout?: number) => Promise<void>;
export type WaitForDomContentFn = (timeout?: number) => Promise<void>;

export interface ShippingPostalCodeDeps {
  page: Page;
  safeFill: SafeFillFn;
  safeClick: SafeClickFn;
  waitForNetworkIdle: WaitForNetworkIdleFn;
  waitForDomContent: WaitForDomContentFn;
}

const scopedLogger = TestLogger.scoped('PostalCode');

function errorName(err: unknown): string {
  return err instanceof Error && err.name ? err.name : 'UnknownError';
}

function swallowOptional(label: string): (err: unknown) => void {
  return (err) => {
    scopedLogger.debug(`Optional postal code step failed: ${label} (${errorName(err)})`);
  };
}

export class ShippingPostalCodeHandler {
  private readonly page: Page;
  private readonly safeFill: SafeFillFn;
  private readonly safeClick: SafeClickFn;
  private readonly waitForNetworkIdle: WaitForNetworkIdleFn;
  private readonly waitForDomContent: WaitForDomContentFn;

  constructor(deps: ShippingPostalCodeDeps) {
    this.page = deps.page;
    this.safeFill = deps.safeFill;
    this.safeClick = deps.safeClick;
    this.waitForNetworkIdle = deps.waitForNetworkIdle;
    this.waitForDomContent = deps.waitForDomContent;
  }

  /**
   * Enter postal code to unlock shipping form.
   *
   * Flow (preserved 1:1):
   *  1. Locate postal input via
   *     `#zipCodeForShippingMethods, input.shippingZipCode, input[name*="postalCode"]`.
   *  2. If not visible within `TIMEOUTS.navigation`, log info and
   *     early-return `true` — the form is already open on this SKU/region.
   *  3. `safeFill` the postcode, then Tab to blur (triggers async validation).
   *  4. Invoke `clickOkButton` with its 4-strategy fallback.
   *  5. On success, wait for network idle so the shipping method list
   *     paint is captured before the caller queries the DOM.
   *
   * Returns `true` in both the early-return case (no zipcode field on
   * page) AND the happy path. Returns `false` only when `safeFill` fails.
   */
  async enter(postalCode: string): Promise<boolean> {
    scopedLogger.step('🔍 Looking for zipcode field');

    // Prioritize the exact US zip field the user specified
    const postalCodeInput = this.page.locator('#zipCodeForShippingMethods, input.shippingZipCode, input[name*="postalCode"]').first();

    // Wait for the zipcode field to appear and become visible
    // Note: isVisible() is an instant check (timeout param is deprecated in Playwright 1.33+),
    // so we must use waitFor() which properly waits for the element.
    try {
      await postalCodeInput.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation });
      scopedLogger.info('Zipcode field found and visible');
    } catch {
      scopedLogger.info('No initial zipcode field found - proceeding directly to form');
      return true;
    }

    // Fill postal code
    const filled = await this.safeFill(postalCodeInput, postalCode);
    if (!filled) return false;
    // Sprint 19 PII hardening: previous log echoed the raw `${postalCode}`.
    // Emit only a static label; no user value is ever surfaced.
    scopedLogger.success('Postal code filled');

    // Sprint 3: waitForTimeout(100) padding removed — the Tab press already
    // triggers the async validation, and `clickOkButton` below has its own
    // `submitZipButton.waitFor({ state: 'visible' })` so the OK button
    // becoming ready is a proper web-first signal.
    await postalCodeInput.press('Tab').catch(swallowOptional('postal code Tab blur'));

    // Click OK button using multiple strategies
    const okClicked = await this.clickOkButton();
    if (okClicked) {
      scopedLogger.step('📝 Waiting for shipping options to appear');
      await this.waitForNetworkIdle(TIMEOUTS.medium);
    }

    return true;
  }

  /**
   * Click OK button to validate postal code.
   * Uses `#submitZipCodeButton` as primary, then generic button, link,
   * and Enter fallbacks.
   */
  private async clickOkButton(): Promise<boolean> {
    // Primary: use specific ID selector
    const submitZipButton = this.page.locator('#submitZipCodeButton').first();
    try {
      // After fill + Tab, wait for the OK to become visible AND enabled
      await submitZipButton.waitFor({ state: 'visible', timeout: TIMEOUTS.medium });
      await this.page
        .waitForFunction((el) => {
          const btn = el as HTMLButtonElement;
          return !btn.disabled && !btn.hasAttribute('disabled');
        }, await submitZipButton.elementHandle(), { timeout: TIMEOUTS.medium })
        .catch(swallowOptional('waitForFunction OK-button-enabled'));

      if (await this.safeClick(submitZipButton, { timeout: TIMEOUTS.short })) {
        await this.waitForNetworkIdle(TIMEOUTS.medium);
        scopedLogger.success('OK button clicked (#submitZipCodeButton)');
        return true;
      }
    } catch {
      // Continue to fallbacks
    }

    // Fallback: generic button selector
    const okButton = this.page.locator(SELECTORS.CHECKOUT.SHIPPING.ZIPCODE_OK_BUTTON).first();
    if (await this.safeClick(okButton, { timeout: TIMEOUTS.short })) {
      await this.waitForNetworkIdle(TIMEOUTS.medium);
      scopedLogger.success('OK button clicked (button)');
      return true;
    }

    // Fallback: link/span
    const okLink = this.page.locator(SELECTORS.CHECKOUT.SHIPPING.ZIPCODE_OK_LINK).first();
    if (await this.safeClick(okLink, { timeout: TIMEOUTS.short })) {
      await this.waitForDomContent();
      scopedLogger.success('OK button clicked (link/span)');
      return true;
    }

    // Fallback: press Enter
    const postalCodeInput = this.page.locator(SELECTORS.CHECKOUT.SHIPPING.ZIPCODE_INPUT).first();
    try {
      await postalCodeInput.press('Enter');
      await this.waitForNetworkIdle(TIMEOUTS.medium);
      scopedLogger.success('Enter key pressed to validate postal code');
      return true;
    } catch {
      return false;
    }
  }
}
