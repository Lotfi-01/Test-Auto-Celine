import { Page, Locator } from '@playwright/test';
import { BasePage } from '../BasePage';
import { SELECTORS } from '../selectors';
import { TIMEOUTS } from '../../config/testConfig';
import { CivilitySelector } from './shipping/CivilitySelector';
import { PickupDialogHandler, PickupDialogOptions } from './shipping/PickupDialogHandler';
import { AddressFormFiller, ShippingAddressOptions } from './shipping/AddressFormFiller';
import { SelectClickAndCollectHelper } from './shipping/SelectClickAndCollectHelper';
import { ShippingMethodSelector } from './shipping/ShippingMethodSelector';
import { ShippingPostalCodeHandler } from './shipping/ShippingPostalCodeHandler';
import { ContinueToShippingHandler } from './shipping/ContinueToShippingHandler';
import { ContinueToPaymentHandler } from './shipping/ContinueToPaymentHandler';
import { ClickSubmitShippingHandler } from './shipping/ClickSubmitShippingHandler';

/**
 * Re-export the address-options interface from its Sprint-7 home so any
 * external site that imports it from `CheckoutShippingPage` keeps working.
 * The interface itself lives in `./shipping/AddressFormFiller.ts` — do NOT
 * add fields here; they belong on the filler's public surface.
 */
