/**
 * Unit tests for the FormHelper utility module.
 *
 * Verifies the public API of utils/formHelper.ts via mocked Playwright Locator
 * and Page objects (no real browser, no network, no Playwright fixtures).
 *
 * Coverage scope (3 public functions, 5 cases):
 *   - fillField: success path with default options + Tab variant, plus the
 *     failure path when the underlying Locator.waitFor rejects.
 *   - fillMultipleFields: success path, asserting that page.locator() is
 *     called with the exact selectors provided and that each field receives
 *     exactly one fill().
 *   - waitForFormReady: failure path with a short timeout, asserting the
 *     function reports failure and stays well under the 1000 ms cap.
 *
 * Out of this spec's scope: clickElement (internal retry loop with
 * setTimeout(TIMEOUTS.animation) makes a deterministic unit test fragile),
 * forceElementVisible (relies on Locator.evaluate executing in a real DOM),
 * selectDropdownOption / toggleCheckbox / validateFieldValue (covered only by
 * E2E for now). See QUALITY_BASELINE.md follow-up lots.
 */

import { test, expect } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import { fillField, fillMultipleFields, waitForFormReady } from '../../utils/formHelper';

type LocatorAction = 'waitFor' | 'scrollIntoViewIfNeeded' | 'clear' | 'fill' | 'press' | 'first';

interface LocatorCall {
  source: string;
  selector?: string;
  action: LocatorAction;
  args?: unknown;
}

interface MockLocatorOptions {
  /** Throw inside `waitFor()` to simulate an attached/visible failure. */
  waitForRejects?: boolean;
}

/**
 * Build a mock Locator that records every recognised interaction.
 * `source` identifies which logical field the Locator represents and is
 * surfaced in every recorded call so tests can assert per-field routing.
 */
function createMockLocator(
  source: string,
  calls: LocatorCall[],
  selector: string | undefined,
  opts: MockLocatorOptions = {}
): Locator {
  const locator = {
    waitFor: async (args: unknown) => {
      calls.push({ source, selector, action: 'waitFor', args });
      if (opts.waitForRejects) {
        throw new Error(`waitFor rejected for ${source}`);
      }
    },
    scrollIntoViewIfNeeded: async () => {
      calls.push({ source, selector, action: 'scrollIntoViewIfNeeded' });
    },
    clear: async () => {
      calls.push({ source, selector, action: 'clear' });
    },
    fill: async (value: string) => {
      calls.push({ source, selector, action: 'fill', args: value });
    },
    press: async (key: string) => {
      calls.push({ source, selector, action: 'press', args: key });
    },
  };
  return locator as unknown as Locator;
}

/**
 * Build a mock Page whose `locator(selector)` returns a Locator-like object
 * exposing `.first()`. The `.first()` step is recorded so tests can assert
 * the fillMultipleFields path uses `page.locator(s).first()` exactly once
 * per field with the expected selector.
 */
function createMockPage(
  calls: LocatorCall[],
  matcher: (selector: string) => { source: string; opts?: MockLocatorOptions }
): Page {
  const page = {
    locator: (selector: string) => {
      return {
        first: () => {
          calls.push({ source: matcher(selector).source, selector, action: 'first' });
          return createMockLocator(matcher(selector).source, calls, selector, matcher(selector).opts);
        },
      };
    },
  };
  return page as unknown as Page;
}

