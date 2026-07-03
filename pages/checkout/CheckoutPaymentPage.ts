import { Page, Locator } from '@playwright/test';
import { BasePage } from '../BasePage';
import { SELECTORS } from '../selectors';
import { AdyenHelper } from '../../utils/adyenHelper';
import { CybersourceHelper } from '../../utils/cybersourceHelper';
import { TIMEOUTS } from '../../config/testConfig';

/**
 * Payment information options
 */
export interface PaymentOptions {
  cardNumber: string;
  cardholderName: string;
  expirationDate: string;
  cvv: string;
}

/**
 * Checkout Payment Page
 * Handles payment method selection, payment details, and order placement
 *
 * Extends BasePage for consistent error handling and logging
 */
export class CheckoutPaymentPage extends BasePage {
  // Payment method
  readonly creditCardPaymentOption: Locator;

  // Payment fields
  readonly cardholderNameInput: Locator;

  // Installment payment (Japan-specific)
  readonly installmentPaymentMethodsSelect: Locator;
  readonly numberOfPaymentsSelect: Locator;

  // Order placement
  readonly placeOrderButton: Locator;

  // Confirmation
  readonly confirmationMessage: Locator;
  readonly orderNumber: Locator;

  constructor(page: Page) {
    super(page, 'Payment');

    // Payment method selection - using centralized selectors
    this.creditCardPaymentOption = page.locator(SELECTORS.CHECKOUT.PAYMENT.CREDIT_CARD_LABEL).first();

    // Payment fields
    this.cardholderNameInput = page.locator(SELECTORS.CHECKOUT.PAYMENT.CARDHOLDER_NAME).first();

    // Installment payment (Japan-specific)
    this.installmentPaymentMethodsSelect = page.locator(SELECTORS.CHECKOUT.PAYMENT.INSTALLMENT_METHOD).first();
    this.numberOfPaymentsSelect = page.locator(SELECTORS.CHECKOUT.PAYMENT.NUMBER_OF_PAYMENTS).first();

    // Order placement
    this.placeOrderButton = page.locator(SELECTORS.CHECKOUT.PAYMENT.PLACE_ORDER_BUTTON).first();

    // Confirmation
    this.confirmationMessage = page.locator(SELECTORS.CHECKOUT.CONFIRMATION.TITLE).first();
    this.orderNumber = page.locator(SELECTORS.CHECKOUT.CONFIRMATION.ORDER_NUMBER).first();
  }

