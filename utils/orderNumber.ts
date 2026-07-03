import type { Page } from '@playwright/test';
import { SELECTORS } from '../pages/selectors';
import { TIMEOUTS } from '../config/testConfig';
import { logger } from './logger';

/**
 * Order-number extraction — Sprint 2 hardening.
 *
 * Problem being fixed (see `docs/DEBT.md` §1 / CODE_REVIEW.md §F-R5):
 *   The pre-Sprint-2 test extracted the order number by scanning
 *   `document.body.textContent` for `#XYZ...`. That matched any stray token
 *   in the page (footer anchors, analytics IDs, unrelated `#` fragments).
 *   The code even acknowledged the false-positive risk on the Afterpay page.
 *
 * Sprint 2 policy:
 *   - Use TARGETED locators from `SELECTORS.CHECKOUT.CONFIRMATION.ORDER_NUMBER`.
 *   - Apply the shared regex only to text extracted from those locators.
 *   - `extractOrderNumberFromText()` is pure and unit-tested (see
 *     `tests/unit/orderNumber.spec.ts`) — no browser needed.
 *   - `findOrderNumberOnConfirmationPage()` orchestrates the locator sweep
 *     with a small fallback to a scoped confirmation container. The
 *     unrestricted body-scan is no longer part of the validation path.
 */

/**
 * Pure helper — pull an order number out of a piece of text.
 *
 * The regex `#([A-Z0-9]+(?:-\d+)?)` matches:
 *   - `#ABC123`     → `ABC123`
 *   - `#ABC123-45`  → `ABC123-45`
 *
 * Constraints enforced beyond the raw regex to reduce false positives:
 *   - The captured code must contain at least one digit AND at least one
 *     letter. Rules out things like `#TOP`, `#123`, or `#-42`.
 *   - The captured code must be at least 4 characters long.
 *   - When the text contains multiple `#` matches, the LONGEST candidate is
 *     preferred (real order numbers are always longer than accidental
 *     anchors like `#Top` or `#nav`).
 *
 * @param text  Arbitrary text (from an element's textContent).
 * @returns     The extracted order number, or `null` when nothing valid is found.
 */
export function extractOrderNumberFromText(text: string | null | undefined): string | null {
  if (typeof text !== 'string' || text.length === 0) return null;

  const pattern = new RegExp(SELECTORS.CHECKOUT.CONFIRMATION.ORDER_NUMBER_PATTERN.source, 'g');
  const candidates: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1];
    if (isLikelyOrderNumber(raw)) candidates.push(raw);
  }

  if (candidates.length === 0) return null;

  // Prefer the longest candidate — real order numbers are longer than
  // accidental anchor targets. Ties are broken by first-seen (stable order).
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

function isLikelyOrderNumber(raw: string): boolean {
  if (raw.length < 4) return false;
  if (!/[A-Z]/.test(raw)) return false;
  if (!/\d/.test(raw)) return false;
  return true;
}

/**
 * Locator-first order-number lookup on the confirmation page.
 *
 * Strategy (short-circuits on first success):
 *   1. Poll the primary `SELECTORS.CHECKOUT.CONFIRMATION.ORDER_NUMBER` locator.
 *   2. Poll the confirmation `TITLE` locator (h2.f-title / "Thank you…" / "Merci…").
 *   3. Fall back to a scoped confirmation-block container — NOT `body`.
 *
 * The regex is applied to the extracted text of each locator only. No global
 * body scan participates in the validation path.
 *
 * @param page          Playwright page currently on the confirmation URL.
 * @param options       `timeoutMs` caps total time; `pollIntervalMs` the retry cadence.
 * @throws              Explicit error listing every locator attempted when
 *                      nothing matches inside the timeout — surfaces the
 *                      confirmation-page shape change to the failing test.
 */
export async function findOrderNumberOnConfirmationPage(
  page: Page,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? TIMEOUTS.long;
  const pollIntervalMs = options.pollIntervalMs ?? 250;

  // Scoped fallback: a container that holds the confirmation copy, but is
  // NOT `document.body`. Using the outer heading area is enough to defeat
  // the analytics/footer noise the previous body-scan pulled in.
  const scopedFallbackSelector = 'main, [class*="order-confirm" i], [class*="confirmation" i]';

  const locators = [
    { name: 'CONFIRMATION.ORDER_NUMBER', selector: SELECTORS.CHECKOUT.CONFIRMATION.ORDER_NUMBER },
    { name: 'CONFIRMATION.TITLE', selector: SELECTORS.CHECKOUT.CONFIRMATION.TITLE },
    { name: 'scoped-fallback', selector: scopedFallbackSelector },
  ];

  const deadline = Date.now() + timeoutMs;
  let lastAttempted: string[] = [];

  while (Date.now() < deadline) {
    lastAttempted = [];
    for (const { name, selector } of locators) {
      lastAttempted.push(name);
      const candidateText = await extractTextFromFirstMatch(page, selector);
      if (candidateText === null) continue;

      const orderNumber = extractOrderNumberFromText(candidateText);
      if (orderNumber) {
        logger.debug(`[OrderNumber] Extracted via ${name}`);
        return orderNumber;
      }
    }
    await page.waitForTimeout(pollIntervalMs);
  }

  throw new Error(
    `Order number not found on confirmation page after ${timeoutMs}ms. ` +
      `Locators tried: ${lastAttempted.join(', ')}. ` +
      `URL: ${page.url()}`
  );
}

async function extractTextFromFirstMatch(page: Page, selector: string): Promise<string | null> {
  const locator = page.locator(selector).first();
  const count = await locator.count().catch(() => 0);
  if (count === 0) return null;
  return await locator.textContent().catch(() => null);
}