test.describe('FormHelper Unit Tests', () => {
  test('fillField with default options runs waitFor → scroll → clear → fill in order, no Tab', async () => {
    const calls: LocatorCall[] = [];
    const locator = createMockLocator('email', calls, undefined);

    const result = await fillField(locator, 'lotfi@example.com', 'Email');

    expect(result.success).toBe(true);

    // Exactly one fill() with the exact value, on the email locator.
    const fillCalls = calls.filter((c) => c.action === 'fill');
    expect(fillCalls).toHaveLength(1);
    expect(fillCalls[0].source).toBe('email');
    expect(fillCalls[0].args).toBe('lotfi@example.com');

    // Defaults: clear=true, scroll=true, pressTab=false.
    expect(calls.some((c) => c.action === 'clear')).toBe(true);
    expect(calls.some((c) => c.action === 'scrollIntoViewIfNeeded')).toBe(true);
    expect(calls.some((c) => c.action === 'press')).toBe(false);

    // waitFor must be the first interaction with state: 'attached'.
    const waitForCall = calls.find((c) => c.action === 'waitFor');
    expect(waitForCall).toBeDefined();
    expect((waitForCall!.args as { state?: string }).state).toBe('attached');
    expect(calls[0].action).toBe('waitFor');

    // Action ordering: waitFor → scroll → clear → fill.
    const orderedActions = calls.map((c) => c.action);
    expect(orderedActions.indexOf('waitFor')).toBeLessThan(orderedActions.indexOf('scrollIntoViewIfNeeded'));
    expect(orderedActions.indexOf('scrollIntoViewIfNeeded')).toBeLessThan(orderedActions.indexOf('clear'));
    expect(orderedActions.indexOf('clear')).toBeLessThan(orderedActions.indexOf('fill'));
  });

  test('fillField with pressTab=true triggers a Tab press after the fill', async () => {
    const calls: LocatorCall[] = [];
    const locator = createMockLocator('phone', calls, undefined);

    const result = await fillField(locator, '+33600000000', 'Phone', { pressTab: true });

    expect(result.success).toBe(true);

    const fillCalls = calls.filter((c) => c.action === 'fill');
    expect(fillCalls).toHaveLength(1);
    expect(fillCalls[0].args).toBe('+33600000000');

    const pressCalls = calls.filter((c) => c.action === 'press');
    expect(pressCalls).toHaveLength(1);
    expect(pressCalls[0].args).toBe('Tab');

    // Tab must come after the fill.
    const orderedActions = calls.map((c) => c.action);
    expect(orderedActions.indexOf('fill')).toBeLessThan(orderedActions.indexOf('press'));
  });

  test('fillField returns success=false and never calls fill() when waitFor rejects', async () => {
    const calls: LocatorCall[] = [];
    const locator = createMockLocator('city', calls, undefined, { waitForRejects: true });

    const result = await fillField(locator, 'Paris', 'City');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toContain('waitFor rejected for city');
    }

    // Critical guarantee: no fill() must occur after a waitFor failure.
    expect(calls.filter((c) => c.action === 'fill')).toHaveLength(0);

    // No press() either — Tab handling is post-fill in the helper.
    expect(calls.filter((c) => c.action === 'press')).toHaveLength(0);
  });

  test('fillMultipleFields uses page.locator(selector).first() for each field with exactly one fill() per field', async () => {
    const calls: LocatorCall[] = [];

    const SELECTORS = {
      firstName: 'input[name="firstName"]',
      lastName: 'input[name="lastName"]',
    };

    const page = createMockPage(calls, (selector) => {
      if (selector === SELECTORS.firstName) return { source: 'firstName' };
      if (selector === SELECTORS.lastName) return { source: 'lastName' };
      return { source: 'unknown' };
    });

    const result = await fillMultipleFields(page, [
      { selector: SELECTORS.firstName, value: 'Lotfi', name: 'First name' },
      { selector: SELECTORS.lastName, value: 'Hermassi', name: 'Last name' },
    ]);

    expect(result.success).toBe(true);
    expect(result.failedFields).toEqual([]);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.filled)).toBe(true);

    // Each field selector must have been queried via page.locator(s).first().
    const firstCalls = calls.filter((c) => c.action === 'first');
    expect(firstCalls).toHaveLength(2);
    expect(firstCalls.map((c) => c.selector)).toEqual([SELECTORS.firstName, SELECTORS.lastName]);

    // No "unknown" selector must be reached.
    expect(calls.some((c) => c.source === 'unknown')).toBe(false);

    // Exactly one fill() per field, in the same order, with the exact values.
    const fillCalls = calls.filter((c) => c.action === 'fill');
    expect(fillCalls).toHaveLength(2);
    expect(fillCalls[0].source).toBe('firstName');
    expect(fillCalls[0].args).toBe('Lotfi');
    expect(fillCalls[1].source).toBe('lastName');
    expect(fillCalls[1].args).toBe('Hermassi');
  });

  test('waitForFormReady returns success=false fast when a selector fails to attach', async () => {
    const calls: LocatorCall[] = [];

    const SELECTORS = {
      good: 'input[name="ok"]',
      missing: 'input[name="missing"]',
    };

    const page = createMockPage(calls, (selector) => {
      if (selector === SELECTORS.missing) {
        return { source: 'missing', opts: { waitForRejects: true } };
      }
      return { source: 'good' };
    });

    const SHORT_TIMEOUT_MS = 200;
    const start = Date.now();
    const result = await waitForFormReady(page, [SELECTORS.good, SELECTORS.missing], SHORT_TIMEOUT_MS);
    const duration = Date.now() - start;

    expect(result.success).toBe(false);

    // Negative path must stay well under 1000 ms.
    expect(duration).toBeLessThan(1000);

    // Both selectors must have been resolved via page.locator(s).first() in order.
    const firstCalls = calls.filter((c) => c.action === 'first');
    expect(firstCalls.map((c) => c.selector)).toEqual([SELECTORS.good, SELECTORS.missing]);

    // The failure is on the second selector; the first one must have completed waitFor.
    const waitForCalls = calls.filter((c) => c.action === 'waitFor');
    expect(waitForCalls.length).toBeGreaterThanOrEqual(2);
    expect(waitForCalls[0].source).toBe('good');
    expect(waitForCalls[1].source).toBe('missing');

    // No fill() must occur during a readiness check.
    expect(calls.filter((c) => c.action === 'fill')).toHaveLength(0);
  });
});
