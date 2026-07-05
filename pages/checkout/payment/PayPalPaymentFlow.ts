import { Page, Locator } from '@playwright/test';
import { TIMEOUTS } from '../../../config/testConfig';
import { TestLogger } from '../../../utils/logger';

/**
 * Sprint 12 — extracted from `CheckoutPaymentPage.payViaPayPal`. Behavior
 * preserved 1:1: same selectors, same event dispatch order, same popup
 * arming/closing race, same waitForTimeout values, same throw messages
 * on unrecoverable states.
 *
 * The extracted flow does NOT import `CheckoutPaymentPage`. It receives a
 * minimal delegate callback for `acceptTermsAndConditions()` so the shared
 * Terms handling stays on the façade where the Cybersource/Adyen shared
 * logic lives.
 *
 * Logs use `TestLogger.scoped('PayPal')` — the message content is
 * identical to the previous `[Payment]` logs, only the component prefix
 * changes for clarity (same pattern as Sprint 4 for `PickupDialog`).
 *
 * PII policy: this file must NOT log the raw `email`, `password`, or any
 * form-value derived from them. The pre-Sprint-12 flow logged neither
 * value — this contract is preserved. URLs of the PayPal popup and
 * iframe are logged with a `.slice(0, N)` truncation matching the
 * pre-Sprint-12 behavior (potential PII in PayPal query params is
 * pre-existing behavior — Sprint 12 preserves 1:1 and Sprint 13 may
 * revisit). Errors surface via `error.name` only when a fail-open
 * catch fires — never `.message`, never `String(error)`, never
 * `JSON.stringify(error)`.
 */

/**
 * Delegate callback for the shared Terms & Conditions acceptance.
 * `CheckoutPaymentPage` owns the T&C handling because Cybersource and
 * Adyen share the same terms surface — extracting it would duplicate the
 * shared logic. Passing a callback keeps this file free of any Payment
 * façade dependency.
 */
export type AcceptTermsDelegate = () => Promise<boolean>;

const scopedLogger = TestLogger.scoped('PayPal');

function errorName(err: unknown): string {
  return err instanceof Error && err.name ? err.name : 'UnknownError';
}

/**
 * Sprint 8-style fail-open catch handler adapted for PayPal. Never
 * rethrows; logs at `debug` with a static technical label. Labels MUST
 * be string literals — never derived from `email`, `password`, popup
 * URLs, or PSP payloads.
 */
function swallowOptional(label: string): (err: unknown) => void {
  return (err) => {
    scopedLogger.debug(`Optional PayPal step failed: ${label} (${errorName(err)})`);
  };
}

export class PayPalPaymentFlow {
  constructor(
    private readonly page: Page,
    private readonly acceptTerms: AcceptTermsDelegate
  ) {}

