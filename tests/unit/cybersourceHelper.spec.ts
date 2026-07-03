/**
 * Unit tests for CybersourceHelper utility.
 *
 * Verifies that the helper resolves Cybersource Flex Microform iframes via
 * page.frames() + the aria-label-based selectors used in production:
 *   - card number: input[aria-label="Card number" i]
 *   - security code: input[aria-label*="security code" i], input[aria-label*="card security" i]
 *
 * Note: CybersourceHelper exposes only waitForPaymentForm, fillCardNumber and
 * fillCvv. Expiration date and cardholder name are regular page inputs handled
 * outside this helper (see header comment of utils/cybersourceHelper.ts), so no
 * fillExpiryDate test exists here.
 *
 * Tests run via Playwright Test (no jest, no vitest, no real browser, no network).
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CybersourceHelper } from '../../utils/cybersourceHelper';

const CARD_NUMBER_SELECTOR = 'input[aria-label="Card number" i]';
const CVV_SELECTOR = 'input[aria-label*="security code" i], input[aria-label*="card security" i]';

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
 * `matchSelector === null` means "this frame does not contain any Cybersource field".
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
 * CybersourceHelper consumes only `page.frames()`, never the rest of the Page API,
 * so casting through `unknown` is safe here.
 */
function createMockPage(frames: ReturnType<typeof createMockFrame>[]): Page {
  return { frames: () => frames } as unknown as Page;
}

test.describe('CybersourceHelper Unit Tests', () => {
  test('fillCardNumber targets only the frame matching the Card number selector', async () => {
    const calls: LocatorCall[] = [];
    const nonCybersource = createMockFrame('non-cybersource', null, calls);
    const wrongCybersource = createMockFrame('cybersource-cvv', CVV_SELECTOR, calls);
    const correct = createMockFrame('cybersource-card', CARD_NUMBER_SELECTOR, calls);
    const page = createMockPage([nonCybersource, wrongCybersource, correct]);

    const ok = await CybersourceHelper.fillCardNumber(page, '4111111111111111');

    expect(ok).toBe(true);

    const fillCalls = calls.filter((c) => c.action === 'fill');
    expect(fillCalls).toHaveLength(1);
    expect(fillCalls[0].frameName).toBe('cybersource-card');
    expect(fillCalls[0].selector).toBe(CARD_NUMBER_SELECTOR);
    expect((fillCalls[0].value as { value: string }).value).toBe('4111111111111111');

    // Wrong frames must not receive any fill().
    expect(fillCalls.some((c) => c.frameName === 'non-cybersource')).toBe(false);
    expect(fillCalls.some((c) => c.frameName === 'cybersource-cvv')).toBe(false);

    // count() was used to discover the right frame; only the cardNumber selector is queried.
    const countCalls = calls.filter((c) => c.action === 'count');
    expect(countCalls.length).toBeGreaterThanOrEqual(1);
    expect(countCalls.every((c) => c.selector === CARD_NUMBER_SELECTOR)).toBe(true);
  });

  test('fillCvv targets only the frame matching the security code selector', async () => {
    const calls: LocatorCall[] = [];
    const nonCybersource = createMockFrame('non-cybersource', null, calls);
    const wrongCybersource = createMockFrame('cybersource-card', CARD_NUMBER_SELECTOR, calls);
    const correct = createMockFrame('cybersource-cvv', CVV_SELECTOR, calls);
    const page = createMockPage([nonCybersource, wrongCybersource, correct]);

    const ok = await CybersourceHelper.fillCvv(page, '737');

    expect(ok).toBe(true);

    const fillCalls = calls.filter((c) => c.action === 'fill');
    expect(fillCalls).toHaveLength(1);
    expect(fillCalls[0].frameName).toBe('cybersource-cvv');
    expect(fillCalls[0].selector).toBe(CVV_SELECTOR);
    expect((fillCalls[0].value as { value: string }).value).toBe('737');

    expect(fillCalls.some((c) => c.frameName === 'non-cybersource')).toBe(false);
    expect(fillCalls.some((c) => c.frameName === 'cybersource-card')).toBe(false);

    const countCalls = calls.filter((c) => c.action === 'count');
    expect(countCalls.every((c) => c.selector === CVV_SELECTOR)).toBe(true);
  });

  test('waitForPaymentForm returns true when a frame contains the Card number input', async () => {
    const calls: LocatorCall[] = [];
    const nonCybersource = createMockFrame('non-cybersource', null, calls);
    const correct = createMockFrame('cybersource-card', CARD_NUMBER_SELECTOR, calls);
    const page = createMockPage([nonCybersource, correct]);

    const start = Date.now();
    const ok = await CybersourceHelper.waitForPaymentForm(page, 1000);
    const duration = Date.now() - start;

    expect(ok).toBe(true);
    // Found on the first iteration; should finish well before the 1000 ms cap.
    expect(duration).toBeLessThan(500);

    const countCalls = calls.filter((c) => c.action === 'count');
    expect(countCalls.length).toBeGreaterThanOrEqual(2);
    expect(countCalls.every((c) => c.selector === CARD_NUMBER_SELECTOR)).toBe(true);

    // waitForPaymentForm performs no fill().
    expect(calls.filter((c) => c.action === 'fill')).toHaveLength(0);
  });

  test('waitForPaymentForm returns false fast when no frame matches', async () => {
    const calls: LocatorCall[] = [];
    const nonCybersource1 = createMockFrame('non-cybersource-1', null, calls);
    const nonCybersource2 = createMockFrame('non-cybersource-2', null, calls);
    const page = createMockPage([nonCybersource1, nonCybersource2]);

    const SHORT_TIMEOUT_MS = 50;
    const start = Date.now();
    const ok = await CybersourceHelper.waitForPaymentForm(page, SHORT_TIMEOUT_MS);
    const duration = Date.now() - start;

    expect(ok).toBe(false);
    // Negative-case duration must stay well under 1000 ms.
    // The helper sleeps 250 ms between iterations, so a single failed iteration
    // typically lands around ~250–300 ms; far below 1000 ms.
    expect(duration).toBeLessThan(1000);

    // No fill() anywhere.
    expect(calls.filter((c) => c.action === 'fill')).toHaveLength(0);

    // count() probed every frame at least once with the cardNumber selector.
    const countCalls = calls.filter((c) => c.action === 'count');
    expect(countCalls.length).toBeGreaterThanOrEqual(2);
    expect(countCalls.every((c) => c.selector === CARD_NUMBER_SELECTOR)).toBe(true);
  });

  test('fillCardNumber returns false and performs no fill when no frame matches', async () => {
    const calls: LocatorCall[] = [];
    const nonCybersource1 = createMockFrame('non-cybersource-1', null, calls);
    const nonCybersource2 = createMockFrame('non-cybersource-2', null, calls);
    const page = createMockPage([nonCybersource1, nonCybersource2]);

    const ok = await CybersourceHelper.fillCardNumber(page, '4111111111111111');

    expect(ok).toBe(false);

    // No fill() must occur on any frame.
    expect(calls.filter((c) => c.action === 'fill')).toHaveLength(0);

    // count() probed every frame using only the cardNumber selector.
    const countCalls = calls.filter((c) => c.action === 'count');
    expect(countCalls.length).toBeGreaterThanOrEqual(2);
    expect(countCalls.every((c) => c.selector === CARD_NUMBER_SELECTOR)).toBe(true);
  });
});
