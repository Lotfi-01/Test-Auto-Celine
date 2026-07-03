import { Page, Locator } from '@playwright/test';
import { BasePage } from '../BasePage';
import { SHIPPING_METHOD_STRATEGY } from '../../utils/selectorStrategy';
import { SELECTORS } from '../selectors';
import { TIMEOUTS } from '../../config/testConfig';
import { forceElementVisible, setNativeValue, forceCheckRadio } from '../../utils/formHelper';

/**
 * Shipping address options interface
 */
export interface ShippingAddressOptions {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state?: string;
  postalCode: string;
  phone: string;
  phonePrefix?: string;
  firstNameKatakana?: string;
  lastNameKatakana?: string;
}

/**
 * Checkout Shipping Page
 * Handles postal code, shipping address, and shipping method selection
 *
 * Extends BasePage for consistent error handling and logging
 */
export class CheckoutShippingPage extends BasePage {
  // Form fields
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly firstNameKatakanaInput: Locator;
  readonly lastNameKatakanaInput: Locator;
  readonly addressInput: Locator;
  readonly cityInput: Locator;
  readonly countrySelect: Locator;
  readonly prefectureSelect: Locator;
  readonly zipcodeAddressField: Locator;
  readonly phonePrefixSelect: Locator;
  readonly phoneInput: Locator;

  // Buttons
  readonly validateAddressButton: Locator;
  readonly continueToPaymentButton: Locator;
  readonly submitShippingButton: Locator;
  readonly shippingPanel: Locator;

  constructor(page: Page) {
    super(page, 'Shipping');

    // Address form fields - using centralized selectors
    this.firstNameInput = page.locator(SELECTORS.CHECKOUT.SHIPPING.FIRST_NAME).first();
    this.lastNameInput = page.locator(SELECTORS.CHECKOUT.SHIPPING.LAST_NAME).first();
    this.firstNameKatakanaInput = page.locator(SELECTORS.CHECKOUT.SHIPPING.FIRST_NAME_KATAKANA).first();
    this.lastNameKatakanaInput = page.locator(SELECTORS.CHECKOUT.SHIPPING.LAST_NAME_KATAKANA).first();
    this.addressInput = page.locator(SELECTORS.CHECKOUT.SHIPPING.ADDRESS).first();
    this.cityInput = page.locator(SELECTORS.CHECKOUT.SHIPPING.CITY).first();
    this.countrySelect = page.locator(SELECTORS.CHECKOUT.SHIPPING.COUNTRY).first();
    this.prefectureSelect = page.locator(SELECTORS.CHECKOUT.SHIPPING.PREFECTURE).first();
    this.zipcodeAddressField = page.locator(SELECTORS.CHECKOUT.SHIPPING.ZIPCODE_ADDRESS_FIELD).first();
    this.phonePrefixSelect = page.locator(SELECTORS.CHECKOUT.SHIPPING.PHONE_PREFIX).first();
    this.phoneInput = page.locator(SELECTORS.CHECKOUT.SHIPPING.PHONE).first();

    // Navigation buttons
    this.validateAddressButton = page.locator(SELECTORS.CHECKOUT.SHIPPING.VALIDATE_ADDRESS_BUTTON).first();
    this.continueToPaymentButton = page.locator(SELECTORS.CHECKOUT.SHIPPING.CONTINUE_BUTTON).first();
    this.submitShippingButton = page.locator(SELECTORS.CHECKOUT.SHIPPING.SUBMIT_SHIPPING_BUTTON).first();
    this.shippingPanel = page.locator('section[data-osidepanel-name="shippingBillingForms"]').first();
  }