export type { ShippingAddressOptions };

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
  private readonly addressFormFiller: AddressFormFiller;
  private readonly selectClickAndCollectHelper: SelectClickAndCollectHelper;
  private readonly shippingMethodSelector: ShippingMethodSelector;
  private readonly shippingPostalCodeHandler: ShippingPostalCodeHandler;
  private readonly continueToShippingHandler: ContinueToShippingHandler;
  private readonly continueToPaymentHandler: ContinueToPaymentHandler;
  private readonly clickSubmitShippingHandler: ClickSubmitShippingHandler;

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

    // Sprint 7 — standard address-form fill extracted to AddressFormFiller.
    // Takes the anchor Locators needed by the form-visibility check and the
    // two dropdowns whose public API stays on this façade.
    this.addressFormFiller = new AddressFormFiller({
      page,
      shippingPanel: this.shippingPanel,
      firstNameInput: this.firstNameInput,
      prefectureSelect: this.prefectureSelect,
      phonePrefixSelect: this.phonePrefixSelect,
    });

    // Sprint 17 — Click & Collect opening flow extracted to
    // SelectClickAndCollectHelper. Only needs `page` (for the tab
    // fallbacks, JS evaluate calls, and the store-selection dance).
    // Behavior preserved 1:1.
    this.selectClickAndCollectHelper = new SelectClickAndCollectHelper(page);

    // Sprint 18 — Shipping method selection extracted to
    // ShippingMethodSelector. Receives `page`, the `firstNameInput`
    // anchor, and a bound callback to `BasePage.safeClickWithLabelFallback`
    // (kept on the façade so the primitive's `force: true` calls stay
    // owned by BasePage — delta net on `force: true` = 0). Behavior
    // preserved 1:1.
    this.shippingMethodSelector = new ShippingMethodSelector(
      page,
      this.firstNameInput,
      (locator, options) => this.safeClickWithLabelFallback(locator, options)
    );

    // Sprint 19 — Postal code entry (`enterPostalCode` +
    // `clickOkButton`) extracted to `ShippingPostalCodeHandler`.
    // Receives `page` + 4 bound BasePage callbacks so the primitives'
    // internal behavior stays owned by BasePage — no duplication.
    // Behavior preserved 1:1.
    this.shippingPostalCodeHandler = new ShippingPostalCodeHandler({
      page,
      safeFill: (locator, value, options) => this.safeFill(locator, value, options),
      safeClick: (locator, options) => this.safeClick(locator, options),
      waitForNetworkIdle: (timeout) => this.waitForNetworkIdle(timeout),
      waitForDomContent: (timeout) => this.waitForDomContent(timeout),
    });

    // Sprint 21 — Address-submit / continue-to-shipping transition
    // extracted to `ContinueToShippingHandler`. Receives `page`, the 2
    // anchor Locators the block uses, and a bound `safeClick` callback
    // (kept on BasePage — no primitive duplication). Behavior preserved 1:1.
    this.continueToShippingHandler = new ContinueToShippingHandler({
      page,
      validateAddressButton: this.validateAddressButton,
      continueToPaymentButton: this.continueToPaymentButton,
      safeClick: (locator, options) => this.safeClick(locator, options),
    });

    // Sprint 22 — Continue-to-payment transition extracted to
    // `ContinueToPaymentHandler`. Receives `page`, the anchor
    // `continueToPaymentButton`, and 2 bound BasePage callbacks
    // (`safeClick`, `isVisible`). Behavior preserved 1:1.
    this.continueToPaymentHandler = new ContinueToPaymentHandler({
      page,
      continueToPaymentButton: this.continueToPaymentButton,
      safeClick: (locator, options) => this.safeClick(locator, options),
      isVisible: (locator, timeout) => this.isVisible(locator, timeout),
    });

    // Sprint 23 — Submit-shipping button click extracted to
    // `ClickSubmitShippingHandler`. Receives `page`, the
    // `submitShippingButton` anchor, and a bound `safeClick` callback.
    // Behavior preserved 1:1.
    this.clickSubmitShippingHandler = new ClickSubmitShippingHandler({
      page,
      submitShippingButton: this.submitShippingButton,
      safeClick: (locator, options) => this.safeClick(locator, options),
    });
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
   * Sprint 11 — PII-safe error tag. Never returns `.message` (which can
   * embed selectors, URLs, or field values on Playwright errors). Used
   * exclusively by the new inline catch below; the historical
   * `swallowOptional` above is untouched (out of scope for Sprint 11).
   */
  private errorName(err: unknown): string {
    return err instanceof Error && err.name ? err.name : 'UnknownError';
  }

  /**
   * Enter postal code to unlock shipping form
   * @param postalCode - Postal/ZIP code
   */
  async enterPostalCode(postalCode: string): Promise<boolean> {
    // Sprint 19: full body extracted to `ShippingPostalCodeHandler`.
    // `clickOkButton` (previously a private helper of this class, with a
    // single caller — `enterPostalCode` itself) is now private inside
    // the handler. Public signature and return contract preserved 1:1.
    return this.shippingPostalCodeHandler.enter(postalCode);
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
   * Fill shipping address form.
   *
   * Sprint 7: the fill logic + `fillField` / `fillOptionalField` /
   * `ensureFormVisible` / `tryOpenFormToggle` private helpers were extracted
   * to `AddressFormFiller`. Public signature and return contract are
   * preserved 1:1.
   *
   * @param options - Address details
   */
  async fillShippingAddress(options: ShippingAddressOptions): Promise<boolean> {
    return this.addressFormFiller.fillShippingAddress(options);
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
   * Select state/prefecture from dropdown (US and Japan-specific).
   * Sprint 7: implementation extracted to `AddressFormFiller`. Public
   * signature and return contract are preserved 1:1.
   */
  async selectStateOrPrefecture(value?: string): Promise<boolean> {
    return this.addressFormFiller.selectStateOrPrefecture(value);
  }

  /**
   * Click submit address button to validate address
   */
  async continueToShipping(): Promise<void> {
    // Sprint 21: full body extracted to `ContinueToShippingHandler`.
    // Public signature and return contract preserved 1:1 (Promise<void>,
    // rethrows on outer catch).
    return this.continueToShippingHandler.continue();
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
    // Sprint 17: full body extracted to `SelectClickAndCollectHelper`.
    // Public signature and return contract preserved 1:1.
    return this.selectClickAndCollectHelper.select();
  }

  /**
   * Select first available shipping method
   * Uses name-based selector as primary (avoids dynamic IDs), then falls back to strategy
   */
  async selectFirstShippingMethod(): Promise<boolean> {
    // Sprint 18: full body extracted to `ShippingMethodSelector`. Public
    // signature and return contract preserved 1:1.
    return this.shippingMethodSelector.selectFirst();
  }

  /**
   * Select phone prefix from dropdown (AU-specific).
   * Sprint 7: implementation extracted to `AddressFormFiller`. Public
   * signature and return contract are preserved 1:1.
   * @param prefix - Phone prefix (e.g., '+61')
   */
  async selectPhonePrefix(prefix: string): Promise<boolean> {
    return this.addressFormFiller.selectPhonePrefix(prefix);
  }

  /**
   * Click continue to payment button
   * Note: After address validation, the page may auto-navigate to payment
   */
  async continueToPayment(): Promise<boolean> {
    // Sprint 22: full body extracted to `ContinueToPaymentHandler`.
    // Public signature and return contract preserved 1:1 (Promise<boolean>,
    // 3 truthy paths, throws when payment is not detected).
    return this.continueToPaymentHandler.continue();
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
    // Sprint 23: full body extracted to `ClickSubmitShippingHandler`.
    // Public signature and return contract preserved 1:1
    // (Promise<boolean>, 3 return paths, never throws).
    return this.clickSubmitShippingHandler.click();
  }

}
