import { Page, Locator } from '@playwright/test';
import { TIMEOUTS } from '../../../config/testConfig';
import { setNativeValue } from '../../../utils/formHelper';
import { TestLogger } from '../../../utils/logger';
import { CivilitySelector } from './CivilitySelector';
import { PickupCivilityStrategy } from './PickupCivilityStrategy';
import { PickupRefillGuard } from './PickupRefillGuard';
import { PickupStateSelector, pickupStateLabelFor } from './PickupStateSelector';

/**
 * Sprint 15 — `pickupStateLabelFor` is re-exported here for backwards
 * compatibility with the existing unit-test import
 * (`tests/unit/PickupDialogHandler.spec.ts`). The function itself lives
 * in `./PickupStateSelector.ts` — do NOT define it locally.
 */
export { pickupStateLabelFor };

/**
 * Sprint 4 — extracted from `CheckoutShippingPage` (fillPickupAddressForm
 * flow + all its private helpers). Behavior preserved 1:1: same selectors,
 * same fallback order, same event dispatch, same sleeps (each still marked
 * `TODO Sprint 5` when no stable signal exists).
 *
 * The evaluate()-based scans and the single `force: true` on the submit
 * button were already present in `CheckoutShippingPage`; they are moved
 * as-is — no new evaluate() nor force:true introduced.
 *
 * Logs use `TestLogger.scoped('PickupDialog')` — the message content is
 * identical to the previous `[Shipping]` logs, only the component prefix
 * changes for clarity.
 */

/**
 * Options for the pickup purchaser dialog. Same shape as the public
 * `CheckoutShippingPage.fillPickupAddressForm` signature — do NOT change
 * without updating the façade and the spec.
 */
export interface PickupDialogOptions {
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
}

const scopedLogger = TestLogger.scoped('PickupDialog');

/**
 * PII-safe error tag for logs.
 *
 * Sprint 4 constraint: do NOT log `error.message` nor `String(error)` — a
 * message string may embed selectors, URLs or field values that leak PII in
 * failure paths. `error.name` (e.g. `TimeoutError`, `Error`) carries enough
 * signal for triage while staying value-free. The label passed by the
 * caller describes the technical step and is safe to log verbatim.
 */
function errorName(err: unknown): string {
  return err instanceof Error && err.name ? err.name : 'UnknownError';
}

export class PickupDialogHandler {
  private readonly pickupCivilityStrategy: PickupCivilityStrategy;
  private readonly pickupRefillGuard: PickupRefillGuard;
  private readonly pickupStateSelector: PickupStateSelector;

  constructor(
    private readonly page: Page,
    private readonly civilitySelector: CivilitySelector,
    private readonly continueToPaymentButton: Locator
  ) {
    // Sprint 5 — civility fallback chain extracted to PickupCivilityStrategy.
    // The shared `civilitySelector` is still passed through so Strategy D
    // (page-wide fallback) keeps working.
    this.pickupCivilityStrategy = new PickupCivilityStrategy(civilitySelector);
    // Sprint 6 — pre-submit refill snapshot + native refill extracted to
    // PickupRefillGuard. Only needs the shared `page` — no dependency on
    // the handler.
    this.pickupRefillGuard = new PickupRefillGuard(page);
    // Sprint 15 — state / province / prefecture selection extracted to
    // PickupStateSelector. Only needs `page` (for the outer `evaluate`
    // that scans page-wide selects). Behavior preserved 1:1.
    this.pickupStateSelector = new PickupStateSelector(page);
  }

  /**
   * Public entry point — fills the "PURCHASER INFORMATION" dialog for
   * Click & Collect and submits it. Same contract as the previous
   * `CheckoutShippingPage.fillPickupAddressForm`.
   *
   * @returns `true` when the dialog was submitted successfully, `false`
   *          when the dialog is not visible (early-out).
   * @throws  When the dialog is still open after clicking SUBMIT (a
   *          validation error was likely triggered by Celine).
   */
  async fillDialog(options: PickupDialogOptions): Promise<boolean> {
    scopedLogger.step('📝 Filling Pick-up address form');

    const dialog = await this.getDialog();
    if (!dialog) return false;

    // STATE FIRST — state selection can wipe other fields and reset title
    if (options.state) {
      await this.selectStateInDialog(options.state, dialog);
    }

    await this.pickupCivilityStrategy.select(dialog, options.title);

    // Postcode early (may trigger re-renders/autocomplete)
    const postcodeLocator = dialog
      .locator(
        'input[id*="postal" i], input[id*="zip" i], input[name*="postal" i], input[name*="zip" i]'
      )
      .first();
    try {
      if (await postcodeLocator.isVisible({ timeout: 800 }).catch(() => false)) {
        await setNativeValue(postcodeLocator, options.postalCode);
        scopedLogger.success(`Postcode set via native helper: "${options.postalCode}"`);
      }
    } catch (e) {
      scopedLogger.warn(`Postcode set failed: ${errorName(e)}`);
    }
    // TODO Sprint 5: replace with stable pickup signal.
    await this.page.waitForTimeout(60);

    await this.fillTextFields(options, dialog);
    await this.fillKatakanaFields(options, dialog);
    await this.fillPhoneFields(options, dialog);

    await this.pickupRefillGuard.ensureFields(options, dialog);

    return await this.submitDialog(dialog);
  }

