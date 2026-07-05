import { Page, Locator } from '@playwright/test';
import { TIMEOUTS } from '../../../config/testConfig';
import { forceElementVisible } from '../../../utils/formHelper';
import { TestLogger } from '../../../utils/logger';
import { SELECTORS } from '../../selectors';

/**
 * Sprint 7 — extracted from `CheckoutShippingPage.fillShippingAddress` (+ its
 * private helpers) and the two publicly-facing dropdown selectors
 * (`selectStateOrPrefecture`, `selectPhonePrefix`). Behavior preserved 1:1:
 * same selectors, same fallback order, same log semantics, same timeouts.
 *
 * The extraction targets the standard address-form path only. The Click &
 * Collect dialog stays in `PickupDialogHandler` (Sprint 4-6). The submit
 * button, postal-code entry, shipping-method selection, country picker and
 * continue-to-payment orchestration stay on the façade.
 *
 * Logs use `TestLogger.scoped('AddressForm')` — the message content is
 * identical to the previous `[Shipping]` logs, only the component prefix
 * changes for clarity (same pattern as Sprint 4 for `PickupDialog`).
 *
 * PII policy: this file must NOT log `error.message`, `String(error)`,
 * `JSON.stringify(error)`, nor any field value (phone, address, email,
 * postal code, names, city, state/prefecture code, country dialing
 * prefix, or any other value derived from `options.*`). Errors surface
 * via `error.name` only. Selection paths log only a technical label —
 * never the option value. Verification-mismatch paths log only a
 * technical label — never the expected/actual pair (Sprint 7 hotfix 1:
 * the pre-Sprint-7 pair could leak address/phone/name; the pair was
 * removed in three sites — `fillField`, `safeFill`, and the "already
 * pre-filled" branch of `fillShippingAddress`. Sprint 7 hotfix 2:
 * `selectStateOrPrefecture` and `selectPhonePrefix` no longer echo the
 * chosen value either).
 */

/**
 * Shipping address options interface — moved from `CheckoutShippingPage.ts`
 * and re-exported from there for backwards compatibility with any external
 * import site. Adding fields here changes the public surface of
 * `CheckoutShippingPage.fillShippingAddress`.
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
 * Locators the filler needs. Passed through by `CheckoutShippingPage` so
 * that the filler does NOT import the façade. Kept minimal — only the
 * anchors used by the address-form path.
 */
export interface AddressFormFillerDeps {
  page: Page;
  shippingPanel: Locator;
  firstNameInput: Locator;
  prefectureSelect: Locator;
  phonePrefixSelect: Locator;
}

const scopedLogger = TestLogger.scoped('AddressForm');

/**
 * PII-safe error tag for logs. Matches the Sprint 4/5/6 convention across
 * the shipping helpers — never `.message`, never `String(error)`, never
 * `JSON.stringify(error)`.
 */
function errorName(err: unknown): string {
  return err instanceof Error && err.name ? err.name : 'UnknownError';
}

export class AddressFormFiller {
  constructor(private readonly deps: AddressFormFillerDeps) {}

  private get page(): Page {
    return this.deps.page;
  }

  /**
   * Fill the shipping address form. Public entry point — same contract as
   * the previous `CheckoutShippingPage.fillShippingAddress`.
   *
   * @returns `true` when every required field was set successfully. `false`
   *          when the form did not open or a required field failed to fill.
   */
  async fillShippingAddress(options: ShippingAddressOptions): Promise<boolean> {
    scopedLogger.step('📝 Waiting for address form to open');

    const formReady = await this.ensureFormVisible();
    if (!formReady) {
      scopedLogger.error('Cannot open address form');
      return false;
    }

    scopedLogger.success('Address form opened');
    scopedLogger.step('Filling address form');

    // Scope to side panel if open (for US after clicking delivery method label)
    const isPanel = await this.deps.shippingPanel.isVisible({ timeout: 1000 }).catch(() => false);
    const scope = isPanel ? this.deps.shippingPanel : this.page;

    const firstNameInput = scope.locator(SELECTORS.CHECKOUT.SHIPPING.FIRST_NAME).first();
    const lastNameInput = scope.locator(SELECTORS.CHECKOUT.SHIPPING.LAST_NAME).first();
    const addressInput = scope.locator(SELECTORS.CHECKOUT.SHIPPING.ADDRESS).first();
    const cityInput = scope.locator(SELECTORS.CHECKOUT.SHIPPING.CITY).first();
    const zipcodeAddressField = scope
      .locator(SELECTORS.CHECKOUT.SHIPPING.ZIPCODE_ADDRESS_FIELD)
      .first();
    const phoneInput = scope.locator(SELECTORS.CHECKOUT.SHIPPING.PHONE).first();
    const firstNameKatakanaInput = scope
      .locator(SELECTORS.CHECKOUT.SHIPPING.FIRST_NAME_KATAKANA)
      .first();
    const lastNameKatakanaInput = scope
      .locator(SELECTORS.CHECKOUT.SHIPPING.LAST_NAME_KATAKANA)
      .first();

    // Fill required fields SEQUENTIALLY to avoid race conditions
    const firstNameOk = await this.fillField(firstNameInput, options.firstName, 'First name');
    const lastNameOk = await this.fillField(lastNameInput, options.lastName, 'Last name');
    const addressOk = await this.fillField(addressInput, options.address, 'Address');

    // City: only fill if empty (may be pre-filled by postcode lookup).
    // Sprint 7 hotfix: read the current value only to gate the fill; the
    // raw value MUST NOT reach the log (PII policy — user's city name).
    let cityOk = true;
    const cityAlreadyFilled = ((await cityInput.inputValue().catch(() => '')) || '').trim() !== '';
    if (!cityAlreadyFilled) {
      cityOk = await this.fillField(cityInput, options.city, 'City');
    } else {
      scopedLogger.success('City field already pre-filled');
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
      await this.fillOptionalField(
        firstNameKatakanaInput,
        options.firstNameKatakana,
        'First name katakana'
      );
    }
    if (options.lastNameKatakana) {
      await this.fillOptionalField(
        lastNameKatakanaInput,
        options.lastNameKatakana,
        'Last name katakana'
      );
    }

    scopedLogger.success('Address form completed');
    return firstNameOk && lastNameOk && addressOk && cityOk && phoneOk;
  }

