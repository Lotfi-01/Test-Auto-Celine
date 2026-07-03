/**
 * Unit tests for AdyenHelper utility
 * Verifies that the helper resolves Adyen iframes via page.frames() + the
 * data-fieldtype selectors, not via the removed iframe[title="..."] frameLocator path.
 *
 * Tests run via Playwright Test (no jest, no vitest, no real browser, no network).
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { AdyenHelper } from '../../utils/adyenHelper';

const CARD_NUMBER_SELECTOR = 'input[data-fieldtype="encryptedCardNumber"]';
const EXPIRY_DATE_SELECTOR = 'input[data-fieldtype="encryptedExpiryDate"]';
const CVV_SELECTOR = 'input[data-fieldtype="encryptedSecurityCode"]';

type LocatorAction = 'count' | 'fill';

interface LocatorCall {
  frameName: string;
  selector: string;
  action: LocatorAction;
  value?: unknown;
}

/**
 * Build a mock Frame whose `locator(selector).count()` returns 1 only when
 * `selector === matchSelector`. Records every interaction in `calls`.
 * `matchSelector === null` means "this frame does not contain any Adyen field".
 */
function createMockFrame(frameName: string, matchSelector: string | null, calls: LocatorCall[]) {
  return {
    locator: (selector: string) => ({
      count: async () => {
        calls.push({ frameName, selector, action: 'count' });
        return selector === matchSelector ? 1 : 0;
      },
      first: () => ({
        fill: async (value: string, options?: unknown) => {
          calls.push({
            frameName,
            selector,
            action: 'fill',
            value: { value, options },
          });
        },
      }),
    }),
  };
}

/**
 * Cast helper kept at the call site so the test signature stays clear.
 * AdyenHelper consumes only `page.frames()`, never the rest of the Page API,
 * so casting through `unknown` is safe here.
 */
function createMockPage(frames: ReturnType<typeof createMockFrame>[]): Page {
  return { frames: () => frames } as unknown as Page;
}

