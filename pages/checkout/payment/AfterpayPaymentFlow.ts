import { Page } from '@playwright/test';
import { TIMEOUTS } from '../../../config/testConfig';
import { TestLogger } from '../../../utils/logger';

/**
 * Sprint 13 — extracted from `CheckoutPaymentPage.payViaAfterpay`. Behavior
 * preserved 1:1: same selectors, same event dispatch order, same
 * Adyen-CTA → portal navigation race, same landing-screen race, same
 * waitForTimeout values, same throw messages on unrecoverable states.
 *
 * The extracted flow does NOT import `CheckoutPaymentPage`. It receives a
 * minimal delegate callback for `acceptTermsAndConditions()` so the shared
 * Terms handling stays on the façade where the Cybersource/Adyen shared
 * logic lives (same pattern as `PayPalPaymentFlow`, Sprint 12).
 *
 * Logs use `TestLogger.scoped('Afterpay')` — the message content is
 * identical to the previous `[Payment]` logs, only the component prefix
 * changes for clarity.
 *
 * PII policy: this file must NOT log the raw `email`, `password`, or any
 * form-value derived from them. The pre-Sprint-13 flow logged neither
 * value — this contract is preserved.
 *
 * URL redaction (Sprint 13 security improvement, authorized by the sprint
 * prompt as a non-functional redaction): the pre-Sprint-13 flow logged
 * `this.page.url().slice(0, 100)` twice — a weak truncation that could
 * still expose Afterpay portal session tokens or Celine order-confirm
 * query params. Both call sites now go through `redactUrl(rawUrl)` which
 * parses the URL and emits only `origin + pathname` (never query,
 * never fragment). Behavior unchanged; only the LOG STRING is redacted.
 * Errors surface via `error.name` only — never `.message`, never
 * `String(error)`, never `JSON.stringify(error)`.
 */

/**
 * Delegate callback for the shared Terms & Conditions acceptance.
 * `CheckoutPaymentPage` owns the T&C handling because Cybersource and
 * Adyen share the same terms surface — extracting it would duplicate the
 * shared logic. Passing a callback keeps this file free of any Payment
 * façade dependency.
 */
export type AcceptTermsDelegate = () => Promise<boolean>;

const scopedLogger = TestLogger.scoped('Afterpay');

function errorName(err: unknown): string {
  return err instanceof Error && err.name ? err.name : 'UnknownError';
}

/**
 * Sprint 8-style fail-open catch handler adapted for Afterpay. Never
 * rethrows; logs at `debug` with a static technical label. Labels MUST
 * be string literals — never derived from `email`, `password`, portal
 * URLs, or PSP payloads.
 */
function swallowOptional(label: string): (err: unknown) => void {
  return (err) => {
    scopedLogger.debug(`Optional Afterpay step failed: ${label} (${errorName(err)})`);
  };
}

/**
 * Sprint 13 — non-functional URL redaction for log emissions.
 * Returns `origin + pathname` only; query params and fragments are
 * stripped so Afterpay portal session tokens and Celine
 * order-confirm identifiers never reach the log stream.
 *
 * Pure function — safe to unit-test in isolation.
 */
export function redactUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '<invalid-url>';
  }
}

export class AfterpayPaymentFlow {
  constructor(
    private readonly page: Page,
    private readonly acceptTerms: AcceptTermsDelegate
  ) {}

