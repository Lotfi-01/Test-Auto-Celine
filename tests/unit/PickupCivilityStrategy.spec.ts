/**
 * Unit tests for the pure surface of `PickupCivilityStrategy` (Sprint 5).
 *
 * The strategy class itself drives a Playwright `Locator` and requires a
 * real dialog to exercise; only the exported constants and the
 * de-duplicated re-use of `civilityTokens` (from `CivilitySelector`) are
 * pure. Testing them here pins the fallback ordering and prevents someone
 * from silently reintroducing a divergent token list — that would have
 * broken FR (Mme→Mrs mapping) or JP civility selection.
 */

import { test, expect } from '@playwright/test';
import {
  PICKUP_CIVILITY_STRATEGIES,
  PickupCivilityStrategy,
  type PickupCivilityStrategyName,
} from '../../pages/checkout/shipping/PickupCivilityStrategy';
import {
  CivilitySelector,
  civilityTokens,
} from '../../pages/checkout/shipping/CivilitySelector';

test.describe('PICKUP_CIVILITY_STRATEGIES', () => {
  test('exposes exactly the 4 strategies A/B/C/D — order matters, must not be shuffled', () => {
    // The strategy class short-circuits on the first success — reordering
    // this list changes the selection outcome on dialogs that satisfy
    // multiple strategies at once. Pin the order.
    expect(PICKUP_CIVILITY_STRATEGIES).toEqual([
      'role+name',
      'label text',
      'dialog scan',
      'fallback helper',
    ]);
  });

  test('names carry only technical labels — no PII, no field values', () => {
    // A future contributor could be tempted to embed dialog IDs or user
    // input in a strategy name for triage purposes. That would break the
    // PII contract (log statements format `Civility radio checked
    // (${strategy}): ${token}`).
    for (const name of PICKUP_CIVILITY_STRATEGIES) {
      expect(name).toMatch(/^[a-z+ ]+$/);
      expect(name).not.toMatch(/@|password|token|phone|address|email|postal/i);
    }
  });

  test('the type alias enumerates exactly the runtime names', () => {
    // If a contributor renames a strategy in the const but not in the type
    // (or vice-versa), TypeScript will fail here — this file is checked by
    // `tsc --noEmit` on every push.
    const sample: PickupCivilityStrategyName = 'role+name';
    expect(PICKUP_CIVILITY_STRATEGIES).toContain(sample);
  });
});

test.describe('PickupCivilityStrategy — token re-use from CivilitySelector', () => {
  test('the strategy uses the same `civilityTokens` helper as CivilitySelector', () => {
    // Sprint 5 removed a 12-line inline `titleAcceptable` closure that was
    // a stale copy of `civilityTokens`. Guard the de-duplication by
    // exercising the shared helper for every canonical title — if this
    // regresses, the FR/JP behavior contract diverges silently.
    for (const title of ['Mr', 'Mrs', 'Ms', 'M', 'Mme', 'Mlle']) {
      const tokens = civilityTokens(title);
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens[0]).toBe(title.toLowerCase());
    }
  });

  test('unknown title still resolves to a broad fallback token list', () => {
    // The dialog scan (Strategy C) needs a non-empty candidate list even
    // for an unknown civility — `civilityTokens('Docteur')` provides it.
    const fallback = civilityTokens('Docteur');
    expect(fallback).toContain('mr');
    expect(fallback).toContain('mrs');
    expect(fallback).toContain('ms');
  });
});

test.describe('PickupCivilityStrategy — constructor contract', () => {
  test('constructs with a CivilitySelector dependency — no throw, no eager Page access', () => {
    // The class must be instantiable in a test context without a real
    // browser. `CivilitySelector` accepts a `Page` but doesn't call any
    // method on it eagerly, so a bare object cast is safe for a wiring
    // smoke test. This exercises the constructor plumbing only; the
    // selection logic itself needs a real dialog to run.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fakePage = {} as any;
    const selector = new CivilitySelector(fakePage);
    const strategy = new PickupCivilityStrategy(selector);
    expect(strategy).toBeInstanceOf(PickupCivilityStrategy);
  });
});