  /**
   * Run the full PayPal payment flow: select PayPal → open popup → login
   * → Agree & Pay Now. The popup belongs to the same browser context;
   * we listen for `page` event before click. On return, the parent Celine
   * page is expected to transition to Order-Confirm.
   *
   * Public entry point — same contract as the previous
   * `CheckoutPaymentPage.payViaPayPal`.
   */
  async pay(email: string, password: string): Promise<void> {
    scopedLogger.step('📝 Initiating PayPal payment flow');

    // 1) Select PayPal radio. The Celine billing form drives the Submit button
    //    label/state via change-event listeners on the payment radios — clicking
    //    the label sometimes sets el.checked without the event chain firing, leaving
    //    the form in its initial state (Submit stays disabled, button keeps default
    //    "PURCHASE" label). We click the label, then dispatch change/input/click
    //    explicitly, and verify by waiting for the Submit button to become enabled.
    // Adyen-style (FR/US/AU): #lb_paypal + #rb_paypal
    // Cybersource-style (TH): label[for="select-payment-method-PAYPAL"] + #select-payment-method-PAYPAL
    const paypalLabel = this.page
      .locator('#lb_paypal, label[for="select-payment-method-PAYPAL"]')
      .first();
    const paypalRadio = this.page.locator('#rb_paypal, #select-payment-method-PAYPAL').first();

    await paypalLabel.waitFor({ state: 'visible', timeout: TIMEOUTS.element });
    await paypalLabel.scrollIntoViewIfNeeded().catch(swallowOptional('PayPal label scrollIntoView'));
    // Give Celine's billing form 2s to fully hydrate its radio change-listeners
    // before clicking — otherwise the click fires before listeners are attached
    // and the Submit button stays disabled.
    await this.page.waitForTimeout(300);
    await paypalLabel.click().catch(swallowOptional('PayPal label click'));

    // Force the radio into checked state AND fire the event chain the page listens for.
    await paypalRadio
      .evaluate((el: HTMLInputElement) => {
        if (!el.checked) el.checked = true;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })
      .catch(swallowOptional('PayPal radio dispatch'));

    if (!(await paypalRadio.isChecked().catch(() => false))) {
      throw new Error('PayPal radio is not checked after click + dispatch');
    }
    scopedLogger.success('PayPal radio selected (rb_paypal.checked=true, change dispatched)');

    // 2) Accept terms & conditions (CGV) — required before clicking PayPal CTA.
    //    Delegated to `CheckoutPaymentPage.acceptTermsAndConditions` via the
    //    constructor-injected callback so the shared Terms surface stays on
    //    the façade.
    const termsOk = await this.acceptTerms();
    if (!termsOk) {
      throw new Error('Terms checkbox could not be accepted before PayPal submit');
    }

    // 3) Locate the PayPal SDK "Pay with PayPal" CTA. PayPal Smart Buttons v7 render
    //    inside a cross-origin iframe, so poll the top frame and PayPal-origin frames.
    // Multiple PayPal SDK render variants observed on Celine:
    // - Adyen FR/US/AU: div.paypal-button-label-container (label container with SVG)
    // - Cybersource TH: img.paypal-button-logo[aria-label="paypal"] (raw logo image)
    // - Generic SDK markers: [data-funding-source="paypal"], paypal-button-row
    const ctaSelector =
      '[data-funding-source="paypal"], div.paypal-button-label-container, div[class*="paypal-button-row"], img.paypal-button-logo[aria-label="paypal"], [class*="paypal-button"][role="link"], [class*="paypal-button"][role="button"]';

    let paypalCta: Locator | null = null;
    const ctaDeadline = Date.now() + TIMEOUTS.navigation;

    // Improved polling: use short waits + break early. Avoids many tiny timeouts.
    while (Date.now() < ctaDeadline && !paypalCta) {
      // Try top level first
      const topBtn = this.page.locator(ctaSelector).first();
      if (await topBtn.isVisible({ timeout: 250 }).catch(() => false)) {
        paypalCta = topBtn;
        scopedLogger.info('PayPal CTA found on top page');
        break;
      }

      // Check known PayPal frames
      for (const frame of this.page.frames()) {
        if (frame === this.page.mainFrame()) continue;
        if (!/paypal/i.test(frame.url())) continue;
        const frameBtn = frame.locator(ctaSelector).first();
        if (await frameBtn.isVisible({ timeout: 250 }).catch(() => false)) {
          paypalCta = frameBtn;
          scopedLogger.info(`PayPal CTA found in iframe: ${frame.url().slice(0, 80)}`);
          break;
        }
      }

      if (!paypalCta) {
        await this.page.waitForTimeout(80);
      }
    }

    if (!paypalCta) {
      throw new Error('PayPal CTA not found on top page or any PayPal iframe within timeout');
    }

    await paypalCta.scrollIntoViewIfNeeded().catch(swallowOptional('PayPal CTA scrollIntoView'));

    // 4) Arm popup listener BEFORE clicking — PayPal SDK opens a popup window
    const popupPromise = this.page.context().waitForEvent('page', { timeout: TIMEOUTS.navigation });
    await paypalCta.click();
    scopedLogger.success('PayPal CTA clicked — waiting for popup');

    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    scopedLogger.info(`PayPal popup opened: ${popup.url().slice(0, 100)}`);

    // 4) Email step — may be pre-filled by sandbox autofill
    const emailInput = popup.locator('input#email[name="login_email"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation });
    const currentEmail = (await emailInput.inputValue().catch(() => '')) || '';
    if (currentEmail.trim() !== email.trim()) {
      await emailInput.fill(email);
      scopedLogger.success('PayPal email filled');
    } else {
      scopedLogger.info('PayPal email already pre-filled');
    }

    // 5) Password — visible on same form OR on next view after clicking Log In
    const passwordInput = popup.locator('input#password[name="login_password"]').first();
    const passwordVisibleNow = await passwordInput.isVisible({ timeout: 1500 }).catch(() => false);

    if (passwordVisibleNow) {
      // Single-form variant: both fields visible together, one submit
      await passwordInput.fill(password);
      scopedLogger.success('PayPal password filled (single-form)');
      await popup.locator('#btnLogin').first().click();
      scopedLogger.success('PayPal Log In clicked');
    } else {
      // Email-first variant: #btnNext advances to password page, then #btnLogin submits
      await popup.locator('#btnNext').first().click();
      scopedLogger.success('PayPal Next clicked (email step)');
      await passwordInput.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation });
      await passwordInput.fill(password);
      scopedLogger.success('PayPal password filled');
      await popup.locator('#btnLogin').first().click();
      scopedLogger.success('PayPal Log In clicked (password step)');
    }

    // 6) Review page → Agree & Pay Now
    const payButton = popup
      .locator('button[data-id="payment-submit-btn"], button[data-testid="submit-button-initial"]')
      .first();
    await payButton.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation });
    await payButton.click();
    scopedLogger.success('PayPal Agree & Pay Now clicked');

    // 7) Popup closes when PayPal hands control back to Celine
    await popup.waitForEvent('close', { timeout: TIMEOUTS.navigation }).catch((err) => {
      // Sprint 12: preserve the pre-existing warn-log semantics but log
      // `error.name` only (Sprint 8 PII rule for new files).
      scopedLogger.warn(
        `PayPal popup did not emit close event within timeout — continuing (${errorName(err)})`
      );
    });

    scopedLogger.success('PayPal flow completed');
  }
}