  /**
   * Pay via Afterpay (AU only — Adyen integration with full-page redirect).
   *
   * Flow:
   *   1. Select Afterpay radio (#rb_afterpaytouch)
   *   2. Accept CGV
   *   3. Click "Continue to Afterpay" — full-page nav to Afterpay portal
   *   4. Fill email → Continue → fill password → Continue → Confirm
   *   5. Afterpay redirects back to Celine Order-Confirm
   *
   * Public entry point — same contract as the previous
   * `CheckoutPaymentPage.payViaAfterpay`.
   */
  async pay(email: string, password: string): Promise<void> {
    scopedLogger.step('📝 Initiating Afterpay payment flow');

    // 1) Select Afterpay radio. Same pattern as PayPal — Celine's billing form drives
    //    the Submit CTA via change-event listeners; click label + force radio + dispatch.
    const afterpayLabel = this.page.locator('#lb_afterpaytouch').first();
    const afterpayRadio = this.page.locator('#rb_afterpaytouch').first();

    await afterpayLabel.waitFor({ state: 'visible', timeout: TIMEOUTS.element });
    await afterpayLabel
      .scrollIntoViewIfNeeded()
      .catch(swallowOptional('Afterpay label scrollIntoView'));
    // 2s wait for Celine's billing-form hydration before triggering the radio change.
    await this.page.waitForTimeout(300);
    await afterpayLabel.click().catch(swallowOptional('Afterpay label click'));

    await afterpayRadio
      .evaluate((el: HTMLInputElement) => {
        if (!el.checked) el.checked = true;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })
      .catch(swallowOptional('Afterpay radio dispatch'));

    if (!(await afterpayRadio.isChecked().catch(() => false))) {
      throw new Error('Afterpay radio is not checked after click + dispatch');
    }
    scopedLogger.success('Afterpay radio selected');

    // 2) Accept terms & conditions — delegated to
    //    `CheckoutPaymentPage.acceptTermsAndConditions` via the
    //    constructor-injected callback so the shared Terms surface stays
    //    on the façade.
    const termsOk = await this.acceptTerms();
    if (!termsOk) {
      throw new Error('Terms checkbox could not be accepted before Afterpay submit');
    }

    // 3) Click the Adyen "Continue to Afterpay" CTA — same-tab navigation to Afterpay portal
    const continueCta = this.page
      .locator('button.adyen-checkout__button--pay', { hasText: /Continue to Afterpay/i })
      .first();
    await continueCta.waitFor({ state: 'visible', timeout: TIMEOUTS.element });
    await Promise.all([
      this.page.waitForURL(/afterpay/i, { timeout: TIMEOUTS.navigation }),
      continueCta.click(),
    ]);
    scopedLogger.success(`Redirected to Afterpay portal: ${redactUrl(this.page.url())}`);

    // 4) Email step — wait for portal hydration, then handle both landing screens:
    //    (a) fresh: email input visible directly
    //    (b) saved session: "Welcome back!" with cached identity → click "Not you?"
    //        to reset (cached identity often belongs to a different sandbox tester
    //        and its password won't match ours)
    await this.page
      .waitForLoadState('domcontentloaded')
      .catch(swallowOptional('Afterpay portal DOM settle'));

    const emailInput = this.page.locator('[data-testid="login-identity-input"]').first();
    const notYouBtn = this.page.getByRole('button', { name: /Not you/i }).first();

    // Race the two possible landing screens until one becomes visible
    await Promise.race([
      emailInput.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation }),
      notYouBtn.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation }),
    ]).catch(swallowOptional('Afterpay landing screen race'));

    if (!(await emailInput.isVisible({ timeout: 500 }).catch(() => false))) {
      // Saved-session screen — reset identity
      await notYouBtn.click();
      scopedLogger.info('Afterpay: clicked "Not you?" to reset cached identity');
      await emailInput.waitFor({ state: 'visible', timeout: TIMEOUTS.element });
    }

    await emailInput.fill(email);
    scopedLogger.success('Afterpay email filled');
    await this.page.locator('[data-testid="login-identity-button"]').first().click();

    // 5) Password step
    const passwordInput = this.page.locator('[data-testid="login-password-input"]').first();
    await passwordInput.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation });
    await passwordInput.fill(password);
    scopedLogger.success('Afterpay password filled');
    await this.page.locator('[data-testid="login-password-button"]').first().click();

    // 6) Summary → Confirm — Afterpay redirects back to Celine Order-Confirm on success.
    //    We MUST wait for that redirect here, otherwise the test spec's permissive
    //    URL check (`!stage=payment`) returns true while still on portal.sandbox.afterpay.com,
    //    and the order-number regex matches stray UI text on the Afterpay page.
    const confirmCta = this.page.locator('[data-testid="summary-button"]').first();
    await confirmCta.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation });
    await Promise.all([
      this.page.waitForURL(/celine\.com.*Order-Confirm/i, { timeout: TIMEOUTS.navigation }),
      confirmCta.click(),
    ]);
    scopedLogger.success(`Afterpay Confirm clicked — back on Celine: ${redactUrl(this.page.url())}`);

    scopedLogger.success('Afterpay flow completed');
  }
}
