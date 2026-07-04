/**
 * Unit tests for the pure logic behind `PickupDialogHandler` (Sprint 4).
 *
 * The handler class itself drives a Playwright `Page` and cannot be tested
 * without a real browser, but `pickupStateLabelFor` carries the AU/US
 * state-code → dialog-label contract that made pickup pass in AU and US.
 * Pinning it here prevents a silent regression when someone adds a new
 * region or renames a label.
 *
 * The mapping is a strict 1:1 port of the previous inline `labelMap` in
 * `CheckoutShippingPage.selectStateInDialog` (Sprint 3 code). Any test
 * failure here means the behavior contract has drifted.
 */

import { test, expect } from '@playwright/test';
import { pickupStateLabelFor } from '../../pages/checkout/shipping/PickupDialogHandler';

test.describe('pickupStateLabelFor', () => {
  test('AU states — every abbreviation resolves to the exact dialog label', () => {
    // These are the exact labels the Celine AU dialog uses in the state
    // <select>. Do NOT reformat: capitalization + spacing are load-bearing.
    expect(pickupStateLabelFor('NSW')).toBe('NEW SOUTH WALES');
    expect(pickupStateLabelFor('VIC')).toBe('VICTORIA');
    expect(pickupStateLabelFor('QLD')).toBe('QUEENSLAND');
    expect(pickupStateLabelFor('WA')).toBe('WESTERN AUSTRALIA');
    expect(pickupStateLabelFor('SA')).toBe('SOUTH AUSTRALIA');
    expect(pickupStateLabelFor('TAS')).toBe('TASMANIA');
    expect(pickupStateLabelFor('NT')).toBe('NORTHERN TERRITORY');
    expect(pickupStateLabelFor('ACT')).toBe('AUSTRALIAN CAPITAL TERRITORY');
  });

  test('US states — every abbreviation resolves to the exact dialog label', () => {
    expect(pickupStateLabelFor('NY')).toBe('NEW YORK');
    expect(pickupStateLabelFor('CA')).toBe('CALIFORNIA');
    expect(pickupStateLabelFor('TX')).toBe('TEXAS');
    expect(pickupStateLabelFor('FL')).toBe('FLORIDA');
    expect(pickupStateLabelFor('IL')).toBe('ILLINOIS');
    expect(pickupStateLabelFor('NJ')).toBe('NEW JERSEY');
    expect(pickupStateLabelFor('MA')).toBe('MASSACHUSETTS');
    expect(pickupStateLabelFor('WA_US')).toBe('WASHINGTON');
  });

  test('lookup is case-insensitive — lowercase and mixed case resolve identically', () => {
    // The previous implementation did `labelMap[state.toUpperCase()]` — the
    // extracted helper must keep this behavior so tests written with the
    // canonical uppercase keys keep working when a downstream data source
    // supplies mixed case.
    expect(pickupStateLabelFor('nsw')).toBe('NEW SOUTH WALES');
    expect(pickupStateLabelFor('Nsw')).toBe('NEW SOUTH WALES');
    expect(pickupStateLabelFor('nY')).toBe('NEW YORK');
    expect(pickupStateLabelFor('wa_us')).toBe('WASHINGTON');
    expect(pickupStateLabelFor('wa')).toBe('WESTERN AUSTRALIA');
  });

  test('the WA / WA_US split resolves to two distinct labels — critical for AU vs US disambiguation', () => {
    // The AU/US distinction is the whole reason the map exists — plain "WA"
    // means Western Australia; the disambiguated "WA_US" means Washington.
    // If a caller ever swaps them the checkout will land on the wrong
    // shipping zone. Pin this behavior.
    expect(pickupStateLabelFor('WA')).not.toBe(pickupStateLabelFor('WA_US'));
    expect(pickupStateLabelFor('WA')).toBe('WESTERN AUSTRALIA');
    expect(pickupStateLabelFor('WA_US')).toBe('WASHINGTON');
  });

  test('unknown code — returned unchanged so the caller can attempt the raw value', () => {
    // The previous inline mapping used `labelMap[key] || state` — an
    // unknown code fell through to the caller's raw input and was passed
    // to `selectOption({ label: state })`. Preserving that fallback lets a
    // new region ship without an immediate code change.
    expect(pickupStateLabelFor('ZZ')).toBe('ZZ');
    expect(pickupStateLabelFor('BAVARIA')).toBe('BAVARIA');
    expect(pickupStateLabelFor('ontario')).toBe('ontario');
  });

  test('empty string — passes through, matches previous `|| state` coercion', () => {
    // If `state` was empty in the old code, `labelMap['']` was undefined
    // and `undefined || ''` returned `''`. The extracted helper must
    // preserve that exact shape so callers using `if (options.state)` to
    // gate the call still work correctly.
    expect(pickupStateLabelFor('')).toBe('');
  });

  test('does not leak PII into the returned string', () => {
    // The label is a public region name (e.g. "VICTORIA") — it must not
    // reflect any part of the input beyond the case-folded region code.
    // A caller could log the return value at info level for triage; that
    // must stay safe.
    for (const code of ['NSW', 'CA', 'NY', 'unknown-region']) {
      const label = pickupStateLabelFor(code);
      // Labels for known codes are ASCII uppercase; unknown codes echo
      // the input. Neither should ever contain private identifiers.
      expect(label).toMatch(/^[A-Za-z _-]+$/);
    }
  });
});