test.describe('AdyenHelper Unit Tests', () => {
  test('fillCardNumber targets only the frame matching encryptedCardNumber', async () => {
    const calls: LocatorCall[] = [];
    const nonAdyen = createMockFrame('non-adyen', null, calls);
    const wrongAdyen = createMockFrame('adyen-cvv', CVV_SELECTOR, calls);
    const correct = createMockFrame('adyen-card-number', CARD_NUMBER_SELECTOR, calls);
    const page = createMockPage([nonAdyen, wrongAdyen, correct]);

    const ok = await AdyenHelper.fillCardNumber(page, '4111111111111111');

    expect(ok).toBe(true);

    const fillCalls = calls.filter((c) => c.action === 'fill');
    expect(fillCalls).toHaveLength(1);
    expect(fillCalls[0].frameName).toBe('adyen-card-number');
    expect(fillCalls[0].selector).toBe(CARD_NUMBER_SELECTOR);
    expect((fillCalls[0].value as { value: string }).value).toBe('4111111111111111');

    // Wrong frames must not receive any fill().
    expect(fillCalls.some((c) => c.frameName === 'non-adyen')).toBe(false);
    expect(fillCalls.some((c) => c.frameName === 'adyen-cvv')).toBe(false);

    // count() was used to discover the right frame; only the cardNumber selector is queried.
    const countCalls = calls.filter((c) => c.action === 'count');
    expect(countCalls.length).toBeGreaterThanOrEqual(1);
    expect(countCalls.every((c) => c.selector === CARD_NUMBER_SELECTOR)).toBe(true);
  });

  test('fillExpiryDate targets only the frame matching encryptedExpiryDate', async () => {
    const calls: LocatorCall[] = [];
    const nonAdyen = createMockFrame('non-adyen', null, calls);
    const wrongAdyen = createMockFrame('adyen-card-number', CARD_NUMBER_SELECTOR, calls);
    const correct = createMockFrame('adyen-expiry', EXPIRY_DATE_SELECTOR, calls);
    const page = createMockPage([nonAdyen, wrongAdyen, correct]);

    const ok = await AdyenHelper.fillExpiryDate(page, '03/30');

    expect(ok).toBe(true);

    const fillCalls = calls.filter((c) => c.action === 'fill');
    expect(fillCalls).toHaveLength(1);
    expect(fillCalls[0].frameName).toBe('adyen-expiry');
    expect(fillCalls[0].selector).toBe(EXPIRY_DATE_SELECTOR);
    expect((fillCalls[0].value as { value: string }).value).toBe('03/30');

    expect(fillCalls.some((c) => c.frameName === 'non-adyen')).toBe(false);
    expect(fillCalls.some((c) => c.frameName === 'adyen-card-number')).toBe(false);

    const countCalls = calls.filter((c) => c.action === 'count');
    expect(countCalls.every((c) => c.selector === EXPIRY_DATE_SELECTOR)).toBe(true);
  });

  test('fillCvv targets only the frame matching encryptedSecurityCode', async () => {
    const calls: LocatorCall[] = [];
    const nonAdyen = createMockFrame('non-adyen', null, calls);
    const wrongAdyen = createMockFrame('adyen-expiry', EXPIRY_DATE_SELECTOR, calls);
    const correct = createMockFrame('adyen-cvv', CVV_SELECTOR, calls);
    const page = createMockPage([nonAdyen, wrongAdyen, correct]);

    const ok = await AdyenHelper.fillCvv(page, '737');

    expect(ok).toBe(true);

    const fillCalls = calls.filter((c) => c.action === 'fill');
    expect(fillCalls).toHaveLength(1);
    expect(fillCalls[0].frameName).toBe('adyen-cvv');
    expect(fillCalls[0].selector).toBe(CVV_SELECTOR);
    expect((fillCalls[0].value as { value: string }).value).toBe('737');

    expect(fillCalls.some((c) => c.frameName === 'non-adyen')).toBe(false);
    expect(fillCalls.some((c) => c.frameName === 'adyen-expiry')).toBe(false);

    const countCalls = calls.filter((c) => c.action === 'count');
    expect(countCalls.every((c) => c.selector === CVV_SELECTOR)).toBe(true);
  });

  test('waitForPaymentForm returns true when a frame contains encryptedCardNumber', async () => {
    const calls: LocatorCall[] = [];
    const nonAdyen = createMockFrame('non-adyen', null, calls);
    const correct = createMockFrame('adyen-card-number', CARD_NUMBER_SELECTOR, calls);
    const page = createMockPage([nonAdyen, correct]);

    const start = Date.now();
    const ok = await AdyenHelper.waitForPaymentForm(page, 1000);
    const duration = Date.now() - start;

    expect(ok).toBe(true);
    // Found on the first iteration; should finish well before the 1000ms cap.
    expect(duration).toBeLessThan(500);

    const countCalls = calls.filter((c) => c.action === 'count');
    expect(countCalls.length).toBeGreaterThanOrEqual(2);
    expect(countCalls.every((c) => c.selector === CARD_NUMBER_SELECTOR)).toBe(true);

    // waitForPaymentForm performs no fill().
    expect(calls.filter((c) => c.action === 'fill')).toHaveLength(0);
  });

  test('waitForPaymentForm returns false fast when no frame matches', async () => {
    const calls: LocatorCall[] = [];
    const nonAdyen1 = createMockFrame('non-adyen-1', null, calls);
    const nonAdyen2 = createMockFrame('non-adyen-2', null, calls);
    const page = createMockPage([nonAdyen1, nonAdyen2]);

    const SHORT_TIMEOUT_MS = 50;
    const start = Date.now();
    const ok = await AdyenHelper.waitForPaymentForm(page, SHORT_TIMEOUT_MS);
    const duration = Date.now() - start;

    expect(ok).toBe(false);
    // Negative-case duration must stay well under the documented cap of 1000ms.
    // The internal poll delay (TIMEOUTS.focusDelay ≈ 150ms) means a single iteration
    // typically lands around ~150–200ms; far below 1000ms.
    expect(duration).toBeLessThan(1000);

    // No fill() anywhere.
    expect(calls.filter((c) => c.action === 'fill')).toHaveLength(0);

    // count() probed every frame at least once with the cardNumber selector.
    const countCalls = calls.filter((c) => c.action === 'count');
    expect(countCalls.length).toBeGreaterThanOrEqual(2);
    expect(countCalls.every((c) => c.selector === CARD_NUMBER_SELECTOR)).toBe(true);
  });
});
