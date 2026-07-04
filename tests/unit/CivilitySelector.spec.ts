/**
 * Unit tests for the pure logic behind `CivilitySelector` (Sprint 3).
 *
 * The class itself drives a Playwright `Page` and cannot be tested without
 * a real browser, but the token-mapping and selector-mapping helpers are
 * pure and carry the actual civility fallback semantics. Testing them here
 * pins the 3-strategy order and prevents regression on the localized
 * variants (Mr/M, Mrs/Mme, Ms/Mlle) that made checkout pass in FR/JP.
 */

import { test, expect } from '@playwright/test';
import {
  civilityTokens,
  civilitySelectorsFor,
} from '../../pages/checkout/shipping/CivilitySelector';
import { SELECTORS } from '../../pages/selectors';

test.describe('civilityTokens', () => {
  test('maps Mr to preferred + variants including the dotted form', () => {
    expect(civilityTokens('Mr')).toEqual(['mr', 'm', 'mr.']);
  });

  test('is case-insensitive: mR → same list as Mr', () => {
    expect(civilityTokens('mR')).toEqual(['mr', 'm', 'mr.']);
  });

  test('French "Mme" resolves to the Mrs family (localized variant)', () => {
    expect(civilityTokens('Mme')).toEqual(['mme', 'mrs', 'mrs.']);
  });

  test('French "Mlle" resolves to the Ms family with "miss" fallback', () => {
    expect(civilityTokens('Mlle')).toEqual(['mlle', 'ms', 'miss', 'ms.']);
  });

  test('short forms "M" and "Ms" map to their expected families', () => {
    expect(civilityTokens('M')).toEqual(['m', 'mr', 'mr.']);
    expect(civilityTokens('Ms')).toEqual(['ms', 'mlle', 'miss', 'ms.']);
  });

  test('unknown title falls back to the broad token list — Strategy 3 stays reachable', () => {
    const fallback = civilityTokens('Docteur');
    expect(fallback).toEqual(['mr', 'm', 'mrs', 'mme', 'ms', 'mlle']);
  });

  test('empty and null-ish inputs still return the broad fallback list (no throw)', () => {
    expect(civilityTokens('')).toEqual(['mr', 'm', 'mrs', 'mme', 'ms', 'mlle']);
    expect(civilityTokens(undefined as unknown as string)).toEqual([
      'mr', 'm', 'mrs', 'mme', 'ms', 'mlle',
    ]);
  });

  test('the preferred token is always the first element', () => {
    // Callers loop over tokens in order — the first match wins, so the
    // preferred variant must come first for every known title.
    for (const title of ['Mr', 'M', 'Mrs', 'Mme', 'Ms', 'Mlle']) {
      const tokens = civilityTokens(title);
      expect(tokens[0]).toBe(title.toLowerCase());
    }
  });

  test('returns a fresh array — mutating the result never poisons the next call', () => {
    const first = civilityTokens('Mr');
    first.push('poisoned');
    const second = civilityTokens('Mr');
    expect(second).not.toContain('poisoned');
  });
});

test.describe('civilitySelectorsFor', () => {
  test('Mr → the exact input/label pair from SELECTORS.CHECKOUT.SHIPPING', () => {
    const pair = civilitySelectorsFor('Mr');
    expect(pair).toEqual({
      input: SELECTORS.CHECKOUT.SHIPPING.TITLE_MR_INPUT,
      label: SELECTORS.CHECKOUT.SHIPPING.TITLE_MR_LABEL,
    });
  });

  test('French "Mme" points at the Mrs input/label pair (localized)', () => {
    const pair = civilitySelectorsFor('Mme');
    expect(pair).toEqual({
      input: SELECTORS.CHECKOUT.SHIPPING.TITLE_MRS_INPUT,
      label: SELECTORS.CHECKOUT.SHIPPING.TITLE_MRS_LABEL,
    });
  });

  test('French "Mlle" points at the Ms input/label pair (localized)', () => {
    const pair = civilitySelectorsFor('Mlle');
    expect(pair).toEqual({
      input: SELECTORS.CHECKOUT.SHIPPING.TITLE_MS_INPUT,
      label: SELECTORS.CHECKOUT.SHIPPING.TITLE_MS_LABEL,
    });
  });

  test('unknown title returns null so the caller skips Strategy 1', () => {
    // Callers gate Strategy 1 on a truthy selector pair. Returning null
    // means the fallback strategies (label text match + broad radio scan)
    // run without hitting undefined selectors.
    expect(civilitySelectorsFor('Docteur')).toBeNull();
    expect(civilitySelectorsFor('')).toBeNull();
  });

  test('is case-sensitive on purpose — normalize before lookup, not inside', () => {
    // `_selectCivilityRobust` fed `title` directly to the maps (case
    // sensitive) as `Mr`/`Mrs`/`Ms`/`M`/`Mme`/`Mlle`. The extracted helper
    // must preserve that exact contract so misconfigured tests fail loudly
    // rather than silently pattern-match on the fallback strategies.
    expect(civilitySelectorsFor('mr')).toBeNull();
    expect(civilitySelectorsFor('MR')).toBeNull();
  });
});
