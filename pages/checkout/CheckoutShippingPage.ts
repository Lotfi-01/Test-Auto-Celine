import { Page, Locator } from '@playwright/test';
import { BasePage } from '../BasePage';
import { SHIPPING_METHOD_STRATEGY } from '../../utils/selectorStrategy';
import { SELECTORS } from '../selectors';
import { TIMEOUTS } from '../../config/testConfig';
import { forceElementVisible } from '../../utils/formHelper';
import { CivilitySelector } from './shipping/CivilitySelector';
import { PickupDialogHandler, PickupDialogOptions } from './shipping/PickupDialogHandler';

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

  private readonly civilitySelector: CivilitySelector;
  private readonly pickupDialogHandler: PickupDialogHandler;

  constructor(page: Page) {
    super(page, 'Shipping');
    this.civilitySelector = new CivilitySelector(page);

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

    // Sprint 4 — pickup dialog logic extracted to PickupDialogHandler.
    // Depends on the civility selector (used as final fallback for the title
    // radio inside the dialog) and on `continueToPaymentButton` (used by the
    // submit → payment transition race).
    this.pickupDialogHandler = new PickupDialogHandler(
      page,
      this.civilitySelector,
      this.continueToPaymentButton
    );
  }

  /**
   * Sprint 3 — replaces silent catch handlers on optional steps.
   * Returns a catch handler that logs the failure at debug level with the
   * given `label` context. Never rethrows — the calling flow keeps going
   * exactly as it did with the previous no-op catch. Same pattern as
   * `utils/selectorStrategy.ts:swallowOptional`.
   */
  private swallowOptional(label: string): (err: unknown) => void {
    return (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`${label} skipped: ${msg}`, 'debug');
    };
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

    // Sprint 3: waitForTimeout(100) padding removed — the Tab press already
    // triggers the async validation, and `clickOkButton` below has its own
    // `submitZipButton.waitFor({ state: 'visible' })` so the OK button
    // becoming ready is a proper web-first signal.
    await postalCodeInput.press('Tab').catch(this.swallowOptional('postal code Tab blur'));

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
        .catch(this.swallowOptional('waitForFunction OK-button-enabled'));

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

    // Sprint 3: robust civility logic extracted to CivilitySelector (same
    // 3-strategy fallback, same evaluate()-based broad scan, same event order).
    const success = await this.civilitySelector.select(title, scope);
    if (success) {
      this.logSuccess(`Title selected: ${title}`);
    }
    return success;
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
      await locator.scrollIntoViewIfNeeded().catch(this.swallowOptional('fillField scrollIntoView'));

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
        .catch(this.swallowOptional('address form belt-and-suspenders requestSubmit'));

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
  async fillPickupAddressForm(options: PickupDialogOptions): Promise<boolean> {
    // Sprint 4: dialog fill + submit extracted to PickupDialogHandler.
    // Public signature and return contract are preserved 1:1.
    return this.pickupDialogHandler.fillDialog(options);
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
      await pickupTab.scrollIntoViewIfNeeded().catch(this.swallowOptional('pickup tab scrollIntoView'));
      // Move mouse to the button and click via the page.mouse API (most "trusted" interaction)
      const box = await pickupTab.boundingBox();
      if (box) {
        await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        // TODO Sprint 5: replace with stable shipping signal.
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
          await anyPickup.click({ force: true }).catch(this.swallowOptional('pickup fallback force click'));
          // TODO Sprint 5: replace with stable shipping signal.
          await this.page.waitForTimeout(500);
          this.logSuccess('Clicked alternative pickup element');
        } else {
          // Ultimate fallback: use JS to find and click any element with pickup text
          this.log('Ultimate JS fallback for pickup...', 'warn');
          await this.page.evaluate(() => {
            const els = Array.from(document.querySelectorAll('button, label, a, div[role="tab"]'));
            const match = els.find(el => /pick.?up|click.?&.?collect/i.test(el.textContent || ''));
            if (match) (match as HTMLElement).click();
          }).catch(this.swallowOptional('pickup ultimate JS fallback click'));
          // TODO Sprint 5: replace with stable shipping signal.
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
        .catch(this.swallowOptional('pickup tab JS click + dispatch fallback'));
      // TODO Sprint 5: replace with stable shipping signal.
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
    await firstStoreLabel.scrollIntoViewIfNeeded().catch(this.swallowOptional('firstStoreLabel scrollIntoView'));

    // Try Playwright click first (natural trusted event). Failure is expected
    // on some UIs where the label click is swallowed; the JS fallback below
    // is the actual invariant.
    await firstStoreLabel.click({ timeout: TIMEOUTS.short }).catch(this.swallowOptional('firstStoreLabel Playwright click (JS fallback follows)'));

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
        .catch(this.swallowOptional('store JS click + dispatch fallback'));
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
            await radio.evaluate((el: HTMLElement) => el.click()).catch(this.swallowOptional('shipping method radio JS click fallback'));
          });
          clicked = true;
        } else {
          const label = this.page.locator('label[for*="shippingMethod"], label:has(input[type="radio"])').first();
          if (await label.isVisible({ timeout: 1500 }).catch(() => false)) {
            await label.click({ force: true }).catch(async () => {
              await label.evaluate((el: HTMLElement) => el.click()).catch(this.swallowOptional('shipping method label JS click fallback'));
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
    await this.page.waitForURL(/payment|paiement/, { timeout: TIMEOUTS.navigation })
      .catch(this.swallowOptional('waitForURL /payment (pre-check)'));

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
        await this.page.waitForURL(/payment|paiement/, { timeout: TIMEOUTS.navigation })
          .catch(this.swallowOptional('waitForURL /payment (post-continue click)'));
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
      await this.submitShippingButton.waitFor({ state: 'attached', timeout: TIMEOUTS.medium })
        .catch(this.swallowOptional('submitShippingButton waitFor attached'));

      const isAttached = await this.submitShippingButton.count().then(c => c > 0).catch(() => false);
      if (!isAttached) {
        this.log('Submit shipping button not present', 'warn');
        return false;
      }

      // Scroll + force/JS click path (preferred for prefilled registered case)
      await this.submitShippingButton.scrollIntoViewIfNeeded().catch(this.swallowOptional('submitShippingButton scrollIntoView'));

      let clicked = await this.safeClick(this.submitShippingButton, { timeout: TIMEOUTS.short, force: true });

      if (!clicked) {
        await this.submitShippingButton.evaluate((el: HTMLElement) => (el as HTMLButtonElement).click())
          .catch(this.swallowOptional('submitShippingButton JS click fallback'));
        clicked = true;
      }

      if (clicked) {
        this.logSuccess('Submit shipping button clicked (#submitShippingBtn)');
      }

      // Sprint 3: the previous `waitForTimeout(150)` was blind padding. The
      // real signal after a form submit is the document reaching
      // `domcontentloaded`. Timeout is bounded so a stuck submit still surfaces
      // via the caller's own next assertion, not a silent sleep.
      await this.page
        .waitForLoadState('domcontentloaded', { timeout: 1000 })
        .catch(this.swallowOptional('post submit-shipping DOM settle'));

      return clicked;
    } catch (e) {
      this.log(`Failed to click submit shipping: ${(e as Error).message}`, 'warn');
      return false;
    }
  }

}