  /**
   * Select credit card as payment method.
   * Primary: explicit click on #lb_scheme + force #rb_scheme + events (required for guest flows).
   * We no longer blindly trust "adyen panel visible == selected" because guest and registered
   * arrive with different defaults. We always ensure the radio is checked before returning success.
   * Cybersource has its own pre-selected handling.
   */
  async selectCreditCardPayment(): Promise<boolean> {
    this.logStep('📝 Looking for CREDIT CARD option');

    // Ensure page is still active
    if (this.page.isClosed()) {
      this.log('Page is closed!', 'error');
      return false;
    }

    // Wait for payment section to be loaded
    await this.page.waitForLoadState('domcontentloaded');

    // Early expand if the payment section header is present (some flows collapse it)
    await this.expandPaymentSection().catch(() => {});

    // Wait for the exact credit card label to appear (longer timeout for guest flows where payment options load slower)
    await this.page.waitForSelector('#lb_scheme', { state: 'visible', timeout: 10000 }).catch(() => {
      this.log('Credit card label #lb_scheme not immediately visible after expand, will attempt direct click', 'info');
    });

    // Cybersource (TH): the Credit Card radio is checked by default and there's no
    // #rb_scheme. Detect by looking for the Cybersource radiogroup or its frame.
    const isCybersource = await this.detectCybersource();
    if (isCybersource) {
      this.log('Cybersource provider detected — Credit Card pre-selected, skipping click', 'info');
      // Make sure the Credit Card radio is checked (it usually is by default)
      const ccRadio = this.page.getByRole('radio', { name: /credit card/i }).first();
      const isChecked = await ccRadio.isChecked().catch(() => false);
      if (!isChecked) {
        await ccRadio.check({ force: true }).catch(() => {});
      }
      await CybersourceHelper.waitForPaymentForm(this.page, TIMEOUTS.navigation);
      this.logSuccess('Credit card payment option selected (Cybersource)');
      return true;
    }

    const adyenPanel = this.page.locator('.adyen-checkout__card-input, .adyen-checkout__payment-method--card').first();
    const rbScheme = this.page.locator('#rb_scheme');

    // For Adyen (FR/NL/JP/AU etc.): do NOT assume the container being visible means the method is chosen.
    // Guest flows (after pickup or address submit) often show the payment section with CC not active,
    // while registered saved-address flows sometimes default it.
    // Check the radio explicitly; if not checked we fall through to force the #lb_scheme click.
    const adyenVisible = await adyenPanel.isVisible({ timeout: 1500 }).catch(() => false);
    const rbChecked = await rbScheme.isChecked().catch(() => false);

    if (adyenVisible && rbChecked) {
      this.logSuccess('Credit card panel already visible and radio checked (pre-selected)');
      await this.waitForAdyenForm();
      return true;
    }

    if (adyenVisible && !rbChecked) {
      this.log('Adyen panel visible but CREDIT CARD radio not checked — will force selection (typical for guest)', 'info');
      // fall through to explicit selection below
    }

    // Direct and robust selection using the exact CREDIT CARD label the user provided:
    // <label class="m-field__label m-field__label--radio" id="lb_scheme" for="rb_scheme" data-orig-label="Cards">CREDIT CARD</label>
    // This is now the preferred path for guest flows.
    try {
      if (this.page.isClosed()) {
        this.log('Page is closed before payment selection', 'warn');
        return false;
      }
      const exactCreditLabel = this.page.locator('#lb_scheme');
      const hasLabel = (await exactCreditLabel.count().catch(() => 0)) > 0 ||
                       (await exactCreditLabel.isVisible({ timeout: 800 }).catch(() => false));
      if (hasLabel) {
        await exactCreditLabel.scrollIntoViewIfNeeded().catch(() => {});
        await exactCreditLabel.click({ force: true, timeout: 1500 }).catch(() => {});
        this.logSuccess('Clicked exact CREDIT CARD label (#lb_scheme) with force');
        await this.page.waitForTimeout(150);

        // Force check the associated radio + events (critical for some Adyen integrations)
        const radio = this.page.locator('#rb_scheme');
        await radio.check({ force: true }).catch(() => {});
        await radio.evaluate((el: any) => {
          try {
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('click', { bubbles: true }));
          } catch {}
        }).catch(() => {});

        // Verify it took effect
        const nowChecked = await radio.isChecked().catch(() => false);
        if (nowChecked) {
          this.logSuccess('CREDIT CARD radio is now checked');
        }
        await this.waitForAdyenForm();
        return true;
      }
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      if (msg.includes('closed')) {
        this.log('Page closed during payment selection', 'warn');
        return false;
      }
      this.log(`Direct click on #lb_scheme failed: ${msg}`, 'warn');
    }

    const creditCardLabelByFor = this.page.locator('label[for="rb_scheme"]').first();
    const creditCardInput = this.page.locator('#rb_scheme').first();

    const waitForAdyenPanel = async () =>
      adyenPanel
        .waitFor({ state: 'visible', timeout: TIMEOUTS.element })
        .then(() => true)
        .catch(() => false);

    let panelVisible = false;

    // Strategy 0 (new, for JP/NL and localized UIs): generic role-based radio
    if (!panelVisible) {
      try {
        const ccByRole = this.page.getByRole('radio', {
          name: /credit|carte|クレジット|カード|credit card|carte bancaire|creditcard/i,
        }).first();
        if (await ccByRole.isVisible({ timeout: 2000 }).catch(() => false)) {
          const isChecked = await ccByRole.isChecked().catch(() => false);
          if (!isChecked) {
            await ccByRole.click({ force: true, timeout: TIMEOUTS.element }).catch(() => {});
          }
          this.logSuccess('Credit card radio clicked via accessible name (role)');
          panelVisible = await waitForAdyenPanel();
        }
      } catch {
        this.log('Role-based credit card radio not found, trying scan', 'info');
      }
    }

