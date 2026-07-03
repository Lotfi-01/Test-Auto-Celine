/**
 * Unit tests for `escapeHtml()` — the last-line defense that keeps dynamic
 * data injected into the email HTML report from turning into markup.
 *
 * The reporter template is a mega-string of interpolations; missing escaping
 * on any injection would let a maliciously-named order (or a maliciously-set
 * NODE_ENV, browser name, etc.) inject markup and, worst case, exfiltrate
 * data via a URL fetch in a mail client that renders remote images.
 */

import { test, expect } from '@playwright/test';
import { escapeHtml } from '../../utils/emailReporter';

test.describe('escapeHtml', () => {
  test('escapes the five HTML metacharacters', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
    expect(escapeHtml('"double"')).toBe('&quot;double&quot;');
    expect(escapeHtml("'single'")).toBe('&#39;single&#39;');
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  test('escapes ampersand FIRST to avoid double-encoding', () => {
    // Order matters: if `<` were escaped before `&`, the resulting `&lt;`
    // would then have its `&` re-escaped to `&amp;lt;`. The implementation
    // must escape `&` first.
    expect(escapeHtml('&<>')).toBe('&amp;&lt;&gt;');
  });

  test('handles null and undefined without throwing', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  test('handles numbers, booleans and objects via String()', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(true)).toBe('true');
    expect(escapeHtml({ toString: () => '<x>' })).toBe('&lt;x&gt;');
  });

  test('leaves safe strings unchanged', () => {
    expect(escapeHtml('ORDER-#FRD0081608-01')).toBe('ORDER-#FRD0081608-01');
    expect(escapeHtml('CELINE FR')).toBe('CELINE FR');
    expect(escapeHtml('')).toBe('');
  });

  test('neutralizes an event-handler injection attempt', () => {
    const evil = 'x" onmouseover="alert(1)';
    // Any downstream `<div style="color:#666">${escapeHtml(x)}</div>` template
    // must not break out of its attribute.
    expect(escapeHtml(evil)).toBe('x&quot; onmouseover=&quot;alert(1)');
  });
});
