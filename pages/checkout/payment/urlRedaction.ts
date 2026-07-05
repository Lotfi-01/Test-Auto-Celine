/**
 * Sprint 14 — shared URL redaction helper for the Payment tree.
 * Originally introduced in Sprint 13 inside `AfterpayPaymentFlow`; moved
 * here so PayPal (Sprint 12) can drop its `.slice(0, N)` truncation and
 * every Payment helper shares the same redaction contract.
 *
 * Contract:
 *   - Query params are stripped.
 *   - Hash fragments are stripped.
 *   - Only `origin + pathname` is returned.
 *   - The pathname is NOT redacted — if a downstream PSP ever embeds a
 *     token/session id/order id directly in the path (not in the query),
 *     that value WILL still appear in the log. Current PSPs (Adyen,
 *     Cybersource, PayPal SDK, Afterpay portal) put IDs in query params
 *     which are stripped; if a path-embedded ID is later observed, extend
 *     this file with a `redactPath` pass and update the log sites.
 *   - Invalid URLs return `<invalid-url>` — a static placeholder that
 *     never contains any part of the input.
 *
 * Pure function — no logs, no side effects, no Playwright dependency.
 * Fully unit-testable in isolation (see `tests/unit/urlRedaction.spec.ts`).
 */
export function redactUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '<invalid-url>';
  }
}