  /**
   * Enter postal code to unlock shipping form
   * @param postalCode - Postal/ZIP code
   */
  async enterPostalCode(postalCode: string): Promise<boolean> {
    this.logStep('🔍 Looking for zipcode field');

    // Prioritize the exact US zip field the user specified
    const postalCodeInput = this.page.locator('#zipCodeForShippingMethods, input.shippingZipCode, input[name*="postalCode"]').first();

    // Wait for the zipcode field to appear and become visible
    // Note: isVisible() is an instant check (timeout param is deprecated in Playwright 1.33+),
    // so we must use waitFor() which properly waits for the element.
    try {
      await postalCodeInput.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation });
      this.log('Zipcode field found and visible');
    } catch {
      this.log('No initial zipcode field found - proceeding directly to form', 'info');
      return true;
    }

    // Fill postal code
    const filled = await this.safeFill(postalCodeInput, postalCode);
    if (!filled) return false;
    this.logSuccess(`Postal code filled: ${postalCode}`);

    // Minimal wait + tab to trigger validation on some sites (US zip unlock)
    await this.page.waitForTimeout(100);
    await postalCodeInput.press('Tab').catch(() => {});

    // Click OK button using multiple strategies
    const okClicked = await this.clickOkButton();
    if (okClicked) {
      this.logStep('📝 Waiting for shipping options to appear');
      await this.waitForNetworkIdle(TIMEOUTS.medium);
    }

    return true;
  }

  /**
   * Click OK button to validate postal code
   * Uses #submitZipCodeButton as primary, then generic button, link, and Enter fallbacks
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
        .catch(() => {});

      if (await this.safeClick(submitZipButton, { timeout: TIMEOUTS.short })) {
        await this.waitForNetworkIdle(TIMEOUTS.medium);
        this.logSuccess('OK button clicked (#submitZipCodeButton)');
        return true;
      }
    } catch {
      // Continue to fallbacks
    }

    // Fallback: generic button selector
    const okButton = this.page.locator(SELECTORS.CHECKOUT.SHIPPING.ZIPCODE_OK_BUTTON).first();
    if (await this.safeClick(okButton, { timeout: TIMEOUTS.short })) {
      await this.waitForNetworkIdle(TIMEOUTS.medium);
      this.logSuccess('OK button clicked (button)');
      return true;
    }

    // Fallback: link/span
    const okLink = this.page.locator(SELECTORS.CHECKOUT.SHIPPING.ZIPCODE_OK_LINK).first();
    if (await this.safeClick(okLink, { timeout: TIMEOUTS.short })) {
      await this.waitForDomContent();
      this.logSuccess('OK button clicked (link/span)');
      return true;
    }

    // Fallback: press Enter
    const postalCodeInput = this.page.locator(SELECTORS.CHECKOUT.SHIPPING.ZIPCODE_INPUT).first();
    try {
      await postalCodeInput.press('Enter');
      await this.waitForNetworkIdle(TIMEOUTS.medium);
      this.logSuccess('Enter key pressed to validate postal code');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Select title (Mr, Mrs, Ms)
   * @param title - Title to select
   */
  async selectTitle(title: 'Mr' | 'Mrs' | 'Ms' | 'M' | 'Mme' | 'Mlle' = 'Mr'): Promise<boolean> {
    // Scope to side panel if open (US after delivery method click)
    const isPanel = await this.shippingPanel.isVisible({ timeout: 1000 }).catch(() => false);
    const scope = isPanel ? this.shippingPanel : this.page;

    const success = await this._selectCivilityRobust(title, scope);
    if (success) {
      this.logSuccess(`Title selected: ${title}`);
    }
    return success;
  }

  /**
   * Robust civility (title) selection that works for both main shipping form
   * and the Click & Collect purchaser dialog.
   * Tries specific selectors first, then label text, then broad title radio search.
   */
  private async _selectCivilityRobust(title: string, scope: Locator | Page = this.page): Promise<boolean> {
    const inputMap: Record<string, string> = {
      Mr: SELECTORS.CHECKOUT.SHIPPING.TITLE_MR_INPUT,
      M: SELECTORS.CHECKOUT.SHIPPING.TITLE_MR_INPUT,
      Mrs: SELECTORS.CHECKOUT.SHIPPING.TITLE_MRS_INPUT,
      Mme: SELECTORS.CHECKOUT.SHIPPING.TITLE_MRS_INPUT,
      Ms: SELECTORS.CHECKOUT.SHIPPING.TITLE_MS_INPUT,
      Mlle: SELECTORS.CHECKOUT.SHIPPING.TITLE_MS_INPUT,
    };

    const labelMap: Record<string, string> = {
      Mr: SELECTORS.CHECKOUT.SHIPPING.TITLE_MR_LABEL,
      M: SELECTORS.CHECKOUT.SHIPPING.TITLE_MR_LABEL,
      Mrs: SELECTORS.CHECKOUT.SHIPPING.TITLE_MRS_LABEL,
      Mme: SELECTORS.CHECKOUT.SHIPPING.TITLE_MRS_LABEL,
      Ms: SELECTORS.CHECKOUT.SHIPPING.TITLE_MS_LABEL,
      Mlle: SELECTORS.CHECKOUT.SHIPPING.TITLE_MS_LABEL,
    };

    const inputSelector = inputMap[title];
    const labelSelector = labelMap[title];

    // Strategy 1: Specific selectors (works for standard shipping form and sometimes in dialog)
    if (inputSelector && labelSelector) {
      const input = scope.locator(inputSelector).first();
      let clicked = await this.safeClick(input, { timeout: TIMEOUTS.short, force: true }).catch(() => false);
      if (!clicked) {
        const label = scope.locator(labelSelector).first();
        clicked = await this.safeClick(label, { timeout: TIMEOUTS.medium }).catch(() => false);
      }
      if (!clicked) {
        try {
          await forceCheckRadio(input);
          clicked = true;
        } catch {}
      }
      if (clicked) return true;
    }

    // Strategy 2: Label text match (case-insensitive, handles "MR.", "Mr", "M." etc.)
    const titleAcceptable = (() => {
      const t = title.toLowerCase();
      const variants: Record<string, string[]> = {
        mr: ['mr', 'm', 'mr.'],
        m: ['m', 'mr', 'mr.'],
        mrs: ['mrs', 'mme', 'mrs.'],
        mme: ['mme', 'mrs', 'mrs.'],
        ms: ['ms', 'mlle', 'miss', 'ms.'],
        mlle: ['mlle', 'ms', 'miss', 'ms.'],
      };
      return variants[t] || ['mr', 'm', 'mrs', 'mme', 'ms', 'mlle'];
    })();

    for (const token of titleAcceptable) {
      // Try inside scope first
      const byLabel = scope.locator(`label:has-text("${token}"), label[for*="${token}"]`).first();
      if (await byLabel.isVisible({ timeout: 400 }).catch(() => false)) {
        const forAttr = (await byLabel.getAttribute('for').catch(() => '')) || '';
        const input = scope.locator(`input#${forAttr.replace(/"/g, '\\"')}, input[type="radio"]`).first();
        try {
          await forceCheckRadio(input);
          return true;
        } catch {}
      }
    }

    // Strategy 3: Robust broad search for any title radio (original reliable logic)
    // Search for radios that look like title/civility (by name, id, or nearby label)
    try {
      const result = await this.page.evaluate(
        ({ acceptable }: { acceptable: string[] }) => {
          const isVisible = (el: HTMLElement) => {
            const cs = window.getComputedStyle(el);
            return cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetParent !== null;
          };

          const radios = Array.from(document.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
          const titleRadios = radios.filter((r) => /title/i.test(r.name) || /title/i.test(r.id) || /civility/i.test(r.name) || /civility/i.test(r.id));

          const visibleRadios = titleRadios.filter(isVisible);
          const candidates = visibleRadios.length ? visibleRadios : titleRadios;

          const norm = (s: string) => s.toLowerCase().replace(/\./g, '').trim();

          const findRadio = (token: string) =>
            candidates.find((r) => {
              const labelText = (r.labels && r.labels[0]?.textContent) || r.getAttribute('aria-label') || r.value || '';
              return norm(labelText).includes(norm(token)) || norm(token).includes(norm(labelText));
            });

          let target: HTMLInputElement | undefined;
          for (const tok of acceptable) {
            target = findRadio(tok);
            if (target) break;
          }
          if (!target) target = candidates[0]; // last resort: first title-like radio

          if (!target) return { ok: false };

          // Use forceCheckRadio logic inline for reliability
          const proto = Object.getPrototypeOf(target);
          const setter = Object.getOwnPropertyDescriptor(proto, 'checked')?.set;
          if (setter) setter.call(target, true);
          else target.checked = true;

          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          const label = target.labels?.[0];
          if (label) label.click();
          target.click();

          return { ok: target.checked, matched: (target.labels?.[0]?.textContent || '').trim() };
        },
        { acceptable: titleAcceptable }
      ).catch(() => ({ ok: false }));

      if (result.ok) {
        return true;
      }
    } catch (e) {
      this.log(`Broad title radio search failed: ${(e as Error).message}`, 'warn');
    }

    return false;
  }

  /**
   * Fill shipping address form
   * @param options - Address details
   */
  async fillShippingAddress(options: ShippingAddressOptions): Promise<boolean> {
    this.logStep('📝 Waiting for address form to open');

    // Ensure form is visible
    const formReady = await this.ensureFormVisible();
    if (!formReady) {
      this.log('Cannot open address form', 'error');
      return false;
    }

    this.logSuccess('Address form opened');
    this.logStep('Filling address form');

    // Scope to side panel if open (for US after clicking delivery method label)
    const isPanel = await this.shippingPanel.isVisible({ timeout: 1000 }).catch(() => false);
    const scope = isPanel ? this.shippingPanel : this.page;

    const firstNameInput = scope.locator(SELECTORS.CHECKOUT.SHIPPING.FIRST_NAME).first();
    const lastNameInput = scope.locator(SELECTORS.CHECKOUT.SHIPPING.LAST_NAME).first();
    const addressInput = scope.locator(SELECTORS.CHECKOUT.SHIPPING.ADDRESS).first();
    const cityInput = scope.locator(SELECTORS.CHECKOUT.SHIPPING.CITY).first();
    const zipcodeAddressField = scope.locator(SELECTORS.CHECKOUT.SHIPPING.ZIPCODE_ADDRESS_FIELD).first();
    const phoneInput = scope.locator(SELECTORS.CHECKOUT.SHIPPING.PHONE).first();
    const firstNameKatakanaInput = scope.locator(SELECTORS.CHECKOUT.SHIPPING.FIRST_NAME_KATAKANA).first();
    const lastNameKatakanaInput = scope.locator(SELECTORS.CHECKOUT.SHIPPING.LAST_NAME_KATAKANA).first();

    // Fill required fields SEQUENTIALLY to avoid race conditions
    const firstNameOk = await this.fillField(firstNameInput, options.firstName, 'First name');
    const lastNameOk = await this.fillField(lastNameInput, options.lastName, 'Last name');
    const addressOk = await this.fillField(addressInput, options.address, 'Address');

    // City: only fill if empty (may be pre-filled by postcode lookup)
    let cityOk = true;
    const cityValue = await cityInput.inputValue().catch(() => '');
    if (!cityValue.trim()) {
      cityOk = await this.fillField(cityInput, options.city, 'City');
    } else {
      this.logSuccess(`City already pre-filled: ${cityValue}`);
    }

    // State/Prefecture (AU, US)
    if (options.state) {
      await this.selectStateOrPrefecture(options.state);
    }

    // Zipcode in address form (AU - may differ from lookup zipcode)
    await this.fillOptionalField(zipcodeAddressField, options.postalCode, 'Postal code (address)');

    // Phone prefix (AU)
    if (options.phonePrefix) {
      await this.selectPhonePrefix(options.phonePrefix);
    }

    const phoneOk = await this.fillField(phoneInput, options.phone, 'Phone');

    // Fill optional katakana fields (Japan-specific)
    if (options.firstNameKatakana) {
      await this.fillOptionalField(firstNameKatakanaInput, options.firstNameKatakana, 'First name katakana');
    }
    if (options.lastNameKatakana) {
      await this.fillOptionalField(lastNameKatakanaInput, options.lastNameKatakana, 'Last name katakana');
    }

    this.logSuccess('Address form completed');
    return firstNameOk && lastNameOk && addressOk && cityOk && phoneOk;
  }

  /**
   * Fill a required field with logging
   * Includes explicit focus and small delay to prevent race conditions
   */
  private async fillField(locator: Locator, value: string, fieldName: string): Promise<boolean> {
    try {
      // Wait for field to be visible
      await locator.waitFor({ state: 'visible', timeout: TIMEOUTS.element });

      // Scroll into view if needed
      await locator.scrollIntoViewIfNeeded().catch(() => {});

      // Explicit focus before filling
      await locator.focus();

      // Small delay to ensure focus is set - workaround for browser input races
      await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.focusDelay));

      // Clear existing value
      await locator.clear();

      // Fill with value
      await locator.fill(value);

      // Verify the value was set correctly
      const actualValue = await locator.inputValue();
      if (actualValue !== value) {
        this.log(`${fieldName} verification failed: expected "${value}", got "${actualValue}"`, 'warn');
        return false;
      }

      // Small delay after fill to ensure browser processes input - workaround for input race conditions
      await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.inputDelay));

      this.logSuccess(`${fieldName} filled`);
      return true;
    } catch (error) {
      this.log(`Error filling ${fieldName}: ${(error as Error).message}`, 'warn');
      return false;
    }
  }

  /**
   * Fill an optional field (only if visible)
   */
  private async fillOptionalField(locator: Locator, value: string, fieldName: string): Promise<void> {
    const isVisible = await this.isVisible(locator, TIMEOUTS.short);
    if (isVisible) {
      const filled = await this.safeFill(locator, value);
      if (filled) {
        this.logSuccess(`${fieldName} filled`);
      }
    } else {
      this.log(`${fieldName} field not required for this region`, 'info');
    }
  }

  /**
   * Ensure the address form is visible
   */
  private async ensureFormVisible(): Promise<boolean> {
    try {
      await this.firstNameInput.waitFor({ state: 'attached', timeout: TIMEOUTS.navigation / 2 });

      const isVisible = await this.isVisible(this.firstNameInput);
      if (!isVisible) {
        this.log('Field found but hidden, forcing visibility...', 'info');
        await forceElementVisible(this.firstNameInput);
        this.logSuccess('Address form visibility forced');
      }

      return true;
    } catch {
      // Try to click toggle to open form
      return await this.tryOpenFormToggle();
    }
  }

  /**
   * Try to open the form by clicking a toggle
   */
  private async tryOpenFormToggle(): Promise<boolean> {
    this.log('Form did not open, trying to click on shipping section...', 'warn');

    const toggle = this.page
      .locator('[data-toggle*="collapse"][href*="shipping"], button[aria-controls*="shipping"]')
      .first();
    const clicked = await this.safeClick(toggle, { timeout: TIMEOUTS.short });

    if (clicked) {
      try {
        await this.firstNameInput.waitFor({ state: 'attached', timeout: TIMEOUTS.medium });
        this.logSuccess('Address form opened after clicking toggle');
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Select country from dropdown
   * @param countryCode - Country code (e.g., 'FR', 'US', 'JP')
   */
  async selectCountry(countryCode: string): Promise<boolean> {
    const selected = await this.safeSelect(this.countrySelect, countryCode, {
      timeout: TIMEOUTS.short,
    });

    if (selected) {
      await this.waitForDomContent();
      this.logSuccess(`Country selected: ${countryCode}`);
    }

    return selected;
  }

  /**
   * Select state/prefecture from dropdown (US and Japan-specific)
   * Selects the first non-empty option available
   */
  async selectStateOrPrefecture(value?: string): Promise<boolean> {
    const isVisible = await this.isVisible(this.prefectureSelect, TIMEOUTS.short);
    if (!isVisible) {
      this.log('State/Prefecture dropdown not visible - skipping', 'info');
      return false;
    }

    // Use provided value or fall back to first non-empty option
    const optionValue =
      value ??
      (await this.prefectureSelect.evaluate((select: HTMLSelectElement) => {
        const option = Array.from(select.options).find((o) => o.value && o.value.trim() !== '');
        return option ? option.value : null;
      }));

    if (!optionValue) {
      this.log('No valid state/prefecture option found', 'warn');
      return false;
    }

    const selected = await this.safeSelect(this.prefectureSelect, optionValue, {
      timeout: TIMEOUTS.short,
    });

    if (selected) {
      this.logSuccess(`State/Prefecture selected: ${optionValue}`);
    }

    return selected;
  }

  /**
   * Click submit address button to validate address
   */
  async continueToShipping(): Promise<void> {
    try {
      await this.validateAddressButton.waitFor({ state: 'attached', timeout: TIMEOUTS.element });

      // Scroll to button
      await this.validateAddressButton.evaluate((el) => {
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
      });

      // Wait for button to be enabled
      const isEnabled = await this.validateAddressButton.isEnabled();
      if (!isEnabled) {
        this.log('Submit address button disabled, waiting...', 'warn');
        await this.page
          .waitForFunction(
            (btn) => !(btn as HTMLButtonElement).disabled,
            await this.validateAddressButton.elementHandle(),
            { timeout: TIMEOUTS.medium }
          )
          .catch(() => this.log('Button still disabled, attempting click...', 'warn'));
      }

      // Click button — try Playwright click first, then JS click + form.requestSubmit()
      // as a fallback. JP standard delivery's SUBMIT ADDRESS sometimes needs the form
      // submit event explicitly fired (the JS click handler doesn't always trigger).
      const clicked = await this.safeClick(this.validateAddressButton, { timeout: TIMEOUTS.short });
      if (!clicked) {
        await this.validateAddressButton.evaluate((el: HTMLElement) => el.click());
      }
      this.logSuccess('Submit address button clicked');

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
        .catch(() => {});

      // Wait for actual transition — URL change OR continue-to-payment button.
      // Use the navigation timeout (30s) not formSubmit (3s) — JP server-side validation
      // of the address can take 10-15s before the page transitions.
      // NOTE: do NOT race against networkIdle here. Pages have continuous GTM/analytics
      // polling that resolves quickly but does NOT mean the form has been processed.
      await Promise.race([
        this.page.waitForURL(/payment|paiement/, { timeout: TIMEOUTS.navigation }),
        this.continueToPaymentButton.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation }),
      ]).catch(() => {
        this.log('Address submit did not transition to payment within navigation timeout', 'warn');
      });
    } catch (error) {
      this.log(`Error validating address: ${(error as Error).message}`, 'error');
      throw error;
    }
  }

  /**
   * Fill the Click & Collect "PURCHASER INFORMATION" dialog and submit.
   * The C&C form opens as a dialog/modal with different DOM IDs than the standard
   * shipping form, so we use accessible role/name selectors scoped to the dialog.
   */
  async fillPickupAddressForm(options: {
    title: 'Mr' | 'Mrs' | 'Ms' | 'M' | 'Mme' | 'Mlle';
    firstName: string;
    lastName: string;
    firstNameKatakana?: string;
    lastNameKatakana?: string;
    address: string;
    city: string;
    state?: string;
    postalCode: string;
    phonePrefix?: string;
    phone: string;
  }): Promise<boolean> {
    this.logStep('📝 Filling Pick-up address form');

    const dialog = await this.getPurchaserDialog();
    if (!dialog) return false;

    // STATE FIRST — state selection can wipe other fields and reset title
    if (options.state) {
      await this.selectStateInDialog(options.state, dialog);
    }

    await this.selectCivilityInDialog(options.title, dialog);

    // Postcode early (may trigger re-renders/autocomplete)
    const postcodeLocator = dialog
      .locator('input[id*="postal" i], input[id*="zip" i], input[name*="postal" i], input[name*="zip" i]')
      .first();
    try {
      if (await postcodeLocator.isVisible({ timeout: 800 }).catch(() => false)) {
        await setNativeValue(postcodeLocator, options.postalCode);
        this.logSuccess(`Postcode set via native helper: "${options.postalCode}"`);
      }
    } catch (e) {
      this.log(`Postcode set failed: ${(e as Error).message}`, 'warn');
    }
    await this.page.waitForTimeout(60);

    await this.fillPickupTextFields(options, dialog);
    await this.fillKatakanaFields(options, dialog);
    await this.fillPhoneFields(options, dialog);

    await this.ensureFieldsBeforeSubmit(options, dialog);

    return await this.submitPickupDialog(dialog);
  }

  /**
   * Click & Collect: switch to PICK-UP IN STORE tab — the pickup panel auto-shows
   * nearby stores (no postcode entry required), select the first one, then wait
   * for the purchaser-info dialog to open.
   * Replaces enterPostalCode + selectFirstShippingMethod when deliveryMode === 'pickup'.
   */
  async selectClickAndCollect(): Promise<boolean> {
    this.logStep('📝 Selecting PICK-UP IN STORE (Click & Collect)');

    // 1) Click the PICK-UP IN STORE tab — :visible filters out hidden duplicates that
    //    may exist in cart sidebar or other includes (FR/US/JP/AU all share this pattern).
    // More robust locator for PICK-UP tab (NL sandbox can render slightly differently)
    const pickupTab = this.page.locator(
      'button[aria-controls*="pick_up"][role="tab"]:visible, ' +
      'button[aria-controls*="pick_up"]:visible, ' +
      'button:has-text("PICK-UP"):visible, ' +
      'button:has-text("Click & Collect"):visible, ' +
      '[role="tab"]:has-text("PICK"):visible'
    ).first();
    try {
      await pickupTab.waitFor({ state: 'visible', timeout: TIMEOUTS.element });
      await pickupTab.scrollIntoViewIfNeeded().catch(() => {});
      // Move mouse to the button and click via the page.mouse API (most "trusted" interaction)
      const box = await pickupTab.boundingBox();
      if (box) {
        await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await this.page.waitForTimeout(50);
        await pickupTab.click({ timeout: TIMEOUTS.medium });
      } else {
        await pickupTab.click({ timeout: TIMEOUTS.medium });
      }
      this.logSuccess('PICK-UP IN STORE tab clicked');
    } catch (err) {
      // Fallback for cases where tab is not visible (e.g. already selected, registered saved, or UI variation)
      this.log('PICK-UP tab not visible, checking if pickup form is already open...', 'warn');
      const pickupPanel = this.page.locator('section[data-osidepanel-name*="click"], [id*="pickup"], form:has(input[name*="firstNamePickup"])').first();
      if (await pickupPanel.isVisible({ timeout: 3000 }).catch(() => false)) {
        this.logSuccess('Pickup form/panel already visible, proceeding without tab click');
      } else {
        // Last resort: try to find and click any pickup related button or label to open the form
        this.log('Trying last resort click for pickup option...', 'warn');
        const anyPickup = this.page.locator('button:has-text("PICK"), button:has-text("Click & Collect"), label:has-text("PICK-UP"), [data-delivery*="pickup"]').first();
        if (await anyPickup.isVisible({ timeout: 2000 }).catch(() => false)) {
          await anyPickup.click({ force: true }).catch(() => {});
          await this.page.waitForTimeout(500);
          this.logSuccess('Clicked alternative pickup element');
        } else {
          // Ultimate fallback: use JS to find and click any element with pickup text
          this.log('Ultimate JS fallback for pickup...', 'warn');
          await this.page.evaluate(() => {
            const els = Array.from(document.querySelectorAll('button, label, a, div[role="tab"]'));
            const match = els.find(el => /pick.?up|click.?&.?collect/i.test(el.textContent || ''));
            if (match) (match as HTMLElement).click();
          }).catch(() => {});
          await this.page.waitForTimeout(1000);
          // Check again
          if (!(await pickupPanel.isVisible({ timeout: 2000 }).catch(() => false))) {
            throw new Error(`PICK-UP tab click failed: ${(err as Error).message}`);
          }
          this.logSuccess('Pickup opened via JS fallback');
        }
      }
    }

    // Verify the tab actually became selected. If not, fall back to dispatching a click event in JS.
    const isSelected = async () =>
      this.page.evaluate(() => {
        const tab = document.querySelector('button[aria-controls="panel_pick_up"]');
        return !!tab && tab.getAttribute('aria-selected') === 'true';
      });

    try {
      await this.page.waitForFunction(
        () => document.querySelector('button[aria-controls="panel_pick_up"]')?.getAttribute('aria-selected') === 'true',
        undefined,
        { timeout: TIMEOUTS.short }
      );
      this.logSuccess('PICK-UP IN STORE tab is now selected');
    } catch {
      this.log('Tab still not selected — retrying via direct DOM click + event dispatch', 'warn');
      await this.page
        .evaluate(() => {
          const tab = document.querySelector('button[aria-controls="panel_pick_up"]') as HTMLButtonElement | null;
          if (!tab) return;
          tab.click();
          tab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        })
        .catch(() => {});
      await this.page.waitForTimeout(100);
      const ok = await isSelected();
      if (ok) {
        this.logSuccess('PICK-UP tab selected after JS click fallback');
      } else {
        this.log('PICK-UP tab still not selected after fallback', 'warn');
      }
    }

    // 2) The pickup panel auto-shows nearby stores (no postcode entry required).
    //    Wait for the first store label to appear in the list.
    const firstStoreLabel = this.page.locator('label[for^="r_address"]').first();
    try {
      await firstStoreLabel.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation });
    } catch {
      throw new Error('PICK-UP store list never appeared');
    }

    const storeId = await firstStoreLabel.getAttribute('for').catch(() => null);
    await firstStoreLabel.scrollIntoViewIfNeeded().catch(() => {});

    // Try Playwright click first (natural trusted event)
    await firstStoreLabel.click({ timeout: TIMEOUTS.short }).catch(() => {});

    // Verify the linked radio is now checked; if not, force-click via JS (Celine handler is finicky)
    const isStoreChecked = async () =>
      storeId
        ? this.page.evaluate((id) => {
            const input = document.getElementById(id) as HTMLInputElement | null;
            return !!input && input.checked;
          }, storeId)
        : Promise.resolve(true);

    if (!(await isStoreChecked())) {
      this.log('Store radio not checked after Playwright click — using JS click fallback', 'warn');
      await this.page
        .evaluate((id) => {
          if (!id) return;
          const label = document.querySelector(`label[for="${id}"]`) as HTMLLabelElement | null;
          const input = document.getElementById(id) as HTMLInputElement | null;
          if (label) label.click();
          if (input && !input.checked) {
            input.checked = true;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.click();
          }
        }, storeId)
        .catch(() => {});
    }

    if (await isStoreChecked()) {
      this.logSuccess(`Store selected (${storeId})`);
    } else {
      throw new Error(`Store ${storeId} could not be selected (radio never became checked)`);
    }

    // 5) Wait for the purchaser-info dialog to appear.
    // Language-agnostic: scope by structural identifiers, not localized heading text.
    const dialog = this.page
      .locator('[role="dialog"]:visible')
      .filter({
        has: this.page.locator('input[id*="firstName" i], input[name*="firstName" i], input[id="billingPhoneNumber"]'),
      })
      .first();
    try {
      await dialog.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation });
    } catch {
      this.log('Purchaser-info dialog did not open after store selection', 'warn');
    }

    return true;
  }

  /**
   * Select first available shipping method
   * Uses name-based selector as primary (avoids dynamic IDs), then falls back to strategy
   */
  async selectFirstShippingMethod(): Promise<boolean> {
    this.logStep('📝 Selecting shipping method');

    // Click the shipping method label as specified by user to open the form.
    // Example: label.shipping-method-option with for="shippingMethod-Standard-..."
    const shippingLabel = this.page.locator('label.shipping-method-option').first();
    let clicked = false;

    try {
      await shippingLabel.waitFor({ state: 'visible', timeout: TIMEOUTS.medium });
      await shippingLabel.click({ timeout: TIMEOUTS.short });
      clicked = true;
      this.logSuccess('Shipping method label clicked (opened form)');
    } catch (e) {
      this.log(`Failed to click shipping label: ${e}`, 'warn');
      // Fallbacks
      const shippingByName = this.page.locator(SELECTORS.CHECKOUT.SHIPPING.SHIPPING_METHOD_BY_NAME).first();
      try {
        await shippingByName.waitFor({ state: 'attached', timeout: TIMEOUTS.short });
        clicked = await this.safeClickWithLabelFallback(shippingByName, {
          timeout: TIMEOUTS.short,
        });
      } catch {}

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
            await radio.evaluate((el: HTMLElement) => el.click()).catch(() => {});
          });
          clicked = true;
        } else {
          const label = this.page.locator('label[for*="shippingMethod"], label:has(input[type="radio"])').first();
          if (await label.isVisible({ timeout: 1500 }).catch(() => false)) {
            await label.click({ force: true }).catch(async () => {
              await label.evaluate((el: HTMLElement) => el.click()).catch(() => {});
            });
            clicked = true;
          }
        }
      }
    }

    if (clicked) {
      this.logSuccess('Shipping method selected');
      this.logStep('📝 Waiting for address form to load');

      await this.firstNameInput
        .waitFor({ state: 'attached', timeout: TIMEOUTS.element })
        .catch(() => this.log('Address form already visible', 'info'));
    } else {
      this.log('No shipping method found', 'warn');
    }

    return clicked;
  }

  /**
   * Select phone prefix from dropdown (AU-specific)
   * @param prefix - Phone prefix (e.g., '+61')
   */
  async selectPhonePrefix(prefix: string): Promise<boolean> {
    const isVisible = await this.isVisible(this.phonePrefixSelect, TIMEOUTS.short);
    if (!isVisible) {
      this.log('Phone prefix dropdown not visible - skipping', 'info');
      return false;
    }

    const selected = await this.safeSelect(this.phonePrefixSelect, prefix, {
      timeout: TIMEOUTS.short,
    });

    if (selected) {
      this.logSuccess(`Phone prefix selected: ${prefix}`);
    }

    return selected;
  }

  /**
   * Click continue to payment button
   * Note: After address validation, the page may auto-navigate to payment
   */
  async continueToPayment(): Promise<boolean> {
    await this.page.waitForLoadState('domcontentloaded');

    // Close any remaining panels before attempting to move to payment.
    // Exclude shippingBillingForms (we may have just submitted it) and be conservative on payment page.
    const { closeAllSidePanels } = await import('../../utils/selectorStrategy');
    await closeAllSidePanels(this.page, { timeout: 50, force: true, exclude: ['shippingBillingForms'] });

    // Wait up to navigation timeout for the URL to change. The address submit can take
    // 10-15s on slow regions (JP) before the URL flips to /payment.
    await this.page.waitForURL(/payment|paiement/, { timeout: TIMEOUTS.navigation }).catch(() => {});

    // 1) URL on payment? Done.
    const currentUrl = this.page.url();
    if (currentUrl.includes('payment') || currentUrl.includes('paiement')) {
      this.logSuccess('Already on payment section (URL-based check)');
      return true;
    }

    // 2) Click the explicit Continue-to-payment button if it's visible.
    const buttonVisible = await this.isVisible(this.continueToPaymentButton, TIMEOUTS.short);
    if (buttonVisible) {
      const clicked = await this.safeClick(this.continueToPaymentButton, { timeout: TIMEOUTS.short });
      if (clicked) {
        this.logSuccess('Continued to payment (clicked button)');
        await this.page.waitForURL(/payment|paiement/, { timeout: TIMEOUTS.navigation }).catch(() => {});
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
      this.logSuccess('Already on payment section (visible DOM marker check)');
      return true;
    }

    // 4) Stuck — surface a clear error so the failure mode is obvious.
    const finalUrl = this.page.url();
    throw new Error(`Failed to reach payment step — still at ${finalUrl}`);
  }

  /**
   * Complete entire shipping step
   */
  async completeShippingStep(
    postalCode: string,
    title: 'Mr' | 'Mrs' | 'Ms' | 'M' | 'Mme' | 'Mlle',
    address: ShippingAddressOptions,
    countryCode: string
  ): Promise<boolean> {
    // Enter postal code
    await this.enterPostalCode(postalCode);

    // Select shipping method
    await this.selectFirstShippingMethod();

    // Select title (civility) before filling address
    await this.selectTitle(title);

    // Fill address form
    const addressFilled = await this.fillShippingAddress(address);
    if (!addressFilled) {
      this.log('Failed to fill address form', 'error');
      return false;
    }

    // Select country
    await this.selectCountry(countryCode);

    // Submit address
    await this.continueToShipping();

    return true;
  }

  /**
   * Click the main shipping submit button (used after registered customer login
   * when address is pre-filled).
   */
  async clickSubmitShipping(): Promise<boolean> {
    try {
      // Aggressively close any interfering side panels first (critical for registered flow)
      const { closeAllSidePanels } = await import('../../utils/selectorStrategy');
      await closeAllSidePanels(this.page, { timeout: 50, force: true });

      // For registered prefilled, the button can be in DOM but reported hidden by visibility checks (CSS/overlay).
      // Wait attached first, then attempt force/JS click without strict visible requirement.
      await this.submitShippingButton.waitFor({ state: 'attached', timeout: TIMEOUTS.medium }).catch(() => {});

      const isAttached = await this.submitShippingButton.count().then(c => c > 0).catch(() => false);
      if (!isAttached) {
        this.log('Submit shipping button not present', 'warn');
        return false;
      }

      // Scroll + force/JS click path (preferred for prefilled registered case)
      await this.submitShippingButton.scrollIntoViewIfNeeded().catch(() => {});

      let clicked = await this.safeClick(this.submitShippingButton, { timeout: TIMEOUTS.short, force: true });

      if (!clicked) {
        await this.submitShippingButton.evaluate((el: HTMLElement) => (el as HTMLButtonElement).click()).catch(() => {});
        clicked = true;
      }

      if (clicked) {
        this.logSuccess('Submit shipping button clicked (#submitShippingBtn)');
      }

      // Give time for any async address verification or panel to process
      await this.page.waitForTimeout(150);

      return clicked;
    } catch (e) {
      this.log(`Failed to click submit shipping: ${(e as Error).message}`, 'warn');
      return false;
    }
  }

  /**
   * Internal helper to submit the pickup purchaser dialog.
   * Extracted for readability and easier maintenance.
   */
  private async submitPickupDialog(dialog: Locator): Promise<boolean> {
    const submitLocalized = dialog
      .getByRole('button', {
        name: /submit address|valider.{0,10}adresse|住所|送信|adresse/i,
      })
      .first();
    const submitStructural = dialog.locator('button[type="submit"]:visible, button.a-btn--primary:visible').last();

    let submitClicked = false;
    for (const candidate of [submitLocalized, submitStructural]) {
      try {
        await candidate.waitFor({ state: 'visible', timeout: TIMEOUTS.short });
        await candidate.scrollIntoViewIfNeeded().catch(() => {});
        await candidate.click({ force: true, timeout: TIMEOUTS.medium });
        submitClicked = true;
        break;
      } catch {
        // try next
      }
    }

    if (!submitClicked) {
      this.log('Failed to find/click pickup form SUBMIT button', 'error');
      return false;
    }
    this.logSuccess('Pickup form SUBMIT ADDRESS clicked');

    // Verify dialog closed
    try {
      await dialog.waitFor({ state: 'detached', timeout: TIMEOUTS.medium });
    } catch {
      const stillVisible = await dialog.isVisible().catch(() => false);
      if (stillVisible) {
        throw new Error('Pickup dialog is still open after SUBMIT — likely a validation error in the form');
      }
    }

    // Wait for navigation to payment
    await Promise.race([
      this.page.waitForURL(/payment|paiement/, { timeout: TIMEOUTS.navigation }),
      this.continueToPaymentButton.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation }),
    ]).catch(() => {
      this.log('Pickup submit did not transition to payment within navigation timeout', 'warn');
    });

    return true;
  }

  // ============================================================
  // Private helpers for fillPickupAddressForm (deeper refactor)
  // ============================================================

  private async getPurchaserDialog(): Promise<Locator | null> {
    const dialog = this.page
      .locator('[role="dialog"]:visible')
      .filter({
        has: this.page.locator('input[id*="firstName" i], input[name*="firstName" i], input[id="billingPhoneNumber"]'),
      })
      .first();
    try {
      await dialog.waitFor({ state: 'visible', timeout: TIMEOUTS.element });
      return dialog;
    } catch {
      this.log('Pick-up dialog not visible', 'warn');
      return null;
    }
  }

  private async selectStateInDialog(state: string, dialog: Locator): Promise<void> {
    const labelMap: Record<string, string> = {
      NSW: 'NEW SOUTH WALES',
      VIC: 'VICTORIA',
      QLD: 'QUEENSLAND',
      WA: 'WESTERN AUSTRALIA',
      SA: 'SOUTH AUSTRALIA',
      TAS: 'TASMANIA',
      NT: 'NORTHERN TERRITORY',
      ACT: 'AUSTRALIAN CAPITAL TERRITORY',
      NY: 'NEW YORK',
      CA: 'CALIFORNIA',
      TX: 'TEXAS',
      FL: 'FLORIDA',
      IL: 'ILLINOIS',
      NJ: 'NEW JERSEY',
      MA: 'MASSACHUSETTS',
      WA_US: 'WASHINGTON',
    };
    const fullName = labelMap[state.toUpperCase()] || state;

    const stateInfo = await this.page
      .evaluate(
        ({ fullStateName, abbr }: { fullStateName: string; abbr: string }) => {
          const selects = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
          const matches = selects.filter((s) =>
            Array.from(s.options).some((o) => {
              const text = (o.textContent || '').trim().toUpperCase();
              const val = (o.value || '').trim().toUpperCase();
              return text === fullStateName.toUpperCase() || val === abbr.toUpperCase();
            })
          );
          const visible = matches.find((s) => {
            const cs = window.getComputedStyle(s);
            return cs.display !== 'none' && cs.visibility !== 'hidden' && s.offsetParent !== null;
          });
          const found = visible || matches[0];
          if (!found) return null;
          return { id: found.id, name: found.name };
        },
        { fullStateName: fullName, abbr: state }
      )
      .catch(() => null);

    if (stateInfo && (stateInfo.id || stateInfo.name)) {
      const sel = stateInfo.id
        ? `select[id="${stateInfo.id.replace(/"/g, '\\"')}"]`
        : `select[name="${stateInfo.name.replace(/"/g, '\\"')}"]`;
      // Prefer the select inside the dialog if present
      let stateSelect = dialog.locator(sel).first();
      if (!(await stateSelect.isVisible({ timeout: 300 }).catch(() => false))) {
        stateSelect = this.page.locator(sel).first();
      }
      let selected = false;
      for (const candidate of [fullName, state, state.toUpperCase()]) {
        try {
          await stateSelect.selectOption({ label: candidate });
          selected = true;
          break;
        } catch {
          try {
            await stateSelect.selectOption(candidate);
            selected = true;
            break;
          } catch {}
        }
      }
      await stateSelect
        .evaluate((el) => (el as HTMLSelectElement).dispatchEvent(new Event('blur', { bubbles: true })))
        .catch(() => {});
      if (selected) {
        this.logSuccess(`State selected first: ${state}`);
        await this.page.waitForTimeout(150);
      } else {
        this.log(`Could not select state: ${state}`, 'warn');
      }
    } else {
      this.log(`State select not found page-wide`, 'warn');
    }
  }

  private async selectCivilityInDialog(title: string, dialog: Locator): Promise<void> {
    const titleAcceptable = (() => {
      const t = title.toLowerCase();
      const variants: Record<string, string[]> = {
        mr: ['mr', 'm', 'mr.'],
        m: ['m', 'mr', 'mr.'],
        mrs: ['mrs', 'mme', 'mrs.'],
        mme: ['mme', 'mrs', 'mrs.'],
        ms: ['ms', 'mlle', 'miss', 'ms.'],
        mlle: ['mlle', 'ms', 'miss', 'ms.'],
      };
      return variants[t] || ['mr', 'm', 'mrs', 'mme', 'ms', 'mlle'];
    })();

    let selected = false;

    try {
      // Strategy A: Use accessible role + name inside the dialog (best for modern a11y)
      for (const token of titleAcceptable) {
        const radioByRole = dialog.getByRole('radio', { name: new RegExp(token, 'i') }).first();
        if (await radioByRole.isVisible({ timeout: 300 }).catch(() => false)) {
          await forceCheckRadio(radioByRole);
          this.logSuccess(`Civility radio checked (role+name): ${token}`);
          selected = true;
          break;
        }
      }

      if (!selected) {
        // Strategy B: Find label by text inside dialog, then associated input
        for (const token of titleAcceptable) {
          const label = dialog.locator('label').filter({ hasText: new RegExp(token, 'i') }).first();
          if (await label.isVisible({ timeout: 300 }).catch(() => false)) {
            const forId = await label.getAttribute('for').catch(() => null);
            let radio: Locator;
            if (forId) {
              radio = dialog.locator(`#${forId.replace(/"/g, '\\"')}`);
            } else {
              // fallback to sibling or descendant radio
              radio = label.locator('xpath=preceding-sibling::input[1] | xpath=following-sibling::input[1] | input[type="radio"]').first();
            }
            if (await radio.count() > 0 && await radio.isVisible({ timeout: 200 }).catch(() => false)) {
              await forceCheckRadio(radio);
              this.logSuccess(`Civility radio checked (label text): ${token}`);
              selected = true;
              break;
            }
          }
        }
      }

      if (!selected) {
        // Strategy C: any radio inside dialog whose label, value or id matches
        const allRadios = dialog.locator('input[type="radio"]');
        const count = await allRadios.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const radio = allRadios.nth(i);
          const id = await radio.getAttribute('id').catch(() => '');
          const val = (await radio.getAttribute('value').catch(() => '') || '').toLowerCase();
          let labelText = '';
          if (id) {
            labelText = await dialog.locator(`label[for="${id}"]`).textContent().catch(() => '') || '';
          }
          if (!labelText) {
            labelText = await radio.getAttribute('aria-label').catch(() => '') || '';
          }
          const lowerLabel = (labelText + ' ' + val + ' ' + id).toLowerCase().replace(/\./g, '');
          if (titleAcceptable.some(tok => lowerLabel.includes(tok))) {
            await forceCheckRadio(radio);
            this.logSuccess(`Civility radio checked (dialog scan): ${labelText.trim() || val || id}`);
            selected = true;
            break;
          }
        }
      }

      if (!selected) {
        // Fallback to the broad robust helper (page level)
        selected = await this._selectCivilityRobust(title, dialog);
        if (selected) {
          this.logSuccess(`Civility radio checked (fallback helper): ${title}`);
        }
      }
    } catch (e) {
      this.log(`Civility selection error in dialog: ${(e as Error).message}`, 'warn');
    }

    if (!selected) {
      this.log('Could not reliably select civility title', 'warn');
    }

    await this.page.waitForTimeout(60);
  }

  private async fillByLabelInDialog(dialog: Locator, name: RegExp, value: string, label: string): Promise<boolean> {
    // IMPORTANT: scope to the dialog!
    let tb: Locator | null = null;

    // Strategy 1: accessible name via role (preferred)
    const byRole = dialog.getByRole('textbox', { name });
    const roleCount = await byRole.count().catch(() => 0);
    for (let i = 0; i < roleCount; i++) {
      const candidate = byRole.nth(i);
      if (await candidate.isVisible().catch(() => false)) {
        tb = candidate;
        break;
      }
    }

    // Strategy 2: common ID/name patterns inside dialog (more reliable for Celine dialogs)
    if (!tb) {
      const commonSelectors = [
        'input[id*="firstName" i]:not([id*="Alternate"])',
        'input[name*="firstName" i]:not([name*="Alternate"])',
        'input[id*="lastName" i]:not([id*="Alternate"])',
        'input[name*="lastName" i]:not([name*="Alternate"])',
        'input[id*="addressOne" i], input[id*="address1" i]',
        'input[name*="addressOne" i], input[name*="address1" i]',
        'input[id*="city" i], input[name*="city" i]',
        'input[id*="postal" i], input[id*="zip" i]',
        'input[id*="phone" i], input[name*="phone" i]',
      ];
      for (const sel of commonSelectors) {
        const candidate = dialog.locator(sel).first();
        if (await candidate.isVisible({ timeout: 200 }).catch(() => false)) {
          // Only use if the label name regex roughly matches or for specific labels
          const idOrName = (await candidate.getAttribute('id')) || (await candidate.getAttribute('name')) || '';
          if (name.test(idOrName) || label.toLowerCase().includes('first') || label.toLowerCase().includes('last') || label.toLowerCase().includes('city') || label.toLowerCase().includes('address')) {
            tb = candidate;
            break;
          }
        }
      }
    }

    if (!tb) {
      this.log(`${label} visible field not found`, 'warn');
      return false;
    }
    try {
      await tb.scrollIntoViewIfNeeded().catch(() => {});
      await tb.click({ timeout: TIMEOUTS.short }).catch(() => {});
      await tb.fill('').catch(() => {});
      await tb.pressSequentially(value, { delay: 50 });
      await tb.blur().catch(() => {});
      this.logSuccess(`${label} filled: "${await tb.inputValue().catch(() => '?')}"`);
      await this.page.waitForTimeout(50);
      return true;
    } catch (err) {
      this.log(`${label} fill failed: ${(err as Error).message}`, 'warn');
      return false;
    }
  }

  private async fillPickupTextFields(options: any, dialog: Locator): Promise<void> {
    await this.fillByLabelInDialog(dialog, /first name|prénom|prenom|名|お名前/i, options.firstName, 'First name');
    await this.fillByLabelInDialog(dialog, /last name|nom de famille|^nom$|姓|苗字/i, options.lastName, 'Last name');

    const addressLocator = dialog
      .locator('#billingAddressOne, input[id*="addressOne" i], input[name*="addressOne" i], input[id*="address1" i], input[name*="address1" i]')
      .first();
    try {
      if (await addressLocator.isVisible({ timeout: 800 }).catch(() => false)) {
        await setNativeValue(addressLocator, options.address);
        this.logSuccess(`Street/Home address set via native helper`);
      }
    } catch (e) {
      this.log(`Address set failed: ${(e as Error).message}`, 'warn');
    }
    await this.page.waitForTimeout(50);

    await this.fillByLabelInDialog(dialog, /suburb|^city$|town|district|ville|市|区|町/i, options.city, 'City/Suburb/District');
  }

  private async fillKatakanaFields(options: any, dialog: Locator): Promise<void> {
    if (!options.firstNameKatakana && !options.lastNameKatakana) return;

    const kanaSelectors = [
      'input[id*="FirstnameAlternate" i], input[name*="FirstnameAlternate" i], input[id*="firstNameKana" i]',
      'input[id*="LastnameAlternate" i], input[name*="LastnameAlternate" i], input[id*="lastNameKana" i]',
    ];

    if (options.firstNameKatakana) {
      const el = dialog.locator(kanaSelectors[0]).first();
      if (await el.isVisible({ timeout: 600 }).catch(() => false)) {
        await setNativeValue(el, options.firstNameKatakana);
      }
    }
    if (options.lastNameKatakana) {
      const el = dialog.locator(kanaSelectors[1]).first();
      if (await el.isVisible({ timeout: 600 }).catch(() => false)) {
        await setNativeValue(el, options.lastNameKatakana);
      }
    }
    this.logSuccess('Katakana names set via native helper');
    await this.page.waitForTimeout(50);
  }

  private async fillPhoneFields(options: any, dialog: Locator): Promise<void> {
    if (options.phonePrefix) {
      const prefixSelect = dialog.getByRole('combobox', { name: /country code|prefix/i }).first();
      try {
        await prefixSelect.waitFor({ state: 'visible', timeout: TIMEOUTS.short });
        await prefixSelect.selectOption(options.phonePrefix);
        this.logSuccess(`Phone prefix selected: ${options.phonePrefix}`);
      } catch {
        this.log('Phone prefix select not present in pickup dialog', 'info');
      }
    }

    const phoneTb = dialog
      .locator('#billingPhoneNumber, input[name="dwfrm_billing_addressFields_phone"]')
      .first();
    try {
      await phoneTb.waitFor({ state: 'visible', timeout: TIMEOUTS.element });
      await phoneTb.scrollIntoViewIfNeeded().catch(() => {});
      await phoneTb.click({ timeout: TIMEOUTS.short }).catch(() => {});
      await phoneTb.fill('').catch(() => {});
      await phoneTb.fill(options.phone);
      let filled = await phoneTb.inputValue().catch(() => '');
      if (!filled) {
        await phoneTb.type(options.phone, { delay: 50 });
        filled = await phoneTb.inputValue().catch(() => '');
      }
      await phoneTb.blur().catch(() => {});
      this.logSuccess(`Phone number filled: "${filled}"`);
    } catch (err) {
      this.log(`Phone number fill failed: ${(err as Error).message}`, 'warn');
    }
  }

  private async ensureFieldsBeforeSubmit(options: any, dialog: Locator): Promise<void> {
    try {
      const snapshot = await dialog
        .evaluate((root) => {
          const inputs = Array.from(root.querySelectorAll('input, select')) as (HTMLInputElement | HTMLSelectElement)[];
          return inputs
            .filter((el) => {
              const cs = window.getComputedStyle(el);
              return cs.display !== 'none' && cs.visibility !== 'hidden' && (el as HTMLElement).offsetParent !== null;
            })
            .map((el) => ({
              tag: el.tagName,
              type: (el as HTMLInputElement).type || '',
              id: el.id,
              name: el.name,
              value: el.value,
            }));
        })
        .catch(() => [] as Array<{ tag: string; type: string; id: string; name: string; value: string }>);

      const empties = snapshot.filter((f) => f.tag === 'INPUT' && /text|tel|email/.test(f.type) && !f.value);
      if (empties.length) {
        this.log(`Pre-submit empty fields detected: ${empties.map((e) => e.id || e.name).join(', ')}`, 'warn');
      }

      const refillReport = await this.page
        .evaluate((data) => {
          const isVisible = (el: HTMLElement) => {
            const cs = window.getComputedStyle(el);
            return cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetParent !== null;
          };
          const findVisible = (selector: string): HTMLInputElement | null => {
            const els = Array.from(document.querySelectorAll(selector)) as HTMLInputElement[];
            return els.find(isVisible) || null;
          };
          const setNative = (el: HTMLInputElement, val: string) => {
            const proto = Object.getPrototypeOf(el);
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(el, val);
            else el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
          };
          const fields: Array<{ sel: string; val: string; label: string }> = [
            { sel: 'input[id*="firstName" i]:not([id*="Alternate" i]), input[name*="firstName" i]:not([name*="Alternate" i])', val: data.firstName, label: 'firstName' },
            { sel: 'input[id*="lastName" i]:not([id*="Alternate" i]), input[name*="lastName" i]:not([name*="Alternate" i])', val: data.lastName, label: 'lastName' },
            { sel: 'input[id*="addressOne" i], input[id*="address1" i], input[name*="addressOne" i], input[name*="address1" i]', val: data.address, label: 'address' },
            { sel: 'input[id*="city" i], input[name*="city" i]', val: data.city, label: 'city' },
            { sel: 'input[id*="postal" i], input[id*="zip" i], input[name*="postal" i], input[name*="zip" i]', val: data.postalCode, label: 'postcode' },
            { sel: '#billingPhoneNumber, input[id*="phone" i], input[name*="phone" i]', val: data.phone, label: 'phone' },
          ];
          if (data.firstNameKatakana) fields.push({ sel: 'input[id*="FirstnameAlternate" i], input[name*="FirstnameAlternate" i], input[id*="firstNameKana" i]', val: data.firstNameKatakana, label: 'firstNameKana' });
          if (data.lastNameKatakana) fields.push({ sel: 'input[id*="LastnameAlternate" i], input[name*="LastnameAlternate" i], input[id*="lastNameKana" i]', val: data.lastNameKatakana, label: 'lastNameKana' });

          const report: Record<string, string> = {};
          for (const f of fields) {
            const el = findVisible(f.sel);
            if (!el) { report[f.label] = 'NOT_FOUND'; continue; }
            if (el.value && el.value.trim() === f.val.trim()) { report[f.label] = 'OK_ALREADY'; continue; }
            setNative(el, f.val);
            report[f.label] = `SET="${el.value}" id=${el.id || el.name}`;
          }
          return report;
        }, options)
        .catch((err) => ({ error: (err as Error).message }));

      this.log(`Refill report: ${JSON.stringify(refillReport)}`, 'info');
      await this.page.waitForTimeout(100);
    } catch {}
  }
}
