import { Page, Locator } from '@playwright/test';
import { TestLogger } from '../../../utils/logger';

/**
 * Sprint 15 — extracted from `PickupDialogHandler.selectStateInDialog`.
 * Behavior preserved 1:1: same selectors, same 3-candidate fallback
 * (fullName → raw code → uppercase code), same `page.evaluate`-based
 * select finder, same post-select `blur` dispatch, same
 * `waitForTimeout(150)` marker, same fail-open semantics on unrecoverable
 * states.
 *
 * The extracted selector does NOT import `PickupDialogHandler`. It
 * receives only a `Page` in the constructor and reuses the pure
 * `pickupStateLabelFor` label map (also moved here from the handler and
 * re-exported by the handler for backwards compatibility with the
 * existing unit-test spec).
 *
 * Logs use `TestLogger.scoped('PickupState')` — same message content as
 * the previous `[PickupDialog]` logs, only the component prefix changes
 * for clarity (Sprint 4/12/13/14 pattern).
 *
 * PII policy (Sprint 15 hardening): the pre-Sprint-15 flow logged the
 * raw `state` code in `State selected first: ${state}` and
 * `Could not select state: ${state}`. Even a region code (`NSW`, `CA`,
 * `VIC`) is a form-value derived from user input — Sprint 15 replaces
 * both interpolations with static labels (same pattern as the Sprint 7
 * hotfix 2 for `AddressFormFiller.selectStateOrPrefecture`). Behavior
 * unchanged — the caller receives the same void return and no exception
 * is thrown from either branch. Errors surface via `error.name` only.
 */

/**
 * Full-name map for pickup state selection. Preserved verbatim from the
 * Sprint 4 extraction — do NOT change the key/value shapes without
 * updating the `pickupStateLabelFor` unit tests.
 */
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
 * pickup dialog `<option>` labels. Preserved 1:1 from the Sprint 4
 * extraction (which itself came from the original inline `labelMap` in
 * `CheckoutShippingPage.selectStateInDialog`):
 *
 *   const fullName = labelMap[state.toUpperCase()] || state;
 *
 * Behavior contract (unchanged):
 *  - Case-insensitive lookup: `nsw` → `NEW SOUTH WALES`.
 *  - Unknown codes are returned unchanged so the caller can attempt the
 *    raw input against the DOM as a last resort.
 *  - Empty string / falsy inputs pass through via `|| state` — matches
 *    the previous coercion exactly (`''` is falsy, so the fallback
 *    returns `''`).
 */
export function pickupStateLabelFor(state: string): string {
  return STATE_LABEL_MAP[state.toUpperCase()] || state;
}

const scopedLogger = TestLogger.scoped('PickupState');

function errorName(err: unknown): string {
  return err instanceof Error && err.name ? err.name : 'UnknownError';
}

/**
 * Sprint 8-style fail-open catch handler. Never rethrows; logs at
 * `debug` with a static technical label. Labels MUST be string literals
 * — never derived from the raw state code, option value, or any
 * form-value.
 */
function swallowOptional(label: string): (err: unknown) => void {
  return (err) => {
    scopedLogger.debug(`Optional pickup state step failed: ${label} (${errorName(err)})`);
  };
}

export class PickupStateSelector {
  constructor(private readonly page: Page) {}

  /**
   * Select the state/province/prefecture option in the Pickup dialog.
   *
   * Strategy (preserved 1:1 from Sprint 4 extraction):
   *  1. Resolve `fullName` via `pickupStateLabelFor(state)`.
   *  2. Run a page-wide `evaluate` to find a `<select>` whose options
   *     contain either the full name or the raw code (case-insensitive).
   *  3. Prefer the select located INSIDE the dialog if present; otherwise
   *     fall back to the page-wide match.
   *  4. Try 3 candidate labels in order: `fullName`, raw `state`,
   *     uppercase `state`. Each candidate is tried first via
   *     `selectOption({ label })`, then via bare `selectOption(candidate)`.
   *  5. Dispatch `blur` post-select (swallowed if it fails).
   *  6. Sleep 150 ms to let Celine's re-render complete (Sprint 5 TODO
   *     marker preserved — moved 1:1).
   *
   * Fail-open: no exception is thrown from any branch. The caller
   * (`PickupDialogHandler.fillDialog`) checks nothing after this returns
   * and proceeds to the next step regardless. Signature returns `void`.
   */
  async select(state: string, dialog: Locator): Promise<void> {
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
        .catch(swallowOptional('state select post-select blur dispatch'));
      if (selected) {
        // Sprint 15: previous log echoed the raw `${state}` code. Even
        // region codes (NSW, CA, VIC) are form-values — Sprint 7 hotfix 2
        // established that pattern for AddressFormFiller and it applies
        // here too. Emit a static label instead.
        scopedLogger.success('State selected');
        // TODO Sprint 5: replace with stable pickup signal.
        await this.page.waitForTimeout(150);
      } else {
        // Sprint 15: same PII neutralization as above — no raw state code
        // in the log stream.
        scopedLogger.warn('Could not select state');
      }
    } else {
      scopedLogger.warn('State select not found page-wide');
    }
  }
}
