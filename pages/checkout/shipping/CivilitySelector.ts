import { Page, Locator } from '@playwright/test';
import { SELECTORS } from '../../selectors';
import { TIMEOUTS } from '../../../config/testConfig';
import { forceCheckRadio } from '../../../utils/formHelper';
import { TestLogger } from '../../../utils/logger';

/**
 * Sprint 3 — extracted from `CheckoutShippingPage._selectCivilityRobust`.
 * Behavior preserved 1:1: same selectors, same 3 fallback strategies, same
 * event dispatch order. Any behavior change here MUST be justified in the PR.
 *
 * The evaluate()-based broad scan (Strategy 3) was already present in
 * CheckoutShippingPage; it is moved as-is (no new evaluate() introduced).
 */

const TITLE_INPUT_MAP: Record<string, string> = {
  Mr: SELECTORS.CHECKOUT.SHIPPING.TITLE_MR_INPUT,
  M: SELECTORS.CHECKOUT.SHIPPING.TITLE_MR_INPUT,
  Mrs: SELECTORS.CHECKOUT.SHIPPING.TITLE_MRS_INPUT,
  Mme: SELECTORS.CHECKOUT.SHIPPING.TITLE_MRS_INPUT,
  Ms: SELECTORS.CHECKOUT.SHIPPING.TITLE_MS_INPUT,
  Mlle: SELECTORS.CHECKOUT.SHIPPING.TITLE_MS_INPUT,
};

const TITLE_LABEL_MAP: Record<string, string> = {
  Mr: SELECTORS.CHECKOUT.SHIPPING.TITLE_MR_LABEL,
  M: SELECTORS.CHECKOUT.SHIPPING.TITLE_MR_LABEL,
  Mrs: SELECTORS.CHECKOUT.SHIPPING.TITLE_MRS_LABEL,
  Mme: SELECTORS.CHECKOUT.SHIPPING.TITLE_MRS_LABEL,
  Ms: SELECTORS.CHECKOUT.SHIPPING.TITLE_MS_LABEL,
  Mlle: SELECTORS.CHECKOUT.SHIPPING.TITLE_MS_LABEL,
};

const DEFAULT_TOKENS = ['mr', 'm', 'mrs', 'mme', 'ms', 'mlle'];

/**
 * PURE — returns the ordered list of label tokens acceptable for a given
 * civility. Order matters: preferred token first, then localized/international
 * variants. Unknown titles fall back to a broad list.
 */
export function civilityTokens(title: string): string[] {
  const t = (title || '').toLowerCase();
  const variants: Record<string, string[]> = {
    mr: ['mr', 'm', 'mr.'],
    m: ['m', 'mr', 'mr.'],
    mrs: ['mrs', 'mme', 'mrs.'],
    mme: ['mme', 'mrs', 'mrs.'],
    ms: ['ms', 'mlle', 'miss', 'ms.'],
    mlle: ['mlle', 'ms', 'miss', 'ms.'],
  };
  return variants[t] || [...DEFAULT_TOKENS];
}

/**
 * PURE — returns the exact input/label selector pair for a known title,
 * or null when the title is not recognized (Strategy 1 will be skipped).
 */
export function civilitySelectorsFor(title: string): { input: string; label: string } | null {
  const input = TITLE_INPUT_MAP[title];
  const label = TITLE_LABEL_MAP[title];
  if (!input || !label) return null;
  return { input, label };
}

