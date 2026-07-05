import type { Page, Locator } from '@playwright/test';
import { TIMEOUTS } from '../../../config/testConfig';
import { TestLogger } from '../../../utils/logger';
import { closeAllSidePanels } from '../../../utils/selectorStrategy';
import type { SafeClickOptions } from '../../BasePage';

/**
 * Sprint 23 — extracted from `CheckoutShippingPage.clickSubmitShipping`.
 * Behavior preserved 1:1: same `closeAllSidePanels` with `force: true`,
 * same `waitFor` attached (fail-open), same attached-count guard, same
 * scroll + `safeClick` with `force: true` → JS `evaluate` click
 * fallback, same `waitForLoadState('domcontentloaded')` with 1s cap,
 * same 3 return paths (`false` when not attached / `clicked` after
 * fallback / `false` on outer catch). Not coupled with
 * `completeShippingStep` or `continueToPayment`.
 *
 * Dependencies passed via constructor object:
 *  - `page: Page` — Playwright page.
 *  - `submitShippingButton: Locator` — the anchor button owned by the
 *    façade.
 *  - `safeClick: SafeClickFn` — bound to `BasePage.safeClick`.
 *
 * Primitives preserved 1:1 (delta net 0 tree-wide):
 *  - 2 `force: true` (one in `closeAllSidePanels` options, one in
 *    `safeClick` options).
 *  - 1 `evaluate()` (JS click fallback when `safeClick` returns false).
 *  - 0 `waitForTimeout`, 0 `waitForFunction`.
 *
 * PII policy (Sprint 23 hardening): the pre-Sprint-23 outer catch
 * emitted `` `Failed to click submit shipping: ${(e as Error).message}` ``
 * which surfaces raw Playwright errors (can carry selectors, URLs,
 * timeouts). Sprint 23 replaces `.message` with `errorName(e)` — the
 * catch behavior is identical (still returns `false`), only the log
 * string is PII-safe. `swallowOptional` uses `errorName` only.
 */

export type SafeClickFn = (
  locator: Locator,
  options?: SafeClickOptions
) => Promise<boolean>;

export interface ClickSubmitShippingDeps {
  page: Page;
  submitShippingButton: Locator;
  safeClick: SafeClickFn;
}

const scopedLogger = TestLogger.scoped('ClickSubmitShipping');

function errorName(err: unknown): string {
  return err instanceof Error && err.name ? err.name : 'UnknownError';
}

function swallowOptional(label: string): (err: unknown) => void {
  return (err) => {
    scopedLogger.debug(`Optional click-submit-shipping step failed: ${label} (${errorName(err)})`);
  };
}

export class ClickSubmitShippingHandler {
  private readonly page: Page;
  private readonly submitShippingButton: Locator;
  private readonly safeClick: SafeClickFn;

  constructor(deps: ClickSubmitShippingDeps) {
    this.page = deps.page;
    this.submitShippingButton = deps.submitShippingButton;
    this.safeClick = deps.safeClick;
  }

  /**
   * Click the main shipping submit button (used after registered
   * customer login when address is pre-filled). Preserved 1:1 from the
   * pre-Sprint-23 façade body.
   *
   * Public entry point — same contract as the previous façade method
   * (returns `Promise<boolean>`, 3 return paths, never throws — the
   * outer catch returns `false`).
   */
  async click(): Promise<boolean> {
    try {
      // Aggressively close any interfering side panels first (critical for registered flow)
      await closeAllSidePanels(this.page, { timeout: 50, force: true });

      // For registered prefilled, the button can be in DOM but reported hidden by visibility checks (CSS/overlay).
      // Wait attached first, then attempt force/JS click without strict visible requirement.
      await this.submitShippingButton
        .waitFor({ state: 'attached', timeout: TIMEOUTS.medium })
        .catch(swallowOptional('submitShippingButton waitFor attached'));

      const isAttached = await this.submitShippingButton
        .count()
        .then((c) => c > 0)
        .catch(() => false);
      if (!isAttached) {
        scopedLogger.warn('Submit shipping button not present');
        return false;
      }

      // Scroll + force/JS click path (preferred for prefilled registered case)
      await this.submitShippingButton
        .scrollIntoViewIfNeeded()
        .catch(swallowOptional('submitShippingButton scrollIntoView'));

      let clicked = await this.safeClick(this.submitShippingButton, { timeout: TIMEOUTS.short, force: true });

      if (!clicked) {
        await this.submitShippingButton
          .evaluate((el: HTMLElement) => (el as HTMLButtonElement).click())
          .catch(swallowOptional('submitShippingButton JS click fallback'));
        clicked = true;
      }

      if (clicked) {
        scopedLogger.success('Submit shipping button clicked (#submitShippingBtn)');
      }

      // Sprint 3: the previous `waitForTimeout(150)` was blind padding. The
      // real signal after a form submit is the document reaching
      // `domcontentloaded`. Timeout is bounded so a stuck submit still surfaces
      // via the caller's own next assertion, not a silent sleep.
      await this.page
        .waitForLoadState('domcontentloaded', { timeout: 1000 })
        .catch(swallowOptional('post submit-shipping DOM settle'));

      return clicked;
    } catch (e) {
      // Sprint 23 PII hardening: previous log embedded `.message` (raw
      // Playwright error can carry selectors / URLs / timeouts). Emit
      // only `error.name`.
      scopedLogger.warn(`Failed to click submit shipping: ${errorName(e)}`);
      return false;
    }
  }
}
