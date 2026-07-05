import { Page, Locator } from '@playwright/test';
import { TestLogger } from '../../../utils/logger';

/**
 * Sprint 6 — extracted from `PickupDialogHandler.ensureFieldsBeforeSubmit`.
 * Behavior preserved 1:1: same two `page.evaluate()` calls (snapshot + refill
 * report), same selector lists, same order, same PII-safe log messages, same
 * final padding sleep. No new selector, no new `force: true`, no new
 * `evaluate()`, no silent catch.
 *
 * The outer try/catch of the original method previously used an empty body
 * (silent-catch pattern — kept in the historical debt override for the
 * handler file). In this NEW file it is replaced by a `debug`-level log
 * carrying only `error.name` — same fail-open semantics (does NOT block the
 * caller's submit), same PII policy. See `docs/DEBT.md §1` for the rule.
 *
 * PII policy (Sprint 4/5 rule): log messages never carry field values, phone
 * numbers, addresses, emails, postcodes, first/last names or Katakana names.
 * The snapshot log emits only `id`/`name` for empty fields; the refill report
 * emits only per-label outcome strings prefixed with `id=` — the raw filled
 * value is never included. Errors are logged as `error.name` only (never
 * `error.message`, never `String(error)`, never `JSON.stringify(error)`).
 */

/**
 * Subset of `PickupDialogOptions` that the refill guard actually reads.
 *
 * We intentionally define this locally — not import `PickupDialogOptions`
 * from `PickupDialogHandler` — so this file has NO dependency on the
 * handler (per Sprint 6 rule: `PickupRefillGuard` must not import
 * `PickupDialogHandler`). The handler's `PickupDialogOptions` is
 * structurally assignable to this type; excess properties on the source
 * object (`title`, `state`, `phonePrefix`) are ignored per TypeScript's
 * width subtyping.
 */
export interface PickupRefillFields {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  postalCode: string;
  phone: string;
  firstNameKatakana?: string;
  lastNameKatakana?: string;
}

const scopedLogger = TestLogger.scoped('PickupRefillGuard');

/**
 * PII-safe error tag for logs.
 *
 * Duplicated verbatim from `PickupDialogHandler` — deliberately not exported
 * from the handler to keep this file free of any dependency on it (no risk
 * of a cycle if the handler ever imports symbols from here). `error.name`
 * gives enough triage signal (`TimeoutError`, `Error`) while carrying no
 * value.
 */
function errorName(err: unknown): string {
  return err instanceof Error && err.name ? err.name : 'UnknownError';
}

export class PickupRefillGuard {
  constructor(private readonly page: Page) {}

  /**
   * Belt-and-suspenders pass before submitting the pickup dialog.
   *
   *  1. Snapshot visible inputs/selects in the dialog and log the id/name
   *     of any empty text/tel/email field (PII-safe — no values echoed).
   *  2. Run a page-wide refill via native prototype setter for every field
   *     mapped by selector list; emit an outcome-only report per label.
   *
   * A failure at any step here does NOT block the caller's SUBMIT. The
   * outer catch degrades to a `debug` log — same "best-effort" semantics
   * as the original silent catch, but compliant with `no-empty` in a new
   * file (see class-level comment).
   */
  async ensureFields(options: PickupRefillFields, dialog: Locator): Promise<void> {
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
      // TODO Sprint 7: replace with stable pickup signal.
      await this.page.waitForTimeout(100);
    } catch (err) {
      // Fail-open — a failure here does NOT block the caller's submit.
      // Sprint 6: converted from a silent empty catch (which was tolerated
      // in the handler under the historical override) to a `debug` log
      // carrying only `error.name`. Same semantics, PII-safe.
      scopedLogger.debug(`Refill guard best-effort skipped: ${errorName(err)}`);
    }
  }
}