const scopedLogger = TestLogger.scoped('CivilitySelector');

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class CivilitySelector {
  constructor(private readonly page: Page) {}

  /**
   * Robust civility selection with 3 fallback strategies:
   *  1. Specific input/label selectors (from `SELECTORS.CHECKOUT.SHIPPING.TITLE_*`).
   *  2. Label text match — case-insensitive, tolerates "MR.", "Mr", "M." etc.
   *  3. Broad `page.evaluate()` scan across all radios whose `name`/`id` looks
   *     like a title/civility.
   *
   * @param title - civility to select (Mr/Mrs/Ms/M/Mme/Mlle)
   * @param scope - optional scope (side-panel or dialog); defaults to full page
   * @returns `true` if a matching radio was checked, `false` otherwise
   */
  async select(title: string, scope: Locator | Page = this.page): Promise<boolean> {
    // ----- Strategy 1: exact selectors from SELECTORS map -----
    const specific = civilitySelectorsFor(title);
    if (specific) {
      const input = scope.locator(specific.input).first();
      let clicked = await this.tryClick(input, { timeout: TIMEOUTS.short, force: true });

      if (!clicked) {
        const label = scope.locator(specific.label).first();
        clicked = await this.tryClick(label, { timeout: TIMEOUTS.medium });
      }

      if (!clicked) {
        try {
          await forceCheckRadio(input);
          clicked = true;
        } catch (err) {
          scopedLogger.debug(`forceCheckRadio (Strategy 1) skipped: ${errorMessage(err)}`);
        }
      }

      if (clicked) return true;
    }

    // ----- Strategy 2: label text match -----
    const acceptable = civilityTokens(title);
    for (const token of acceptable) {
      const byLabel = scope
        .locator(`label:has-text("${token}"), label[for*="${token}"]`)
        .first();
      const visible = await byLabel.isVisible({ timeout: 400 }).catch(() => false);
      if (!visible) continue;

      const forAttr = (await byLabel.getAttribute('for').catch(() => '')) || '';
      const input = scope
        .locator(`input#${forAttr.replace(/"/g, '\\"')}, input[type="radio"]`)
        .first();
      try {
        await forceCheckRadio(input);
        return true;
      } catch (err) {
        scopedLogger.debug(
          `forceCheckRadio (Strategy 2, token="${token}") skipped: ${errorMessage(err)}`
        );
      }
    }

    // ----- Strategy 3: broad page-scope radio scan (moved from CheckoutShippingPage) -----
    try {
      const result = await this.page
        .evaluate(
          ({ acceptable: acc }: { acceptable: string[] }) => {
            const isVisible = (el: HTMLElement) => {
              const cs = window.getComputedStyle(el);
              return cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetParent !== null;
            };

            const radios = Array.from(
              document.querySelectorAll('input[type="radio"]')
            ) as HTMLInputElement[];
            const titleRadios = radios.filter(
              (r) =>
                /title/i.test(r.name) ||
                /title/i.test(r.id) ||
                /civility/i.test(r.name) ||
                /civility/i.test(r.id)
            );

            const visibleRadios = titleRadios.filter(isVisible);
            const candidates = visibleRadios.length ? visibleRadios : titleRadios;

            const norm = (s: string) => s.toLowerCase().replace(/\./g, '').trim();

            const findRadio = (token: string) =>
              candidates.find((r) => {
                const labelText =
                  (r.labels && r.labels[0]?.textContent) ||
                  r.getAttribute('aria-label') ||
                  r.value ||
                  '';
                return (
                  norm(labelText).includes(norm(token)) || norm(token).includes(norm(labelText))
                );
              });

            let target: HTMLInputElement | undefined;
            for (const tok of acc) {
              target = findRadio(tok);
              if (target) break;
            }
            if (!target) target = candidates[0];

            if (!target) return { ok: false };

            const proto = Object.getPrototypeOf(target);
            const setter = Object.getOwnPropertyDescriptor(proto, 'checked')?.set;
            if (setter) setter.call(target, true);
            else target.checked = true;

            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.dispatchEvent(new Event('change', { bubbles: true }));
            const label = target.labels?.[0];
            if (label) label.click();
            target.click();

            return { ok: target.checked, matched: (target.labels?.[0]?.textContent || '').trim() };
          },
          { acceptable }
        )
        .catch((err) => {
          scopedLogger.debug(`broad radio scan evaluate() rejected: ${errorMessage(err)}`);
          return { ok: false as const };
        });

      if (result.ok) return true;
    } catch (e) {
      scopedLogger.warn(`Broad title radio search failed: ${errorMessage(e)}`);
    }

    return false;
  }

  /**
   * Mirrors the behavior of `BasePage.safeClick`: scroll into view (optional,
   * non-fatal), then click. Returns `true` on success, `false` on failure.
   * Click failure is logged at `warn` — matching the previous debug trail.
   */
  private async tryClick(
    locator: Locator,
    options: { timeout: number; force?: boolean }
  ): Promise<boolean> {
    await locator.scrollIntoViewIfNeeded().catch((err) => {
      scopedLogger.debug(`scrollIntoViewIfNeeded skipped: ${errorMessage(err)}`);
    });
    try {
      await locator.click({ timeout: options.timeout, force: options.force ?? false });
      return true;
    } catch (err) {
      scopedLogger.warn(`click failed: ${errorMessage(err)}`);
      return false;
    }
  }
}
