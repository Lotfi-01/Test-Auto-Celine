import { Page, Locator } from '@playwright/test';
import { TIMEOUTS } from '../../../config/testConfig';
import { SELECTORS } from '../../selectors';
import { SHIPPING_METHOD_STRATEGY } from '../../../utils/selectorStrategy';
import { TestLogger } from '../../../utils/logger';

/**
 * Sprint 18 — extracted from `CheckoutShippingPage.selectFirstShippingMethod`.
 * Behavior preserved 1:1: same 4-strategy fallback (label click → name
 * selector + safeClickWithLabelFallback → SHIPPING_METHOD_STRATEGY →
 * radio/label force + JS click), same timeouts, same 2 `force: true` and
 * 2 JS `evaluate` fallbacks (delta net 0 tree-wide).
 *
 * The extracted helper does NOT import `CheckoutShippingPage`. Dependencies:
 *  - `page: Page` — Playwright page.
 *  - `firstNameInput: Locator` — the shipping form anchor used for the
 *    post-select "form ready" heuristic.
 *  - `safeClickWithLabelFallback: SafeClickWithLabelFallback` — a
 *    callback bound to the façade's `BasePage.safeClickWithLabelFallback`.
 *    Passed as a callback (not reimplemented locally) so the two
 *    `force: true` calls inside that primitive stay owned by `BasePage`
 *    — Sprint 18 delta net on `force: true` is 0.
 *
 * PII policy: labels are static; the pre-Sprint-18 `` `${e}` `` in the
 * initial-click-failure warn log leaked a raw Playwright error (which
 * can carry selectors, timeouts, URLs) — Sprint 18 replaces it with
 * `errorName(e)`. Errors surface via `error.name` only — never
 * `.message`, never `String(error)`, never `JSON.stringify(error)`. No
 * shipping method label, price, or currency is ever emitted.
 */

/**
 * Callback shape matching `BasePage.safeClickWithLabelFallback`. Passed
 * from the façade so this helper does not inherit from `BasePage` and
 * does not duplicate the `force: true` calls inside the primitive.
 */
export type SafeClickWithLabelFallback = (
  locator: Locator,
  options?: { timeout?: number; force?: boolean }
) => Promise<boolean>;

const scopedLogger = TestLogger.scoped('ShippingMethod');

function errorName(err: unknown): string {
  return err instanceof Error && err.name ? err.name : 'UnknownError';
}

function swallowOptional(label: string): (err: unknown) => void {
  return (err) => {
    scopedLogger.debug(`Optional shipping method step failed: ${label} (${errorName(err)})`);
  };
}

export class ShippingMethodSelector {
  constructor(
    private readonly page: Page,
    private readonly firstNameInput: Locator,
    private readonly safeClickWithLabelFallback: SafeClickWithLabelFallback
  ) {}

  /**
   * Select the first available shipping method.
   *
   * Strategy (preserved 1:1 from the pre-Sprint-18 code):
   *  1. Click `label.shipping-method-option` first (most reliable — this
   *     is the label the design team asked us to click).
   *  2. Fall back to a name-based selector +
   *     `safeClickWithLabelFallback` (delegated to the façade).
   *  3. Fall back to `SHIPPING_METHOD_STRATEGY.findFirst` + the same
   *     safe-click-with-label-fallback.
   *  4. Fall back to raw `input[type="radio"]` or `label[for=...]` with
   *     `force: true`, then a JS `.click()` if the force click fails.
   *
   * After a successful click, wait up to `TIMEOUTS.element` for the
   * standard address form's first-name input to attach — same
   * "form loaded" heuristic as before.
   *
   * Returns `true` iff any of the 4 strategies clicked something.
   * Never throws.
   */
  async selectFirst(): Promise<boolean> {
    scopedLogger.step('📝 Selecting shipping method');

    // Click the shipping method label as specified by user to open the form.
    // Example: label.shipping-method-option with for="shippingMethod-Standard-..."
    const shippingLabel = this.page.locator('label.shipping-method-option').first();
    let clicked = false;

    try {
      await shippingLabel.waitFor({ state: 'visible', timeout: TIMEOUTS.medium });
      await shippingLabel.click({ timeout: TIMEOUTS.short });
      clicked = true;
      scopedLogger.success('Shipping method label clicked (opened form)');
    } catch (e) {
      // Sprint 18: previous log embedded `${e}` (raw Playwright error). Emit
      // only `error.name` per Sprint 6/7/8/11 PII rule for new files.
      scopedLogger.warn(`Failed to click shipping label: ${errorName(e)}`);
      // Fallbacks
      const shippingByName = this.page.locator(SELECTORS.CHECKOUT.SHIPPING.SHIPPING_METHOD_BY_NAME).first();
      try {
        await shippingByName.waitFor({ state: 'attached', timeout: TIMEOUTS.short });
        clicked = await this.safeClickWithLabelFallback(shippingByName, {
          timeout: TIMEOUTS.short,
        });
      } catch (error) {
        // Sprint 11: preserved — fall-through to later strategies is the invariant.
        scopedLogger.debug(
          `Optional shipping method fallback skipped: shippingByName strategy (${errorName(error)})`
        );
      }

      if (!clicked) {
        const shippingInput = await SHIPPING_METHOD_STRATEGY.findFirst(this.page, {
          timeout: TIMEOUTS.medium,
        });

        if (shippingInput) {
          clicked = await this.safeClickWithLabelFallback(shippingInput, {
            timeout: TIMEOUTS.short,
          });
        }
      }

      if (!clicked) {
        const radio = this.page.locator('input[type="radio"][name*="shippingMethod"], input.shipping-method-selector').first();
        if (await radio.isVisible({ timeout: 1500 }).catch(() => false)) {
          await radio.click({ force: true }).catch(async () => {
            await radio.evaluate((el: HTMLElement) => el.click()).catch(swallowOptional('shipping method radio JS click fallback'));
          });
          clicked = true;
        } else {
          const label = this.page.locator('label[for*="shippingMethod"], label:has(input[type="radio"])').first();
          if (await label.isVisible({ timeout: 1500 }).catch(() => false)) {
            await label.click({ force: true }).catch(async () => {
              await label.evaluate((el: HTMLElement) => el.click()).catch(swallowOptional('shipping method label JS click fallback'));
            });
            clicked = true;
          }
        }
      }
    }

    if (clicked) {
      scopedLogger.success('Shipping method selected');
      scopedLogger.step('📝 Waiting for address form to load');

      await this.firstNameInput
        .waitFor({ state: 'attached', timeout: TIMEOUTS.element })
        .catch(() => scopedLogger.info('Address form already visible'));
    } else {
      scopedLogger.warn('No shipping method found');
    }

    return clicked;
  }
}
