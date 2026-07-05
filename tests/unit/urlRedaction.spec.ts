/**
 * Sprint 14 — unit tests for the shared `redactUrl(rawUrl)` helper.
 * The function was introduced in Sprint 13 inside `AfterpayPaymentFlow`
 * and moved in Sprint 14 to the shared `urlRedaction.ts` so PayPal and
 * Afterpay share the same redaction contract. The two log sites in each
 * of the two flows route their URL emissions through it to strip query
 * params + hash fragments before logging (Afterpay portal session tokens,
 * PayPal SDK EC-tokens, Celine order-confirm identifiers).
 *
 * Test framework: Playwright test runner (`playwright test --project=unit`)
 * matches `**\/unit\/*.spec.ts` — flat structure only.
 */

import { test, expect } from '@playwright/test';
import { redactUrl } from '../../pages/checkout/payment/urlRedaction';

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
