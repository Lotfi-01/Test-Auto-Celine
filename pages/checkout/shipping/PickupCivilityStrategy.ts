import { Locator } from '@playwright/test';
import { forceCheckRadio } from '../../../utils/formHelper';
import { TestLogger } from '../../../utils/logger';
import { CivilitySelector, civilityTokens } from './CivilitySelector';

/**
 * Sprint 5 — extracted from `PickupDialogHandler.selectCivilityInDialog`.
 * Behavior preserved 1:1: same 3 in-dialog strategies (A/B/C), same fallback
 * to the shared `CivilitySelector`, same event dispatch order via
 * `forceCheckRadio`. No new selector, no new `force: true`, no new
 * `evaluate()`, no silent catch.
 *
 * Duplication removed: the previous inline `titleAcceptable` closure was a
 * 12-line copy of `CivilitySelector.civilityTokens` — Sprint 5 re-uses the
 * unit-tested pure helper instead. Behavior contract on the token list is
 * unchanged (same tokens, same order, same fallback list).
 *
 * PII policy: log messages carry only the technical `token` (e.g. `mr`, `mme`)
 * or the label text pulled from the DOM at debug/warn level. Errors are
 * logged as `error.name` only (per Sprint 4 rule) — never `error.message`
 * nor `String(error)`.
 */

const scopedLogger = TestLogger.scoped('PickupCivility');

function errorName(err: unknown): string {
  return err instanceof Error && err.name ? err.name : 'UnknownError';
}

/**
 * PURE — describes which sequential in-dialog strategy is currently in play,
 * matching the previous inline Strategy A / B / C / D comments. Exported so
 * the unit tests can pin the label list without depending on the class
 * (which needs a real Playwright dialog).
 */
export const PICKUP_CIVILITY_STRATEGIES = [
  'role+name', // Strategy A — dialog.getByRole('radio', {name})
  'label text', // Strategy B — dialog.locator('label').filter({hasText})
  'dialog scan', // Strategy C — dialog.locator('input[type="radio"]').nth()
  'fallback helper', // Strategy D — CivilitySelector.select() page-wide
] as const;

export type PickupCivilityStrategyName = (typeof PICKUP_CIVILITY_STRATEGIES)[number];

export class PickupCivilityStrategy {
  constructor(private readonly civilitySelector: CivilitySelector) {}

  /**
   * Select the civility radio inside a pickup purchaser dialog.
   *
   * Strategy order (short-circuits on first success):
   *  A. `dialog.getByRole('radio', {name})` — best for modern a11y.
   *  B. `dialog.locator('label').filter({hasText})` + associated input.
   *  C. Full scan of `dialog.locator('input[type="radio"]')` items.
   *  D. Fallback to the shared `CivilitySelector.select()` page-wide helper
   *     (which itself has 3 strategies — see `CivilitySelector.ts`).
   *
   * Returns nothing (matches the previous void signature). Failure is
   * reported via `warn` log — the caller decides how to proceed (the
   * previous code continued the fill even if civility could not be
   * selected).
   */
  async select(dialog: Locator, title: string): Promise<void> {
    const acceptable = civilityTokens(title);
    let selected = false;

    try {
      // ----- Strategy A: role + accessible name inside dialog -----
      for (const token of acceptable) {
        const radioByRole = dialog.getByRole('radio', { name: new RegExp(token, 'i') }).first();
        if (await radioByRole.isVisible({ timeout: 300 }).catch(() => false)) {
          await forceCheckRadio(radioByRole);
          scopedLogger.success(`Civility radio checked (role+name): ${token}`);
          selected = true;
          break;
        }
      }

      // ----- Strategy B: label text match + associated input -----
      if (!selected) {
        for (const token of acceptable) {
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

      // ----- Strategy C: broad in-dialog radio scan -----
      if (!selected) {
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
          if (acceptable.some((tok) => lowerLabel.includes(tok))) {
            await forceCheckRadio(radio);
            scopedLogger.success(
              `Civility radio checked (dialog scan): ${labelText.trim() || val || id}`
            );
            selected = true;
            break;
          }
        }
      }

      // ----- Strategy D: fallback to shared CivilitySelector -----
      if (!selected) {
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

    // Sprint 3 note (preserved): `waitForTimeout(60)` was removed here —
    // `forceCheckRadio` dispatches `input`/`change`/`click` synchronously,
    // so the check state is committed before this returns. The caller
    // `PickupDialogHandler.fillDialog` immediately reads the postcode
    // field via `isVisible({ timeout: 800 })`, which is itself a proper
    // web-first wait for any re-render triggered by the civility change.
  }
}