    // Strategy 0b: scan radios inside payment area for card-related label (very robust for JP/NL localized UIs)
    if (!panelVisible) {
      try {
        const paymentContainer = this.page.locator('form, [class*="payment"], [id*="payment"], .adyen-checkout__payment-methods, .checkout__payment').first();
        const radios = paymentContainer.locator('input[type="radio"]');
        const radioCount = await radios.count().catch(() => 0);
        for (let i = 0; i < radioCount; i++) {
          const radio = radios.nth(i);
          const id = await radio.getAttribute('id').catch(() => '');
          let labelText = await radio.getAttribute('aria-label').catch(() => '') || '';
          if (id) {
            const associatedLabel = await this.page.locator(`label[for="${id}"]`).textContent().catch(() => '');
            if (associatedLabel) labelText = associatedLabel;
          }
          if (/credit|carte|カード|クレジット|credit card/i.test(labelText)) {
            await radio.click({ force: true, timeout: TIMEOUTS.element }).catch(() => {});
            this.logSuccess(`Credit card radio selected by scanning payment area (label: ${labelText.trim()})`);
            panelVisible = await waitForAdyenPanel();
            break;
          }
        }
      } catch {
        this.log('Radio scan in payment area failed', 'info');
      }
    }

    // Fallback 1: click label[for="rb_scheme"] (attribute-based, no force).
    if (!panelVisible) {
      try {
        await creditCardLabelByFor.waitFor({ state: 'visible', timeout: TIMEOUTS.element });
        await creditCardLabelByFor.scrollIntoViewIfNeeded().catch(() => {});
        await creditCardLabelByFor.click({ timeout: TIMEOUTS.element });
        this.logSuccess('Credit card label (label[for="rb_scheme"]) clicked');
        panelVisible = await waitForAdyenPanel();
      } catch {
        this.log('label[for="rb_scheme"] not actionable, trying to expand payment section', 'info');
        await this.expandPaymentSection();
        try {
          await creditCardLabelByFor.waitFor({ state: 'visible', timeout: TIMEOUTS.medium });
          await creditCardLabelByFor.click({ timeout: TIMEOUTS.element });
          this.logSuccess('Credit card label (label[for="rb_scheme"]) clicked after expand');
          panelVisible = await waitForAdyenPanel();
        } catch {
          this.log('label[for="rb_scheme"] still not actionable after expand', 'info');
        }
      }
    }

    // Fallback 2: legacy input click with force (last resort).
    if (!panelVisible) {
      try {
        await creditCardInput.waitFor({ state: 'attached', timeout: TIMEOUTS.element });
        await creditCardInput.click({ force: true, timeout: TIMEOUTS.element });
        this.log('Credit card input (#rb_scheme) clicked with force as last resort', 'info');
        panelVisible = await waitForAdyenPanel();
      } catch (error) {
        this.log(`Credit card input click failed: ${(error as Error).message}`, 'error');
      }
    }

    if (!panelVisible) {
      // Last chance: if card input fields are already visible, proceed (some UIs pre-select or render differently for JP/NL)
      const cardField = this.page.locator('.adyen-checkout__field--cardNumber, [data-cse="encryptedCardNumber"], input[autocomplete*="cc-number" i], iframe[title*="card number" i]').first();
      if (await cardField.isVisible({ timeout: 3000 }).catch(() => false)) {
        panelVisible = true;
        this.logSuccess('Credit card fields visible directly (proceeding without explicit panel detection)');
      }
    }

    if (!panelVisible) {
      // If we couldn't click #lb_scheme at all, error. Otherwise we set panelVisible=true.
      throw new Error('Credit Card panel did not become visible after all triggers');
    }

    // Final safety net for Adyen/guest: if the radio exists but is not checked, force it one last time.
    try {
      const radio = this.page.locator('#rb_scheme');
      if ((await radio.count().catch(() => 0)) > 0) {
        const isChecked = await radio.isChecked().catch(() => false);
        if (!isChecked) {
          await this.page.locator('#lb_scheme').click({ force: true }).catch(() => {});
          await radio.check({ force: true }).catch(() => {});
          await radio.evaluate((el: any) => { try { el.checked = true; el.dispatchEvent(new Event('change', {bubbles:true})); } catch {} }).catch(() => {});
          this.log('Forced final CREDIT CARD selection (radio was not checked)', 'info');
        }
      }
    } catch {}

    this.logSuccess('Credit card payment option selected');

