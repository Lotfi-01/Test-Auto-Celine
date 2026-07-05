import { Page, Locator } from '@playwright/test';
import { TIMEOUTS } from '../../../config/testConfig';
import { SELECTORS } from '../../selectors';
import { TestLogger } from '../../../utils/logger';

/**
 * Sprint 14 — extracted from `CheckoutPaymentPage.acceptTermsAndConditions`.
 * Behavior preserved 1:1: same selector, same 3-step fallback (safeCheck →
 * label click → JS dispatch), same throw-free contract (returns `false` on
 * any failure), same order of retries.
 *
 * The extracted handler does NOT import `CheckoutPaymentPage`. It receives
 * only a `Page` in the constructor and reimplements the tiny `safeCheck`
 * primitive locally (same pattern as `AddressFormFiller`, Sprint 7). No
 * cycle risk.
 *
 * Logs use `TestLogger.scoped('PaymentTerms')` — same message content as
 * the previous `[Payment]` logs, only the component prefix changes for
 * clarity (Sprint 4 pattern).
 *
 * PII policy: this file must NOT log `error.message`, `String(error)`,
 * `JSON.stringify(error)`, nor any option/value. Errors surface via
 * `error.name` only. The pre-Sprint-14 outer catch logged
 * `(error as Error).message` at `warn` — Sprint 14 replaces it with
 * `errorName(error)` (same shape as Sprint 6/7/8 helpers).
 */

const scopedLogger = TestLogger.scoped('PaymentTerms');

function errorName(err: unknown): string {
  return err instanceof Error && err.name ? err.name : 'UnknownError';
}

/**
 * Sprint 8-style fail-open catch handler adapted for PaymentTerms. Never
 * rethrows; logs at `debug` with a static technical label. Labels MUST
 * be string literals — never derived from options, values, tokens.
 */
function swallowOptional(label: string): (err: unknown) => void {
  return (err) => {
    scopedLogger.debug(`Optional payment terms step failed: ${label} (${errorName(err)})`);
  };
}

export class PaymentTermsHandler {
  constructor(private readonly page: Page) {}

  /**
   * Accept the Terms & Conditions checkbox on the Payment page.
   *
   * Three-strategy fallback (short-circuits on first success):
   *  1. `safeCheck` (`.check({ force: true })`) — direct check.
   *  2. Click the linked `<label for="…">` — Celine renders the visible
   *     control as a label, not the raw checkbox.
   *  3. Force `checked = true` via `evaluate` + dispatch `input`/`change`
   *     events — last-resort DOM manipulation.
   *
   * Returns `true` at the first successful `.isChecked()` observation;
   * `false` when all three strategies leave the checkbox unchecked, or
   * when an unexpected exception is caught by the outer `try/catch`. The
   * outer catch is fail-fast: it does NOT rethrow because the callers
   * (`fillPaymentInfo`, `payViaPayPal`, `payViaAfterpay`) treat a `false`
   * return as "throw a specific submit-blocking error".
   */
  async accept(): Promise<boolean> {
    const termsCheckbox = this.page.locator(SELECTORS.CHECKOUT.PAYMENT.TERMS_CHECKBOX).first();

    try {
      await termsCheckbox.waitFor({ state: 'attached', timeout: TIMEOUTS.element });

      // 1) Try the standard force-check
      await this.safeCheck(termsCheckbox, { force: true }).catch(
        swallowOptional('Terms checkbox force-check')
      );
      if (await termsCheckbox.isChecked().catch(() => false)) {
        scopedLogger.success('Terms & conditions accepted');
        return true;
      }

      // 2) Fallback: click the linked label (Celine renders the visible control as <label>)
      const id = await termsCheckbox.getAttribute('id').catch(() => null);
      if (id) {
        const escapedId = id.replace(/\./g, '\\.');
        const label = this.page.locator(`label[for="${escapedId}"]`).first();
        await label
          .click({ force: true, timeout: TIMEOUTS.short })
          .catch(swallowOptional('Terms label click fallback'));
        if (await termsCheckbox.isChecked().catch(() => false)) {
          scopedLogger.success('Terms & conditions accepted (via label)');
          return true;
        }
      }

      // 3) Last resort: set checked + dispatch change event in the DOM
      await termsCheckbox
        .evaluate((el) => {
          const input = el as HTMLInputElement;
          input.checked = true;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        })
        .catch(swallowOptional('Terms JS dispatch fallback'));
      if (await termsCheckbox.isChecked().catch(() => false)) {
        scopedLogger.success('Terms & conditions accepted (via JS dispatch)');
        return true;
      }

      scopedLogger.warn('Terms checkbox could not be checked by any method');
      return false;
    } catch (error) {
      // Sprint 14: previous log embedded `(error as Error).message` — replaced
      // with `errorName(error)` per Sprint 6/7/8 PII rule for new files.
      scopedLogger.warn(`Terms checkbox not found or error: ${errorName(error)}`);
      return false;
    }
  }

  /**
   * Local `safeCheck` — reimplements `BasePage.safeCheck` verbatim so this
   * file has no inheritance dependency on `BasePage`. Same short-circuit
   * on already-checked, same force option, same fail-open on exception.
   */
  private async safeCheck(
    locator: Locator,
    options: { timeout?: number; force?: boolean } = {}
  ): Promise<boolean> {
    const { timeout = TIMEOUTS.element, force = false } = options;
    try {
      const isChecked = await locator.isChecked().catch(() => false);
      if (!isChecked) {
        await locator.check({ timeout, force });
      }
      return true;
    } catch (err) {
      scopedLogger.warn(`Check failed: ${errorName(err)}`);
      return false;
    }
  }
}
