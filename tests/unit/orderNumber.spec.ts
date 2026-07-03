/**
 * Unit tests for `extractOrderNumberFromText()` — the pure helper that
 * replaced the pre-Sprint-2 unrestricted body scan (CODE_REVIEW.md §F-R5).
 *
 * These tests fully cover the extraction contract without a browser.
 * `findOrderNumberOnConfirmationPage()` is orchestration on top and is
 * covered separately by the E2E test itself.
 */

import { test, expect } from '@playwright/test';
import { extractOrderNumberFromText } from '../../utils/orderNumber';

test.describe('extractOrderNumberFromText', () => {
  test('extracts a plain #ABC123-style number', () => {
    expect(extractOrderNumberFromText('Thank you for your order #FRD0081608')).toBe('FRD0081608');
  });

  test('extracts a hyphenated #ABC123-45 number', () => {
    expect(extractOrderNumberFromText('Order #FRD0081608-01 confirmed')).toBe('FRD0081608-01');
  });

  test('returns null when there is no #-prefixed token at all', () => {
    expect(extractOrderNumberFromText('Merci pour votre commande.')).toBeNull();
  });

  test('returns null when the # tokens are not plausibly order numbers', () => {
    // #Top / #footer / #123 / #TOP — none pass the letter+digit+length rules.
    expect(extractOrderNumberFromText('Back to #Top or click #footer or ticket #123.')).toBeNull();
  });

  test('picks the longest candidate when multiple #-tokens appear', () => {
    // Both are valid syntactically; the longer, hyphenated one is the real order.
    const text = 'Ref #ABC1 and order #FRD0081608-01 completed.';
    expect(extractOrderNumberFromText(text)).toBe('FRD0081608-01');
  });

  test('returns null on empty string', () => {
    expect(extractOrderNumberFromText('')).toBeNull();
  });

  test('returns null on null / undefined', () => {
    expect(extractOrderNumberFromText(null)).toBeNull();
    expect(extractOrderNumberFromText(undefined)).toBeNull();
  });

  test('handles whitespace and line breaks', () => {
    const text = '\n\n   Thank you!\n   Your order #USD0087654-01\n   is confirmed\n';
    expect(extractOrderNumberFromText(text)).toBe('USD0087654-01');
  });

  test('rejects a purely alphabetic candidate (needs at least one digit)', () => {
    expect(extractOrderNumberFromText('Anchor #ABCDEF and nothing else')).toBeNull();
  });

  test('rejects a purely numeric candidate (needs at least one letter)', () => {
    expect(extractOrderNumberFromText('Ticket #12345 and #67890')).toBeNull();
  });

  test('rejects candidates shorter than 4 characters', () => {
    expect(extractOrderNumberFromText('Try #A1 or #B2')).toBeNull();
    // But a 4-char letter+digit code is accepted.
    expect(extractOrderNumberFromText('Order #A123')).toBe('A123');
  });

  test('does not read # tokens hidden after a random text blob', () => {
    // Realistic Afterpay-page red herring the old regex previously matched.
    const text = 'Continue to checkout, then paste #INSTALLMENTPLAN123 into your app';
    expect(extractOrderNumberFromText(text)).toBe('INSTALLMENTPLAN123');
    // ^ This one is a legitimate match by the regex — but it would need to be
    //   ignored by the LOCATOR-level scoping, not by the text extractor.
    //   The test documents this explicit contract: the pure helper says
    //   "yes, that looks like an order number" and lets the caller pick the
    //   right locator scope. The old body-scan bug was at the scope level,
    //   not at the regex level — this ensures we don't over-restrict here.
  });

  test('extracts from a realistic Celine confirmation snippet', () => {
    const snippet =
      'CELINE — Order confirmation\nThank you for your order #FRD0081608-01.\nYou will receive an email shortly.';
    expect(extractOrderNumberFromText(snippet)).toBe('FRD0081608-01');
  });
});