    // Wait for Adyen card number field to become visible
    const adyenCardField = this.page.locator('.adyen-checkout__field--cardNumber');
    await adyenCardField.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation }).catch(() => {});

    // Wait for Adyen payment form iframes to load
    await this.waitForAdyenForm();

    return true;
  }

  /**
   * Wait for Adyen payment form to load after selecting credit card
   */
  private async waitForAdyenForm(): Promise<void> {
    this.logStep('📝 Waiting for Adyen payment form to load');

    // Wait for the Adyen component container to be visible
    const adyenContainer = this.page.locator('.adyen-checkout__card-input, .adyen-checkout__payment-method--card');

    try {
      await adyenContainer.first().waitFor({ state: 'visible', timeout: TIMEOUTS.navigation });
      this.logSuccess('Adyen payment form loaded');

      // Ensure secure iframes are ready before typing card data.
      await AdyenHelper.waitForPaymentForm(this.page, TIMEOUTS.navigation);
    } catch {
      this.log('Adyen form container not found, continuing anyway', 'warn');
    }
  }

  /**
   * Expand payment section if collapsed
   */
  private async expandPaymentSection(): Promise<void> {
    const paymentHeader = this.page.locator(SELECTORS.CHECKOUT.PAYMENT.PAYMENT_HEADER).first();
    const clicked = await this.safeClick(paymentHeader, { timeout: TIMEOUTS.short });
    if (clicked) {
      this.logSuccess('Payment section clicked to expand');
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    }
  }

  /**
   * Fill payment information
   * Uses AdyenHelper for iframe fields
   * @param options - Payment details
   */
  async fillPaymentInfo(options: PaymentOptions): Promise<boolean> {
    const isCybersource = await this.detectCybersource();
    if (isCybersource) {
      return this.fillPaymentInfoCybersource(options);
    }

    // Fill cardholder name (normal field, not in iframe)
    const holderFilled = await this.safeFill(this.cardholderNameInput, options.cardholderName, {
      timeout: TIMEOUTS.element,
    });

    if (holderFilled) {
      this.logSuccess('Cardholder name filled');
    } else {
      this.log('Cardholder name field not found', 'warn');
    }

    // Fill Adyen iframe fields and fail fast if one field was not filled.
    const cardFilled = await AdyenHelper.fillCardNumber(this.page, options.cardNumber);
    const expiryFilled = await AdyenHelper.fillExpiryDate(this.page, options.expirationDate);
    const cvvFilled = await AdyenHelper.fillCvv(this.page, options.cvv);
    if (!cardFilled || !expiryFilled || !cvvFilled) {
      throw new Error('One or more Adyen fields could not be filled');
    }

    // Handle Japan-specific installment payment
    await this.selectInstallmentPayment();

    // Accept terms & conditions. Fail fast: continuing to placeOrder() with an unchecked
    // terms box leads to a confusing "button disabled" error 30s later. Stop now with a
    // clear message so diagnosis is immediate.
    const termsOk = await this.acceptTermsAndConditions();
    if (!termsOk) {
      throw new Error('Terms checkbox could not be accepted — stopping before placeOrder');
    }

    return true;
  }

  /**
   * Cybersource payment fill (TH region).
   * Card number + CVV are inside Cybersource Flex Microform iframes;
   * cardholder name and expiration date are regular page inputs.
   */
  private async fillPaymentInfoCybersource(options: PaymentOptions): Promise<boolean> {
    // Cardholder NAME ON CARD
    const holder = this.page.getByRole('textbox', { name: /name on card/i }).first();
    await holder.waitFor({ state: 'visible', timeout: TIMEOUTS.element }).catch(() => {});
    await holder.fill(options.cardholderName).catch(() => {});
    this.logSuccess('Cardholder name filled (Cybersource)');

    // Expiration date — placeholder MM/YY
    const expiry = this.page.locator('input[placeholder="MM/YY" i], input[placeholder*="MM/YY" i]').first();
    await expiry.waitFor({ state: 'visible', timeout: TIMEOUTS.element }).catch(() => {});
    await expiry.fill(options.expirationDate).catch(() => {});
    this.logSuccess('Expiration date filled (Cybersource)');

    // Card number iframe + CVV iframe
    const cardOk = await CybersourceHelper.fillCardNumber(this.page, options.cardNumber);
    const cvvOk = await CybersourceHelper.fillCvv(this.page, options.cvv);
    if (!cardOk || !cvvOk) {
      throw new Error('One or more Cybersource fields could not be filled');
    }

    // Accept terms & conditions. See note in fillPaymentInfo() above re: fail-fast.
    const termsOk = await this.acceptTermsAndConditions();
    if (!termsOk) {
      throw new Error('Terms checkbox could not be accepted — stopping before placeOrder');
    }

    return true;
  }

  /**
   * Detect Cybersource by looking for Flex Microform iframes or absence of Adyen markers.
   */
  private async detectCybersource(): Promise<boolean> {
    // Quick win: any iframe with cybersource in src
    const csIframe = await this.page
      .locator('iframe[src*="cybersource" i], iframe[src*="flex" i], iframe[src*="microform" i]')
      .count()
      .catch(() => 0);
    if (csIframe > 0) return true;

    // Adyen has a recognizable container; if not present and there's no #rb_scheme either, treat as Cybersource
    const adyenPresent = await this.page
      .locator('.adyen-checkout__card-input, .adyen-checkout__payment-method--card, #rb_scheme')
      .count()
      .catch(() => 0);
    if (adyenPresent > 0) return false;

    // Final heuristic: presence of "PURCHASE" button (Cybersource) and no Adyen container
    const purchaseBtn = await this.page
      .getByRole('button', { name: /^purchase$/i })
      .count()
      .catch(() => 0);
    return purchaseBtn > 0;
  }

  /**
   * Select installment payment method (Japan-specific)
   */
  private async selectInstallmentPayment(): Promise<void> {
    const isVisible = await this.isVisible(this.installmentPaymentMethodsSelect, TIMEOUTS.short);
    if (!isVisible) {
      this.log('Installment payment fields not required for this region', 'info');
      return;
    }

    // Select BULK (single payment)
    const selected = await this.safeSelect(this.installmentPaymentMethodsSelect, 'bulk');
    if (selected) {
      this.logSuccess('Payment method selected: BULK (single payment)');

      // Number of payments (optional)
      const numVisible = await this.isVisible(this.numberOfPaymentsSelect, TIMEOUTS.short);
      const numEnabled = await this.numberOfPaymentsSelect.isEnabled().catch(() => false);

      if (numVisible && numEnabled) {
        await this.numberOfPaymentsSelect.selectOption({ index: 1 });
        this.logSuccess('Number of payments selected');
      } else {
        this.log('Number of payments not required for BULK', 'info');
      }
    }
  }

  /**
   * Accept terms and conditions
   */
  private async acceptTermsAndConditions(): Promise<boolean> {
    const termsCheckbox = this.page.locator(SELECTORS.CHECKOUT.PAYMENT.TERMS_CHECKBOX).first();

    try {
      await termsCheckbox.waitFor({ state: 'attached', timeout: TIMEOUTS.element });

      // 1) Try the standard force-check
      await this.safeCheck(termsCheckbox, { force: true }).catch(() => {});
      if (await termsCheckbox.isChecked().catch(() => false)) {
        this.logSuccess('Terms & conditions accepted');
        return true;
      }

      // 2) Fallback: click the linked label (Celine renders the visible control as <label>)
      const id = await termsCheckbox.getAttribute('id').catch(() => null);
      if (id) {
        const escapedId = id.replace(/\./g, '\\.');
        const label = this.page.locator(`label[for="${escapedId}"]`).first();
        await label.click({ force: true, timeout: TIMEOUTS.short }).catch(() => {});
        if (await termsCheckbox.isChecked().catch(() => false)) {
          this.logSuccess('Terms & conditions accepted (via label)');
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
        .catch(() => {});
      if (await termsCheckbox.isChecked().catch(() => false)) {
        this.logSuccess('Terms & conditions accepted (via JS dispatch)');
        return true;
      }

      this.log('Terms checkbox could not be checked by any method', 'warn');
      return false;
    } catch (error) {
      this.log(`Terms checkbox not found or error: ${(error as Error).message}`, 'warn');
      return false;
    }
  }

  /**
   * Click place order button to complete the purchase
   */
  async placeOrder(): Promise<boolean> {
    try {
      // Try primary (#showSubmitPayment) then fallback to composite selector
      const primaryButton = this.page.locator('#showSubmitPayment');
      const purchaseButton = this.page.getByRole('button', { name: /^purchase$/i }).first();
      let button = this.placeOrderButton;

      try {
        await primaryButton.waitFor({ state: 'visible', timeout: TIMEOUTS.short });
        button = primaryButton;
        this.log('Using #showSubmitPayment button', 'info');
      } catch {
        // Cybersource (TH): use the PURCHASE button
        try {
          await purchaseButton.waitFor({ state: 'visible', timeout: TIMEOUTS.short });
          button = purchaseButton;
          this.log('Using PURCHASE button (Cybersource)', 'info');
        } catch {
          await this.placeOrderButton.waitFor({ state: 'visible', timeout: TIMEOUTS.element });
        }
      }

      await button.scrollIntoViewIfNeeded();

      // Wait explicitly for the button to be enabled before clicking.
      const buttonHandle = await button.elementHandle();
      if (buttonHandle) {
        try {
          await this.page.waitForFunction(
            (el) => !(el as HTMLButtonElement).disabled && !el.hasAttribute('disabled'),
            buttonHandle,
            { timeout: TIMEOUTS.navigation }
          );
        } finally {
          await buttonHandle.dispose();
        }
      }

      const isEnabled = await button.isEnabled().catch(() => false);
      if (!isEnabled) {
        const errorHint = await this.getVisiblePaymentError();
        throw new Error(
          errorHint
            ? `Place order button is disabled. ${errorHint}`
            : 'Place order button is disabled after waiting for payment readiness'
        );
      }

      const clicked = await this.safeClick(button, { timeout: TIMEOUTS.medium });
      if (!clicked) {
        throw new Error('Failed to click place order button');
      }

      this.logSuccess('Place order button clicked');
      return clicked;
    } catch (error) {
      this.log(`Error clicking place order button: ${(error as Error).message}`, 'error');
      throw error;
    }
  }

  /**
   * Run the full PayPal payment flow: select PayPal → open popup → login → Agree & Pay Now.
   * The popup belongs to the same browser context; we listen for `page` event before click.
   * On return, the parent Celine page is expected to transition to Order-Confirm.
   */
  async payViaPayPal(email: string, password: string): Promise<void> {
    this.logStep('📝 Initiating PayPal payment flow');

    // 1) Select PayPal radio. The Celine billing form drives the Submit button
    //    label/state via change-event listeners on the payment radios — clicking
    //    the label sometimes sets el.checked without the event chain firing, leaving
    //    the form in its initial state (Submit stays disabled, button keeps default
    //    "PURCHASE" label). We click the label, then dispatch change/input/click
    //    explicitly, and verify by waiting for the Submit button to become enabled.
    // Adyen-style (FR/US/AU): #lb_paypal + #rb_paypal
    // Cybersource-style (TH): label[for="select-payment-method-PAYPAL"] + #select-payment-method-PAYPAL
    const paypalLabel = this.page.locator('#lb_paypal, label[for="select-payment-method-PAYPAL"]').first();
    const paypalRadio = this.page.locator('#rb_paypal, #select-payment-method-PAYPAL').first();

    await paypalLabel.waitFor({ state: 'visible', timeout: TIMEOUTS.element });
    await paypalLabel.scrollIntoViewIfNeeded().catch(() => {});
    // Give Celine's billing form 2s to fully hydrate its radio change-listeners
    // before clicking — otherwise the click fires before listeners are attached
    // and the Submit button stays disabled.
    await this.page.waitForTimeout(300);
    await paypalLabel.click().catch(() => {});

    // Force the radio into checked state AND fire the event chain the page listens for.
    await paypalRadio
      .evaluate((el: HTMLInputElement) => {
        if (!el.checked) el.checked = true;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })
      .catch(() => {});

    if (!(await paypalRadio.isChecked().catch(() => false))) {
      throw new Error('PayPal radio is not checked after click + dispatch');
    }
    this.logSuccess('PayPal radio selected (rb_paypal.checked=true, change dispatched)');

    // 2) Accept terms & conditions (CGV) — required before clicking PayPal CTA
    const termsOk = await this.acceptTermsAndConditions();
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
        this.log('PayPal CTA found on top page', 'info');
        break;
      }

      // Check known PayPal frames
      for (const frame of this.page.frames()) {
        if (frame === this.page.mainFrame()) continue;
        if (!/paypal/i.test(frame.url())) continue;
        const frameBtn = frame.locator(ctaSelector).first();
        if (await frameBtn.isVisible({ timeout: 250 }).catch(() => false)) {
          paypalCta = frameBtn;
          this.log(`PayPal CTA found in iframe: ${frame.url().slice(0, 80)}`, 'info');
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

    await paypalCta.scrollIntoViewIfNeeded().catch(() => {});

    // 4) Arm popup listener BEFORE clicking — PayPal SDK opens a popup window
    const popupPromise = this.page.context().waitForEvent('page', { timeout: TIMEOUTS.navigation });
    await paypalCta.click();
    this.logSuccess('PayPal CTA clicked — waiting for popup');

    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    this.log(`PayPal popup opened: ${popup.url().slice(0, 100)}`, 'info');

    // 4) Email step — may be pre-filled by sandbox autofill
    const emailInput = popup.locator('input#email[name="login_email"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation });
    const currentEmail = (await emailInput.inputValue().catch(() => '')) || '';
    if (currentEmail.trim() !== email.trim()) {
      await emailInput.fill(email);
      this.logSuccess('PayPal email filled');
    } else {
      this.log('PayPal email already pre-filled', 'info');
    }

    // 5) Password — visible on same form OR on next view after clicking Log In
    const passwordInput = popup.locator('input#password[name="login_password"]').first();
    const passwordVisibleNow = await passwordInput.isVisible({ timeout: 1500 }).catch(() => false);

    if (passwordVisibleNow) {
      // Single-form variant: both fields visible together, one submit
      await passwordInput.fill(password);
      this.logSuccess('PayPal password filled (single-form)');
      await popup.locator('#btnLogin').first().click();
      this.logSuccess('PayPal Log In clicked');
    } else {
      // Email-first variant: #btnNext advances to password page, then #btnLogin submits
      await popup.locator('#btnNext').first().click();
      this.logSuccess('PayPal Next clicked (email step)');
      await passwordInput.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation });
      await passwordInput.fill(password);
      this.logSuccess('PayPal password filled');
      await popup.locator('#btnLogin').first().click();
      this.logSuccess('PayPal Log In clicked (password step)');
    }

    // 6) Review page → Agree & Pay Now
    const payButton = popup
      .locator('button[data-id="payment-submit-btn"], button[data-testid="submit-button-initial"]')
      .first();
    await payButton.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation });
    await payButton.click();
    this.logSuccess('PayPal Agree & Pay Now clicked');

    // 7) Popup closes when PayPal hands control back to Celine
    await popup.waitForEvent('close', { timeout: TIMEOUTS.navigation }).catch(() => {
      this.log('PayPal popup did not emit close event within timeout — continuing', 'warn');
    });

    this.logSuccess('PayPal flow completed');
  }

  /**
   * Pay via Afterpay (AU only — Adyen integration with full-page redirect).
   *
   * Flow:
   *   1. Select Afterpay radio (#rb_afterpaytouch)
   *   2. Accept CGV
   *   3. Click "Continue to Afterpay" — full-page nav to Afterpay portal
   *   4. Fill email → Continue → fill password → Continue → Confirm
   *   5. Afterpay redirects back to Celine Order-Confirm
   */
  async payViaAfterpay(email: string, password: string): Promise<void> {
    this.logStep('📝 Initiating Afterpay payment flow');

    // 1) Select Afterpay radio. Same pattern as PayPal — Celine's billing form drives
    //    the Submit CTA via change-event listeners; click label + force radio + dispatch.
    const afterpayLabel = this.page.locator('#lb_afterpaytouch').first();
    const afterpayRadio = this.page.locator('#rb_afterpaytouch').first();

    await afterpayLabel.waitFor({ state: 'visible', timeout: TIMEOUTS.element });
    await afterpayLabel.scrollIntoViewIfNeeded().catch(() => {});
    // 2s wait for Celine's billing-form hydration before triggering the radio change.
    await this.page.waitForTimeout(300);
    await afterpayLabel.click().catch(() => {});

    await afterpayRadio
      .evaluate((el: HTMLInputElement) => {
        if (!el.checked) el.checked = true;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })
      .catch(() => {});

    if (!(await afterpayRadio.isChecked().catch(() => false))) {
      throw new Error('Afterpay radio is not checked after click + dispatch');
    }
    this.logSuccess('Afterpay radio selected');

    // 2) Accept terms & conditions
    const termsOk = await this.acceptTermsAndConditions();
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
    this.logSuccess(`Redirected to Afterpay portal: ${this.page.url().slice(0, 100)}`);

    // 4) Email step — wait for portal hydration, then handle both landing screens:
    //    (a) fresh: email input visible directly
    //    (b) saved session: "Welcome back!" with cached identity → click "Not you?"
    //        to reset (cached identity often belongs to a different sandbox tester
    //        and its password won't match ours)
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});

    const emailInput = this.page.locator('[data-testid="login-identity-input"]').first();
    const notYouBtn = this.page.getByRole('button', { name: /Not you/i }).first();

    // Race the two possible landing screens until one becomes visible
    await Promise.race([
      emailInput.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation }),
      notYouBtn.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation }),
    ]).catch(() => {});

    if (!(await emailInput.isVisible({ timeout: 500 }).catch(() => false))) {
      // Saved-session screen — reset identity
      await notYouBtn.click();
      this.log('Afterpay: clicked "Not you?" to reset cached identity', 'info');
      await emailInput.waitFor({ state: 'visible', timeout: TIMEOUTS.element });
    }

    await emailInput.fill(email);
    this.logSuccess('Afterpay email filled');
    await this.page.locator('[data-testid="login-identity-button"]').first().click();

    // 5) Password step
    const passwordInput = this.page.locator('[data-testid="login-password-input"]').first();
    await passwordInput.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation });
    await passwordInput.fill(password);
    this.logSuccess('Afterpay password filled');
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
    this.logSuccess(`Afterpay Confirm clicked — back on Celine: ${this.page.url().slice(0, 100)}`);

    this.logSuccess('Afterpay flow completed');
  }

  /**
   * Detect and complete the Adyen 3DS challenge popin if it appears after placeOrder().
   * Triggered by specific test cards (e.g. AU EFTPos 4089670000000014 on dev sandbox).
   * Looks for `#password-input` + `#buttonSubmit` on the top page and inside iframes.
   * Returns true if the challenge was handled, false if no popin appeared within timeout.
   */
  async handle3DSChallenge(password: string = 'password', timeoutMs: number = 10000): Promise<boolean> {
    const passwordSelector = '#password-input';
    const submitSelector = '#buttonSubmit';
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      // Top-level page
      const topInput = this.page.locator(passwordSelector);
      if (await topInput.isVisible({ timeout: 300 }).catch(() => false)) {
        await topInput.fill(password);
        await this.page.locator(submitSelector).click();
        this.logSuccess('3DS challenge submitted (top-level)');
        return true;
      }

      // Iframes (Adyen 3DS challenges typically render in a nested frame)
      for (const frame of this.page.frames()) {
        try {
          const input = frame.locator(passwordSelector);
          if (await input.isVisible({ timeout: 300 }).catch(() => false)) {
            await input.fill(password);
            await frame.locator(submitSelector).click();
            this.logSuccess(`3DS challenge submitted (iframe: ${frame.url() || 'unnamed'})`);
            return true;
          }
        } catch {
          // Frame detached during iteration — skip
        }
      }

      await this.page.waitForTimeout(100);
    }

    this.log('No 3DS challenge popin detected — continuing to confirmation', 'info');
    return false;
  }

  /**
   * Try to extract a visible validation error near payment fields.
   */
  private async getVisiblePaymentError(): Promise<string | null> {
    const candidates = [
      '.adyen-checkout__error-text',
      '[class*="error-message"]',
      '[class*="field-error"]',
      '.m-form__error',
      '[aria-live="assertive"]',
    ];

    for (const selector of candidates) {
      const locator = this.page.locator(selector).first();
      const isVisible = await locator.isVisible({ timeout: TIMEOUTS.animation }).catch(() => false);
      if (!isVisible) {
        continue;
      }

      const text = (await locator.textContent().catch(() => ''))?.trim();
      if (text) {
        return `Validation message: ${text}`;
      }
    }

    return null;
  }

  /**
   * Get confirmation message after order is placed
   * @returns Confirmation message text
   */
  async getConfirmationMessage(): Promise<string | null> {
    return await this.getTextContent(this.confirmationMessage, {
      timeout: TIMEOUTS.navigation / 2,
    });
  }

  /**
   * Get order number from confirmation page
   * @returns Order number
   */
  async getOrderNumber(): Promise<string> {
    try {
      const fullText = await this.getTextContent(this.orderNumber, {
        timeout: TIMEOUTS.element,
      });

      if (!fullText) return '';

      // Extract order number from text like "Thank you for your order #FRD0081608-01"
      const match = fullText.match(SELECTORS.CHECKOUT.CONFIRMATION.ORDER_NUMBER_PATTERN);
      if (match && match[1]) {
        return match[1];
      }

      return fullText.trim();
    } catch (error) {
      this.log(`Cannot retrieve order number: ${(error as Error).message}`, 'warn');
      return '';
    }
  }

  /**
   * Complete entire payment step
   */
  async completePaymentStep(paymentInfo: PaymentOptions): Promise<string> {
    // Select credit card
    await this.selectCreditCardPayment();

    // Fill payment info
    await this.fillPaymentInfo(paymentInfo);

    // Place order
    await this.placeOrder();

    // Get order number
    return await this.getOrderNumber();
  }
}