  /**
   * Select state/prefecture from dropdown (US and Japan-specific). Selects
   * the first non-empty option when no explicit value is given.
   */
  async selectStateOrPrefecture(value?: string): Promise<boolean> {
    const isVisible = await this.isVisible(this.deps.prefectureSelect, TIMEOUTS.short);
    if (!isVisible) {
      scopedLogger.info('State/Prefecture dropdown not visible - skipping');
      return false;
    }

    // Use provided value or fall back to first non-empty option
    const optionValue =
      value ??
      (await this.deps.prefectureSelect.evaluate((select: HTMLSelectElement) => {
        const option = Array.from(select.options).find((o) => o.value && o.value.trim() !== '');
        return option ? option.value : null;
      }));

    if (!optionValue) {
      scopedLogger.warn('No valid state/prefecture option found');
      return false;
    }

    const selected = await this.safeSelect(this.deps.prefectureSelect, optionValue, TIMEOUTS.short);

    if (selected) {
      // Sprint 7 hotfix 2: previous log echoed the raw state/prefecture
      // code (e.g. `NSW`, `CA`). Even a region code is a form value; PII
      // policy forbids echoing any option value. Emit a technical label.
      scopedLogger.success('State/Prefecture selected');
    }

    return selected;
  }

  /**
   * Select phone prefix from dropdown (AU-specific).
   */
  async selectPhonePrefix(prefix: string): Promise<boolean> {
    const isVisible = await this.isVisible(this.deps.phonePrefixSelect, TIMEOUTS.short);
    if (!isVisible) {
      scopedLogger.info('Phone prefix dropdown not visible - skipping');
      return false;
    }

    const selected = await this.safeSelect(this.deps.phonePrefixSelect, prefix, TIMEOUTS.short);

    if (selected) {
      // Sprint 7 hotfix 2: previous log echoed the raw country prefix
      // (e.g. `+61`). Even a country dialing code is a form value derived
      // from options; PII policy forbids echoing it. Emit a technical
      // label.
      scopedLogger.success('Phone prefix selected');
    }

    return selected;
  }

  /**
   * Ensure the address form is visible. Public because the façade already
   * exposed the invariant "form is ready before we start filling" — some
   * callers may want to gate on it independently.
   */
  async ensureFormVisible(): Promise<boolean> {
    try {
      await this.deps.firstNameInput.waitFor({
        state: 'attached',
        timeout: TIMEOUTS.navigation / 2,
      });

      const isVisible = await this.isVisible(this.deps.firstNameInput);
      if (!isVisible) {
        scopedLogger.info('Field found but hidden, forcing visibility...');
        await forceElementVisible(this.deps.firstNameInput);
        scopedLogger.success('Address form visibility forced');
      }

      return true;
    } catch {
      // Try to click toggle to open form
      return await this.tryOpenFormToggle();
    }
  }

  // ============================================================
  // Private helpers — moved 1:1 from CheckoutShippingPage.ts
  // ============================================================