  // ============================================================
  // Private helpers — moved 1:1 from CheckoutShippingPage.ts
  // ============================================================

  private async getDialog(): Promise<Locator | null> {
    const dialog = this.page
      .locator('[role="dialog"]:visible')
      .filter({
        has: this.page.locator(
          'input[id*="firstName" i], input[name*="firstName" i], input[id="billingPhoneNumber"]'
        ),
      })
      .first();
    try {
      await dialog.waitFor({ state: 'visible', timeout: TIMEOUTS.element });
      return dialog;
    } catch {
      scopedLogger.warn('Pick-up dialog not visible');
      return null;
    }
  }

  /**
   * Sprint 15: full body extracted to `PickupStateSelector`. The private
   * signature is preserved as a delegate so `fillDialog` (below) keeps
   * calling `this.selectStateInDialog(...)` at the same spot with the
   * same arguments — no callsite refactor needed.
   */
  private async selectStateInDialog(state: string, dialog: Locator): Promise<void> {
    return this.pickupStateSelector.select(state, dialog);
  }

  private async fillByLabelInDialog(
    dialog: Locator,
    name: RegExp,
    value: string,
    label: string
  ): Promise<boolean> {
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
          const idOrName =
            (await candidate.getAttribute('id')) || (await candidate.getAttribute('name')) || '';
          if (
            name.test(idOrName) ||
            label.toLowerCase().includes('first') ||
            label.toLowerCase().includes('last') ||
            label.toLowerCase().includes('city') ||
            label.toLowerCase().includes('address')
          ) {
            tb = candidate;
            break;
          }
        }
      }
    }

    if (!tb) {
      scopedLogger.warn(`${label} visible field not found`);
      return false;
    }
    try {
      await tb.scrollIntoViewIfNeeded().catch(this.swallowOptional(`${label} tb scrollIntoView`));
      await tb.click({ timeout: TIMEOUTS.short }).catch(this.swallowOptional(`${label} tb focus click`));
      await tb.fill('').catch(this.swallowOptional(`${label} tb pre-clear`));
      await tb.pressSequentially(value, { delay: 50 });
      await tb.blur().catch(this.swallowOptional(`${label} tb post-fill blur`));
      // Log confirms the field was filled but does NOT echo the value — for
      // fields like phone/address, the raw value is PII; only the label is safe.
      scopedLogger.success(`${label} filled`);
      // TODO Sprint 5: replace with stable pickup signal.
      await this.page.waitForTimeout(50);
      return true;
    } catch (err) {
      scopedLogger.warn(`${label} fill failed: ${errorName(err)}`);
      return false;
    }
  }

  private async fillTextFields(options: PickupDialogOptions, dialog: Locator): Promise<void> {
    await this.fillByLabelInDialog(
      dialog,
      /first name|prénom|prenom|名|お名前/i,
      options.firstName,
      'First name'
    );
    await this.fillByLabelInDialog(
      dialog,
      /last name|nom de famille|^nom$|姓|苗字/i,
      options.lastName,
      'Last name'
    );

    const addressLocator = dialog
      .locator(
        '#billingAddressOne, input[id*="addressOne" i], input[name*="addressOne" i], input[id*="address1" i], input[name*="address1" i]'
      )
      .first();
    try {
      if (await addressLocator.isVisible({ timeout: 800 }).catch(() => false)) {
        await setNativeValue(addressLocator, options.address);
        // Do NOT echo the address in the log — potential PII.
        scopedLogger.success('Street/Home address set via native helper');
      }
    } catch (e) {
      scopedLogger.warn(`Address set failed: ${errorName(e)}`);
    }
    // TODO Sprint 5: replace with stable pickup signal.
    await this.page.waitForTimeout(50);

    await this.fillByLabelInDialog(
      dialog,
      /suburb|^city$|town|district|ville|市|区|町/i,
      options.city,
      'City/Suburb/District'
    );
  }

  private async fillKatakanaFields(options: PickupDialogOptions, dialog: Locator): Promise<void> {
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
    scopedLogger.success('Katakana names set via native helper');
    // TODO Sprint 5: replace with stable pickup signal.
    await this.page.waitForTimeout(50);
  }

  private async fillPhoneFields(options: PickupDialogOptions, dialog: Locator): Promise<void> {
    if (options.phonePrefix) {
      const prefixSelect = dialog.getByRole('combobox', { name: /country code|prefix/i }).first();
      try {
        await prefixSelect.waitFor({ state: 'visible', timeout: TIMEOUTS.short });
        await prefixSelect.selectOption(options.phonePrefix);
        scopedLogger.success(`Phone prefix selected: ${options.phonePrefix}`);
      } catch {
        scopedLogger.info('Phone prefix select not present in pickup dialog');
      }
    }

    const phoneTb = dialog
      .locator('#billingPhoneNumber, input[name="dwfrm_billing_addressFields_phone"]')
      .first();
    try {
      await phoneTb.waitFor({ state: 'visible', timeout: TIMEOUTS.element });
      await phoneTb.scrollIntoViewIfNeeded().catch(this.swallowOptional('phoneTb scrollIntoView'));
      await phoneTb.click({ timeout: TIMEOUTS.short }).catch(this.swallowOptional('phoneTb focus click'));
      await phoneTb.fill('').catch(this.swallowOptional('phoneTb pre-clear'));
      await phoneTb.fill(options.phone);
      let filled = await phoneTb.inputValue().catch(() => '');
      if (!filled) {
        await phoneTb.type(options.phone, { delay: 50 });
        filled = await phoneTb.inputValue().catch(() => '');
      }
      await phoneTb.blur().catch(this.swallowOptional('phoneTb post-fill blur'));
      // Sprint 4: previous log echoed the FULL phone number ("Phone number
      // filled: \"...\""). That is PII — replaced with a length-only tag so
      // debugging still confirms the field was set without leaking the value.
      scopedLogger.success(`Phone number filled (length=${filled.length})`);
    } catch (err) {
      scopedLogger.warn(`Phone number fill failed: ${errorName(err)}`);
    }
  }

  private async submitDialog(dialog: Locator): Promise<boolean> {
    const submitLocalized = dialog
      .getByRole('button', {
        name: /submit address|valider.{0,10}adresse|住所|送信|adresse/i,
      })
      .first();
    const submitStructural = dialog
      .locator('button[type="submit"]:visible, button.a-btn--primary:visible')
      .last();

    let submitClicked = false;
    for (const candidate of [submitLocalized, submitStructural]) {
      try {
        await candidate.waitFor({ state: 'visible', timeout: TIMEOUTS.short });
        await candidate.scrollIntoViewIfNeeded().catch(this.swallowOptional('pickup submit candidate scrollIntoView'));
        await candidate.click({ force: true, timeout: TIMEOUTS.medium });
        submitClicked = true;
        break;
      } catch {
        // try next
      }
    }

    if (!submitClicked) {
      scopedLogger.error('Failed to find/click pickup form SUBMIT button');
      return false;
    }
    scopedLogger.success('Pickup form SUBMIT ADDRESS clicked');

    // Verify dialog closed
    try {
      await dialog.waitFor({ state: 'detached', timeout: TIMEOUTS.medium });
    } catch {
      const stillVisible = await dialog.isVisible().catch(() => false);
      if (stillVisible) {
        throw new Error(
          'Pickup dialog is still open after SUBMIT — likely a validation error in the form'
        );
      }
    }

    // Wait for navigation to payment
    await Promise.race([
      this.page.waitForURL(/payment|paiement/, { timeout: TIMEOUTS.navigation }),
      this.continueToPaymentButton.waitFor({ state: 'visible', timeout: TIMEOUTS.navigation }),
    ]).catch(this.swallowOptional('pickup submit → payment transition'));

    return true;
  }

  /**
   * Sprint 3 pattern reused verbatim — returns a catch handler that logs
   * failure at debug level with the given `label` context. Never rethrows.
   */
  private swallowOptional(label: string): (err: unknown) => void {
    return (err) => {
      scopedLogger.debug(`${label} skipped: ${errorName(err)}`);
    };
  }
}
