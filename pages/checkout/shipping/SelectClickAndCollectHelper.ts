import { Page } from '@playwright/test';
import { TIMEOUTS } from '../../../config/testConfig';
import { TestLogger } from '../../../utils/logger';

/**
 * Sprint 17 — extracted from `CheckoutShippingPage.selectClickAndCollect`.
 * Behavior preserved 1:1: same 3-strategy tab-opening fallback (visible
 * tab click via mouse.move → last-resort click on alternative pickup
 * elements → ultimate JS scan for pickup text), same tab-selection
 * verification with JS-click fallback, same first-store label click +
 * JS force-click fallback, same purchaser-info dialog wait. Same
 * `waitForTimeout` markers (50/500/1000/100 ms), same 5 `page.evaluate`
 * calls, same 1 `force: true` on the alternative pickup click.
 *
 * The extracted helper does NOT import `CheckoutShippingPage`. It
 * receives only a `Page` in the constructor and reimplements the tiny
 * `swallowOptional` catch handler locally (same pattern as Sprint 6/7/15/16
 * — no inheritance dependency, PII-safe `errorName` instead of the
 * Sprint 3 `.message` shape used on the parent class).
 *
 * Logs use `TestLogger.scoped('ClickCollect')`.
 *
 * PII policy: labels are static; no store id / URL / user value is
 * echoed via a template-interpolated log EXCEPT `storeId` (which is a
 * DOM `id` attribute like `r_address_...` — a technical identifier, not
 * user data, preserved 1:1 from the pre-Sprint-17 code). The
 * pre-Sprint-17 `throw new Error(\`PICK-UP tab click failed: ${(err as Error).message}\`)`
 * exposed a raw Playwright error message which can carry selectors,
 * timeouts, or URLs — Sprint 17 replaces it with `errorName(err)` (same
 * Playwright throw semantics, just PII-safe).
 */

const scopedLogger = TestLogger.scoped('ClickCollect');

function errorName(err: unknown): string {
  return err instanceof Error && err.name ? err.name : 'UnknownError';
}

function swallowOptional(label: string): (err: unknown) => void {
  return (err) => {
    scopedLogger.debug(`Optional click-and-collect step failed: ${label} (${errorName(err)})`);
  };
}

export class SelectClickAndCollectHelper {
  constructor(private readonly page: Page) {}

  /**
   * Click & Collect: switch to PICK-UP IN STORE tab — the pickup panel
   * auto-shows nearby stores (no postcode entry required), select the
   * first one, then wait for the purchaser-info dialog to open.
   * Replaces `enterPostalCode + selectFirstShippingMethod` when
   * `deliveryMode === 'pickup'`.
   *
   * Public entry point — same contract as the previous
   * `CheckoutShippingPage.selectClickAndCollect`.
   */
  async select(): Promise<boolean> {
    scopedLogger.step('📝 Selecting PICK-UP IN STORE (Click & Collect)');

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
      await pickupTab.scrollIntoViewIfNeeded().catch(swallowOptional('pickup tab scrollIntoView'));
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
      scopedLogger.success('PICK-UP IN STORE tab clicked');
    } catch (err) {
      // Fallback for cases where tab is not visible (e.g. already selected, registered saved, or UI variation)
      scopedLogger.warn('PICK-UP tab not visible, checking if pickup form is already open...');
      const pickupPanel = this.page.locator('section[data-osidepanel-name*="click"], [id*="pickup"], form:has(input[name*="firstNamePickup"])').first();
      if (await pickupPanel.isVisible({ timeout: 3000 }).catch(() => false)) {
        scopedLogger.success('Pickup form/panel already visible, proceeding without tab click');
      } else {
        // Last resort: try to find and click any pickup related button or label to open the form
        scopedLogger.warn('Trying last resort click for pickup option...');
        const anyPickup = this.page.locator('button:has-text("PICK"), button:has-text("Click & Collect"), label:has-text("PICK-UP"), [data-delivery*="pickup"]').first();
        if (await anyPickup.isVisible({ timeout: 2000 }).catch(() => false)) {
          await anyPickup.click({ force: true }).catch(swallowOptional('pickup fallback force click'));
          // TODO Sprint 5: replace with stable shipping signal.
          await this.page.waitForTimeout(500);
          scopedLogger.success('Clicked alternative pickup element');
        } else {
          // Ultimate fallback: use JS to find and click any element with pickup text
          scopedLogger.warn('Ultimate JS fallback for pickup...');
          await this.page.evaluate(() => {
            const els = Array.from(document.querySelectorAll('button, label, a, div[role="tab"]'));
            const match = els.find(el => /pick.?up|click.?&.?collect/i.test(el.textContent || ''));
            if (match) (match as HTMLElement).click();
          }).catch(swallowOptional('pickup ultimate JS fallback click'));
          // TODO Sprint 5: replace with stable shipping signal.
          await this.page.waitForTimeout(1000);
          // Check again
          if (!(await pickupPanel.isVisible({ timeout: 2000 }).catch(() => false))) {
            // Sprint 17 PII hardening: previous throw embedded `(err as Error).message`
            // which can carry selectors / timeouts / URLs. Emit only `error.name`.
            throw new Error(`PICK-UP tab click failed: ${errorName(err)}`);
          }
          scopedLogger.success('Pickup opened via JS fallback');
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
      scopedLogger.success('PICK-UP IN STORE tab is now selected');
    } catch {
      scopedLogger.warn('Tab still not selected — retrying via direct DOM click + event dispatch');
      await this.page
        .evaluate(() => {
          const tab = document.querySelector('button[aria-controls="panel_pick_up"]') as HTMLButtonElement | null;
          if (!tab) return;
          tab.click();
          tab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        })
        .catch(swallowOptional('pickup tab JS click + dispatch fallback'));
      // TODO Sprint 5: replace with stable shipping signal.
      await this.page.waitForTimeout(100);
      const ok = await isSelected();
      if (ok) {
        scopedLogger.success('PICK-UP tab selected after JS click fallback');
      } else {
        scopedLogger.warn('PICK-UP tab still not selected after fallback');
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
    await firstStoreLabel.scrollIntoViewIfNeeded().catch(swallowOptional('firstStoreLabel scrollIntoView'));

    // Try Playwright click first (natural trusted event). Failure is expected
    // on some UIs where the label click is swallowed; the JS fallback below
    // is the actual invariant.
    await firstStoreLabel.click({ timeout: TIMEOUTS.short }).catch(swallowOptional('firstStoreLabel Playwright click (JS fallback follows)'));

    // Verify the linked radio is now checked; if not, force-click via JS (Celine handler is finicky)
    const isStoreChecked = async () =>
      storeId
        ? this.page.evaluate((id) => {
            const input = document.getElementById(id) as HTMLInputElement | null;
            return !!input && input.checked;
          }, storeId)
        : Promise.resolve(true);

    if (!(await isStoreChecked())) {
      scopedLogger.warn('Store radio not checked after Playwright click — using JS click fallback');
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
        .catch(swallowOptional('store JS click + dispatch fallback'));
    }

    if (await isStoreChecked()) {
      scopedLogger.success(`Store selected (${storeId})`);
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
      scopedLogger.warn('Purchaser-info dialog did not open after store selection');
    }

    return true;
  }
}
