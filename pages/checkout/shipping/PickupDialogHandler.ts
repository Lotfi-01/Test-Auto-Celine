import { Page, Locator } from '@playwright/test';
import { TIMEOUTS } from '../../../config/testConfig';
import { forceCheckRadio, setNativeValue } from '../../../utils/formHelper';
import { TestLogger } from '../../../utils/logger';
import { CivilitySelector } from './CivilitySelector';

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

const STATE_LABEL_MAP: Record<string, string> = {
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

/**
 * PURE — maps a state code (AU or US) to the full name used in the Celine
 * pickup dialog `<option>` labels. Preserved 1:1 from the previous inline
 * `labelMap` in `CheckoutShippingPage.selectStateInDialog`:
 *
 *   const fullName = labelMap[state.toUpperCase()] || state;
 *
 * Behavior contract (unchanged):
 *  - Case-insensitive lookup: `nsw` → `NEW SOUTH WALES`.
 *  - Unknown codes are returned unchanged so the caller can attempt the
 *    raw input against the DOM as a last resort.
 *  - Empty string / falsy inputs pass through via `|| state` — matches the
 *    previous coercion exactly (`''` is falsy, so the fallback returns `''`).
 */
export function pickupStateLabelFor(state: string): string {
  return STATE_LABEL_MAP[state.toUpperCase()] || state;
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
  constructor(
    private readonly page: Page,
    private readonly civilitySelector: CivilitySelector,
    private readonly continueToPaymentButton: Locator
  ) {}

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

    await this.selectCivilityInDialog(options.title, dialog);

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

    await this.ensureFieldsBeforeSubmit(options, dialog);

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

  private async selectStateInDialog(state: string, dialog: Locator): Promise<void> {
    const fullName = pickupStateLabelFor(state);

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
          } catch {
            /* try next candidate */
          }
        }
      }
      await stateSelect
        .evaluate((el) => (el as HTMLSelectElement).dispatchEvent(new Event('blur', { bubbles: true })))
        .catch(this.swallowOptional('state select post-select blur dispatch'));
      if (selected) {
        scopedLogger.success(`State selected first: ${state}`);
        // TODO Sprint 5: replace with stable pickup signal.
        await this.page.waitForTimeout(150);
      } else {
        scopedLogger.warn(`Could not select state: ${state}`);
      }
    } else {
      scopedLogger.warn('State select not found page-wide');
    }
  }

  private async selectCivilityInDialog(title: string, dialog: Locator): Promise<void> {
    const titleAcceptable = ((): string[] => {
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
          scopedLogger.success(`Civility radio checked (role+name): ${token}`);
          selected = true;
          break;
        }
      }

      if (!selected) {
        // Strategy B: Find label by text inside dialog, then associated input
        for (const token of titleAcceptable) {
          const label = dialog
            .locator('label')
            .filter({ hasText: new RegExp(token, 'i') })
            .first();
          if (await label.isVisible({ timeout: 300 }).catch(() => false)) {
            const forId = await label.getAttribute('for').catch(() => null);
            let radio: Locator;
            if (forId) {
              radio = dialog.locator(`#${forId.replace(/"/g, '\\"')}`);
            } else {
              // fallback to sibling or descendant radio
              radio = label
                .locator(
                  'xpath=preceding-sibling::input[1] | xpath=following-sibling::input[1] | input[type="radio"]'
                )
                .first();
            }
            if (
              (await radio.count()) > 0 &&
              (await radio.isVisible({ timeout: 200 }).catch(() => false))
            ) {
              await forceCheckRadio(radio);
              scopedLogger.success(`Civility radio checked (label text): ${token}`);
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
          const val = ((await radio.getAttribute('value').catch(() => '')) || '').toLowerCase();
          let labelText = '';
          if (id) {
            labelText =
              (await dialog
                .locator(`label[for="${id}"]`)
                .textContent()
                .catch(() => '')) || '';
          }
          if (!labelText) {
            labelText = (await radio.getAttribute('aria-label').catch(() => '')) || '';
          }
          const lowerLabel = (labelText + ' ' + val + ' ' + id).toLowerCase().replace(/\./g, '');
          if (titleAcceptable.some((tok) => lowerLabel.includes(tok))) {
            await forceCheckRadio(radio);
            scopedLogger.success(
              `Civility radio checked (dialog scan): ${labelText.trim() || val || id}`
            );
            selected = true;
            break;
          }
        }
      }

      if (!selected) {
        // Fallback to the broad robust helper (page level)
        selected = await this.civilitySelector.select(title, dialog);
        if (selected) {
          scopedLogger.success(`Civility radio checked (fallback helper): ${title}`);
        }
      }
    } catch (e) {
      scopedLogger.warn(`Civility selection error in dialog: ${errorName(e)}`);
    }

    if (!selected) {
      scopedLogger.warn('Could not reliably select civility title');
    }

    // Sprint 3: `waitForTimeout(60)` removed — `forceCheckRadio` dispatches
    // `input`/`change`/`click` synchronously, so the check state is committed
    // before this returns. The caller immediately reads the postcode field
    // via `isVisible({ timeout: 800 })`, which is itself a proper web-first
    // wait for any re-render triggered by the civility change.
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

  private async ensureFieldsBeforeSubmit(
    options: PickupDialogOptions,
    dialog: Locator
  ): Promise<void> {
    try {
      const snapshot = await dialog
        .evaluate((root) => {
          const inputs = Array.from(root.querySelectorAll('input, select')) as (
            | HTMLInputElement
            | HTMLSelectElement
          )[];
          return inputs
            .filter((el) => {
              const cs = window.getComputedStyle(el);
              return (
                cs.display !== 'none' &&
                cs.visibility !== 'hidden' &&
                (el as HTMLElement).offsetParent !== null
              );
            })
            .map((el) => ({
              tag: el.tagName,
              type: (el as HTMLInputElement).type || '',
              id: el.id,
              name: el.name,
              hasValue: !!el.value,
            }));
        })
        .catch(
          () =>
            [] as Array<{ tag: string; type: string; id: string; name: string; hasValue: boolean }>
        );

      // Sprint 4: previous version reported the RAW values of empty fields
      // via `snapshot.map(f => ({..., value: f.value}))`. That could leak
      // filled-but-not-committed PII into the log if a race left content in
      // an "empty"-flagged field. We now report id/name only.
      const empties = snapshot.filter(
        (f) => f.tag === 'INPUT' && /text|tel|email/.test(f.type) && !f.hasValue
      );
      if (empties.length) {
        scopedLogger.warn(
          `Pre-submit empty fields detected: ${empties.map((e) => e.id || e.name).join(', ')}`
        );
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
            {
              sel: 'input[id*="firstName" i]:not([id*="Alternate" i]), input[name*="firstName" i]:not([name*="Alternate" i])',
              val: data.firstName,
              label: 'firstName',
            },
            {
              sel: 'input[id*="lastName" i]:not([id*="Alternate" i]), input[name*="lastName" i]:not([name*="Alternate" i])',
              val: data.lastName,
              label: 'lastName',
            },
            {
              sel: 'input[id*="addressOne" i], input[id*="address1" i], input[name*="addressOne" i], input[name*="address1" i]',
              val: data.address,
              label: 'address',
            },
            { sel: 'input[id*="city" i], input[name*="city" i]', val: data.city, label: 'city' },
            {
              sel: 'input[id*="postal" i], input[id*="zip" i], input[name*="postal" i], input[name*="zip" i]',
              val: data.postalCode,
              label: 'postcode',
            },
            {
              sel: '#billingPhoneNumber, input[id*="phone" i], input[name*="phone" i]',
              val: data.phone,
              label: 'phone',
            },
          ];
          if (data.firstNameKatakana)
            fields.push({
              sel: 'input[id*="FirstnameAlternate" i], input[name*="FirstnameAlternate" i], input[id*="firstNameKana" i]',
              val: data.firstNameKatakana,
              label: 'firstNameKana',
            });
          if (data.lastNameKatakana)
            fields.push({
              sel: 'input[id*="LastnameAlternate" i], input[name*="LastnameAlternate" i], input[id*="lastNameKana" i]',
              val: data.lastNameKatakana,
              label: 'lastNameKana',
            });

          const report: Record<string, string> = {};
          for (const f of fields) {
            const el = findVisible(f.sel);
            if (!el) {
              report[f.label] = 'NOT_FOUND';
              continue;
            }
            if (el.value && el.value.trim() === f.val.trim()) {
              report[f.label] = 'OK_ALREADY';
              continue;
            }
            setNative(el, f.val);
            // Sprint 4: previous version emitted `SET="<value>"` — leaked
            // PII (address/phone/name) into logs. We now emit a boolean
            // outcome + the id/name only.
            report[f.label] = `SET id=${el.id || el.name}`;
          }
          return report;
        }, options)
        .catch((err) => ({ error: errorName(err) }));

      scopedLogger.info(`Refill report: ${JSON.stringify(refillReport)}`);
      // TODO Sprint 5: replace with stable pickup signal.
      await this.page.waitForTimeout(100);
    } catch {
      /* best-effort — a failure here does NOT block the submit below. */
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
