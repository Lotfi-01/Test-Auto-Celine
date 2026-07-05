/**
 * Sprint 13 hotfix — unit tests for `redactUrl(rawUrl)` from
 * `AfterpayPaymentFlow`. The two Afterpay flow log sites go through this
 * function to strip query params + hash fragments before logging URLs
 * that could otherwise leak sandbox session tokens (Afterpay portal)
 * or Celine order-confirm identifiers.
 *
 * Test framework: Playwright test runner (`playwright test --project=unit`)
 * matches `**\/unit\/*.spec.ts` — flat structure only. The Sprint 13
 * hotfix prompt requested `tests/unit/checkout/payment/` but that
 * nested path would be silently ignored by `testMatch`; using the flat
 * project convention keeps the tests actually running.
 */

import { test, expect } from '@playwright/test';
import { redactUrl } from '../../pages/checkout/payment/AfterpayPaymentFlow';

test.describe('redactUrl', () => {
  test('removes query params and hash fragments', () => {
    expect(redactUrl('https://example.com/portal/confirm?token=secret#step')).toBe(
      'https://example.com/portal/confirm'
    );
  });

  test('returns a safe placeholder for invalid URLs', () => {
    expect(redactUrl('not-a-valid-url')).toBe('<invalid-url>');
  });
});
