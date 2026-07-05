import { Page, Locator } from '@playwright/test';
import { TIMEOUTS } from '../../../config/testConfig';
import { TestLogger } from '../../../utils/logger';

/**
 * Sprint 16 — extracted from `PickupDialogHandler.fillByLabelInDialog`.
 * Behavior preserved 1:1: same 2-strategy resolution (accessible role
 * + name → common id/name patterns), same `pressSequentially` with
 * 50 ms delay, same `blur` dispatch, same `waitForTimeout(50)` post-fill
 * marker, same fail-open semantics (returns `false` when no field can be
 * located, returns `false` on any exception during fill).
 *
 * The extracted filler does NOT import `PickupDialogHandler`. It receives
 * only a `Page` in the constructor and reimplements the tiny
 * `swallowOptional` catch handler locally (same pattern as Sprint 6/7/15
 * — no inheritance dependency, PII-safe `errorName` instead of the
 * Sprint 3 `.message` shape used on the parent class).
 *
 * Logs use `TestLogger.scoped('PickupField')` — the message content is
 * identical to the previous `[PickupDialog]` logs, only the component
 * prefix changes for clarity.
 *
 * PII policy: the `label` parameter is a static, technical field-name
 * string passed by the caller (`'First name'`, `'Last name'`,
 * `'City/Suburb/District'`) — never a user value. Log strings compose
 * this static label into a technical template. Errors surface via
 * `error.name` only — never `.message`, never `String(error)`, never
 * `JSON.stringify(error)`. The raw `value` argument (which may be
 * firstName / lastName / city derived from `options.*`) is NEVER
 * echoed into any log; the success log only carries `${label} filled`.
 */

const scopedLogger = TestLogger.scoped('PickupField');

function errorName(err: unknown): string {
  return err instanceof Error && err.name ? err.name : 'UnknownError';
}

/**
 * Sprint 8-style fail-open catch handler adapted for `PickupField`.
 * Never rethrows; logs at `debug` with the technical label. The label
 * comes from a template combining the static caller-supplied label
 * (e.g. `'First name'`) with a static step name (e.g. `'tb scrollIntoView'`)
 * — no user value is interpolated.
 */
function swallowOptional(label: string): (err: unknown) => void {
  return (err) => {
    scopedLogger.debug(`Optional pickup field step failed: ${label} (${errorName(err)})`);
  };
}

export class PickupDialogFieldFiller {
  constructor(private readonly page: Page) {}

  /**
   * Fill a text field inside the Pickup purchaser dialog by label.
   *
   * Strategy (preserved 1:1 from Sprint 4 extraction):
   *  1. Accessible role + name (`dialog.getByRole('textbox', { name })`)
   *     — iterate over matches, take the first visible one.
   *  2. Common id/name patterns (firstName / lastName / addressOne /
   *     address1 / city / postal / zip / phone). Accept a candidate only
   *     when either the id/name matches the regex OR the label carries
   *     one of the recognised field-name tokens (first / last / city /
   *     address).
   *
   * On success: `pressSequentially` with 50 ms per-key delay + blur,
   * followed by a 50 ms `waitForTimeout` pad. Returns `true` when the
   * field was located and no exception was thrown during fill; `false`
   * otherwise.
   *
   * Public entry point — same contract as the previous private
   * `PickupDialogHandler.fillByLabelInDialog`.
   */
  async fillByLabel(
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
      await tb.scrollIntoViewIfNeeded().catch(swallowOptional(`${label} tb scrollIntoView`));
      await tb.click({ timeout: TIMEOUTS.short }).catch(swallowOptional(`${label} tb focus click`));
      await tb.fill('').catch(swallowOptional(`${label} tb pre-clear`));
      await tb.pressSequentially(value, { delay: 50 });
      await tb.blur().catch(swallowOptional(`${label} tb post-fill blur`));
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
}