  /**
   * Try to open the form by clicking a toggle.
   */
  private async tryOpenFormToggle(): Promise<boolean> {
    scopedLogger.warn('Form did not open, trying to click on shipping section...');

    const toggle = this.page
      .locator('[data-toggle*="collapse"][href*="shipping"], button[aria-controls*="shipping"]')
      .first();
    const clicked = await this.safeClick(toggle, { timeout: TIMEOUTS.short });

    if (clicked) {
      try {
        await this.deps.firstNameInput.waitFor({ state: 'attached', timeout: TIMEOUTS.medium });
        scopedLogger.success('Address form opened after clicking toggle');
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Fill a required field with logging. Includes explicit focus and small
   * delay to prevent race conditions. Behavior preserved 1:1 from the
   * pre-Sprint-7 `CheckoutShippingPage.fillField`.
   */
  private async fillField(locator: Locator, value: string, fieldName: string): Promise<boolean> {
    try {
      // Wait for field to be visible
      await locator.waitFor({ state: 'visible', timeout: TIMEOUTS.element });

      // Scroll into view if needed
      await locator
        .scrollIntoViewIfNeeded()
        .catch(this.swallowOptional('fillField scrollIntoView'));

      // Explicit focus before filling
      await locator.focus();

      // Small delay to ensure focus is set - workaround for browser input races
      await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.focusDelay));

      // Clear existing value
      await locator.clear();

      // Fill with value
      await locator.fill(value);

      // Verify the value was set correctly. Sprint 7 hotfix: the pre-Sprint-7
      // log echoed both `value` and `actualValue` — the pair could carry PII
      // (address/phone/name). We now emit only a technical label; the
      // caller sees the failure via the returned `false` and any deeper
      // triage can happen via the E2E trace.
      const actualValue = await locator.inputValue();
      if (actualValue !== value) {
        scopedLogger.warn(`${fieldName} verification failed after fill`);
        return false;
      }

      // Small delay after fill to ensure browser processes input - workaround for input race conditions
      await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.inputDelay));

      scopedLogger.success(`${fieldName} filled`);
      return true;
    } catch (err) {
      // Sprint 7: previous log embedded `error.message` — replaced with
      // `error.name` per Sprint 4/5/6 PII policy. Callers get the same
      // return contract; triage retains the failure classifier.
      scopedLogger.warn(`Error filling ${fieldName}: ${errorName(err)}`);
      return false;
    }
  }

  /**
   * Fill an optional field (only if visible).
   */
  private async fillOptionalField(
    locator: Locator,
    value: string,
    fieldName: string
  ): Promise<void> {
    const isVisible = await this.isVisible(locator, TIMEOUTS.short);
    if (isVisible) {
      const filled = await this.safeFill(locator, value);
      if (filled) {
        scopedLogger.success(`${fieldName} filled`);
      }
    } else {
      scopedLogger.info(`${fieldName} field not required for this region`);
    }
  }

  // ============================================================
  // Local primitives — reimplemented from BasePage so the filler
  // has no inheritance dependency (Sprint 4/5/6 pattern).
  // ============================================================

  /**
   * Sprint 3-style optional-step catch handler. Never rethrows; logs at
   * `debug` with the given technical label. Same shape as
   * `CheckoutShippingPage.swallowOptional` (Sprint 3) — kept local so this
   * file has no dependency on the façade.
   */
  private swallowOptional(label: string): (err: unknown) => void {
    return (err) => {
      scopedLogger.debug(`${label} skipped: ${errorName(err)}`);
    };
  }

  /**
   * Check whether a locator is visible within the given timeout. Failures
   * are downgraded to a `debug` log (never silent) so the trail exists
   * without breaking the boolean contract.
   */
  private async isVisible(locator: Locator, timeout: number = 2000): Promise<boolean> {
    try {
      return await locator.isVisible({ timeout });
    } catch (err) {
      scopedLogger.debug(`isVisible check failed (timeout=${timeout}ms): ${errorName(err)}`);
      return false;
    }
  }

  /**
   * Safely fill an input field with error handling. Behavior preserved 1:1
   * from `BasePage.safeFill` (the primitive used by pre-Sprint-7
   * `fillOptionalField`).
   */
  private async safeFill(locator: Locator, value: string): Promise<boolean> {
    try {
      await locator.waitFor({ state: 'visible', timeout: TIMEOUTS.element });
      await locator
        .scrollIntoViewIfNeeded()
        .catch(this.swallowOptional('safeFill scrollIntoView'));
      await locator.clear().catch(this.swallowOptional('safeFill clear'));
      await locator.fill(value, { timeout: TIMEOUTS.element });
      // Sprint 7 hotfix: only compare — never echo `value`/`actualValue`
      // into the log. Caller sees the failure via the returned `false`.
      const actualValue = await locator.inputValue().catch(() => '');
      if (actualValue !== value) {
        scopedLogger.warn('Fill verification failed after fill');
        return false;
      }
      return true;
    } catch (err) {
      scopedLogger.warn(`Fill failed: ${errorName(err)}`);
      return false;
    }
  }

  /**
   * Safely click an element. Behavior preserved 1:1 from `BasePage.safeClick`.
   */
  private async safeClick(
    locator: Locator,
    options: { timeout: number; force?: boolean } = { timeout: TIMEOUTS.element }
  ): Promise<boolean> {
    const { timeout, force = false } = options;
    try {
      await locator
        .scrollIntoViewIfNeeded()
        .catch(this.swallowOptional('safeClick scrollIntoView'));
      await locator.click({ timeout, force });
      return true;
    } catch (err) {
      scopedLogger.warn(`Click failed: ${errorName(err)}`);
      return false;
    }
  }

  /**
   * Select an option from a dropdown. Behavior preserved 1:1 from
   * `BasePage.safeSelect`.
   */
  private async safeSelect(locator: Locator, value: string, timeout: number): Promise<boolean> {
    try {
      await locator.selectOption(value, { timeout });
      return true;
    } catch (err) {
      scopedLogger.warn(`Select failed: ${errorName(err)}`);
      return false;
    }
  }
}
