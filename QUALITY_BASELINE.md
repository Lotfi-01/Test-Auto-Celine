# Quality Baseline

Date: 2026-05-12
Project: Celine Playwright POM
Scope: Local QA automation project

## 1. Current quality state

| Check                           | Status                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| npm ci                          | Not rerun in this lot                                                                                                                          |
| npm run validate                | PASS                                                                                                                                           |
| TypeScript                      | PASS                                                                                                                                           |
| Unit tests                      | PASS — 57 passed, 0 skipped (incl. AdyenHelper + CybersourceHelper + FormHelper + FileLock + TestResultTracker coverage)                       |
| Adyen Credit Card selection     | PASS — label trigger patch validated on AU home/pickup (headed), AU home headless, FR/US Adyen, and TH Cybersource (see §6c)                   |
| ESLint                          | PASS — 0 errors, 0 warnings                                                                                                                    |
| Prettier                        | PASS — TypeScript source + QUALITY_BASELINE.md + scripts/README.md covered by format:check                                                     |
| npm audit                       | PASS — 0 vulnerabilities                                                                                                                       |
| E2E FR pickup                   | PASS (historical, pre-2026-05-12 sandbox issue)                                                                                                |
| E2E FR home                     | PASS                                                                                                                                           |
| Current sandbox limitation      | FR pickup currently blocked — PICK-UP tab absent from DOM                                                                                      |
| Post-Adyen-iframe-fix smokes    | PASS — FR/US/AU home Adyen and TH home Cybersource (see §6b)                                                                                   |
| Email report                    | Disabled during smokes                                                                                                                         |
| E2E execution policy            | Documented — serial-only by default (see §11). Trackers now hardened for inter-worker concurrency via file lock (see §12)                      |
| Tracker concurrency             | PASS — `orders.json` and `test-results.json` writes serialized via cross-process file lock (see §12)                                           |
| E2E parallel tracker validation | PASS — FR/US/AU home ran in parallel with 3 workers; 3 orders and 3 test results persisted without JSON loss, tmp, or lock leftovers (see §12) |
| PayPal payment method           | PASS — FR/US/AU (Adyen convention) and TH (Cybersource convention) validated end-to-end with `TEST_PAYMENT_METHOD=paypal` (see §13)            |

## 2. Validation command

```bash
npm run validate
```

Current definition (from `package.json`):

```txt
npm run typecheck && npm run lint && npm run format:check && npm run test:unit && npm audit
```

## 3. ESLint baseline

- `@typescript-eslint/no-unused-vars` is set to `error` (with `argsIgnorePattern: '^_'`, `varsIgnorePattern: '^_'`, `caughtErrorsIgnorePattern: '^_'`).
- `no-empty` is set to `error`.
- Empty `catch {}` blocks remain allowed through `allowEmptyCatch: true`.
- Current lint result: `0 errors, 0 warnings`.

## 4. Prettier baseline

- `format:check` covers the TypeScript source code (config/, fixtures/, tests/, utils/, scripts/, .github/, pages/ including pages/checkout/, plus playwright.config.ts, global-teardown.ts, eslint.config.js, package.json, tsconfig.json).
- `pages/checkout/**` is no longer excluded.
- `pages/selectors.ts` is included in the scope.
- Markdown coverage: `QUALITY_BASELINE.md` and `scripts/README.md` are covered by `format:check` (extended 2026-05-12).
- `.prettierignore` anchored exclusions: `/README.md` and `/SECURITY_NOTES.md` keep only the root-level files ignored, so other Markdown files (e.g. `scripts/README.md`) are no longer excluded by their basename. `test-data/README.md` stays ignored via the `test-data` directory rule. `package-lock.json` remains excluded.
- Build/cache directories (`node_modules`, `test-results`, `playwright-report`, `coverage`, `dist`, `build`, `*.log`) remain excluded.

## 5. Unit test baseline

Current result:

```txt
57 passed, 0 skipped
```

The previous `OrderTracker concurrent/race limitation — known limitation` skip was removed and the test re-enabled with strict assertions after the file-lock hardening (see §12).

Coverage breakdown:

| Spec file                              | Tests | Notes                                                                                                                                            |
| -------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/unit/orderTracker.spec.ts`      |    13 | OrderTracker persistence, retrieval, statistics. Concurrent-saves test re-enabled (asserts strict `length === 5`) after file-lock hardening.     |
| `tests/unit/emailReporter.spec.ts`     |    16 | EmailReporter generation, formatting, configuration (no real send).                                                                              |
| `tests/unit/adyenHelper.spec.ts`       |     5 | AdyenHelper iframe-resolution coverage (added 2026-05-12).                                                                                       |
| `tests/unit/cybersourceHelper.spec.ts` |     5 | CybersourceHelper iframe-resolution coverage (added 2026-05-12).                                                                                 |
| `tests/unit/formHelper.spec.ts`        |     5 | FormHelper public API coverage — fillField success/Tab/failure, fillMultipleFields, waitForFormReady (added 2026-05-12).                         |
| `tests/unit/fileLock.spec.ts`          |     8 | FileLock primitive (added 2026-05-12) — acquire/release, async + sync variants, in-process serialization, stale cleanup, timeout, cross-process. |
| `tests/unit/testResultTracker.spec.ts` |     5 | TestResultTracker public API + cross-process concurrent record() via spawned child Node processes (added 2026-05-12).                            |

AdyenHelper unit coverage (5 tests, scoped via mocked `Page.frames()` only — no browser, no network):

- `fillCardNumber` targets only the frame matching `input[data-fieldtype="encryptedCardNumber"]`.
- `fillExpiryDate` targets only the frame matching `input[data-fieldtype="encryptedExpiryDate"]`.
- `fillCvv` targets only the frame matching `input[data-fieldtype="encryptedSecurityCode"]`.
- `waitForPaymentForm` returns `true` when a frame containing `encryptedCardNumber` is present (single-iteration positive case).
- `waitForPaymentForm` returns `false` fast when no frame matches (negative case completes well under the 1000 ms cap).

Each fill test asserts that wrong frames receive no `fill()` and that the correct frame receives exactly one `fill()` with the expected value. The helper public API is exercised end-to-end via `AdyenHelper.fillCardNumber` / `fillExpiryDate` / `fillCvv` / `waitForPaymentForm`; `findAdyenFrame` is covered transitively.

`utils/adyenHelper.ts` was not modified by the addition of these tests (hash unchanged from the post-iframe-fix baseline).

CybersourceHelper unit coverage (5 tests, scoped via mocked `Page.frames()` only — no browser, no network):

- `fillCardNumber` targets only the frame matching `input[aria-label="Card number" i]` (success case).
- `fillCvv` targets only the frame matching `input[aria-label*="security code" i], input[aria-label*="card security" i]` (success case).
- `waitForPaymentForm` returns `true` when a frame containing the Card number input is present (single-iteration positive case).
- `waitForPaymentForm` returns `false` fast when no frame matches (negative case completes well under the 1000 ms cap).
- `fillCardNumber` returns `false` and performs no `fill()` when no frame matches (negative case).

Each fill test asserts that wrong frames receive no `fill()` and that the correct frame receives exactly one `fill()` with the expected value. The helper public API is exercised end-to-end via `CybersourceHelper.fillCardNumber` / `fillCvv` / `waitForPaymentForm`; the private `findFrameContaining` is covered transitively.

Scope nuance: `CybersourceHelper` does not expose a `fillExpiryDate` method. Per the helper header comment, the Cybersource expiration date and cardholder name are regular page inputs (not in iframes) and are filled outside `utils/cybersourceHelper.ts` (in `pages/checkout/CheckoutPaymentPage.ts`). The unit coverage above is therefore scoped to the helper's actual public API and does not assert anything about expiry/cardholder TH inputs — those remain covered only by E2E.

`utils/cybersourceHelper.ts` was not modified by the addition of these tests (hash unchanged from the pre-test baseline).

FormHelper unit coverage (5 tests, scoped via mocked Playwright `Locator` and `Page` only — no browser, no network):

- `fillField` success with default options — asserts the action ordering `waitFor('attached') → scrollIntoViewIfNeeded → clear → fill`, exactly one `fill()` call with the expected value, and no `press('Tab')`.
- `fillField` success with `pressTab: true` — asserts a single `press('Tab')` is invoked after the `fill()`.
- `fillField` failure when `Locator.waitFor` rejects — asserts `result.success === false`, no `fill()` and no `press()` are executed after the failure (critical safety guarantee for partial form state).
- `fillMultipleFields` success with two fields — asserts `page.locator(selector).first()` is invoked for each provided selector in order, exactly one `fill()` per field with the expected value, and no unexpected selector is reached.
- `waitForFormReady` failure with a short timeout — asserts `result.success === false`, that the test stays well under 1000 ms, that both selectors are probed in order via `page.locator(...).first().waitFor(...)`, and that no `fill()` occurs during a readiness check.

Scope note: this coverage protects the public `formHelper.ts` API contract (`fillField`, `fillMultipleFields`, `waitForFormReady`) only. It does not cover the full checkout form runtime — that remains the responsibility of the E2E smokes.

Not covered by this spec: `forceElementVisible`, `clickElement`, `selectDropdownOption`, `toggleCheckbox`, `validateFieldValue`. `clickElement` was deliberately excluded because its internal retry loop uses `setTimeout(TIMEOUTS.animation)` between attempts, which would make a deterministic unit test fragile; `forceElementVisible` was excluded because it relies on `Locator.evaluate` executing in a real DOM (no meaningful unit assertion possible without a browser); the three remaining helpers are still exercised only through E2E.

Current checkout direct usage observed (read-only audit of `pages/checkout/`): only `forceElementVisible` is imported from `utils/formHelper.ts` (`CheckoutShippingPage.ts:6`, called at `CheckoutShippingPage.ts:330`). `CheckoutShippingPage.ts:267` declares its own private `fillField` method that does not delegate to the helper. Consequently, the unit coverage above is most valuable as a regression guard for the public API itself, not as a proxy for checkout flow correctness.

`utils/formHelper.ts` was not modified by the addition of these tests (hash unchanged from the pre-test baseline). `utils/retryHelper.ts` and `utils/selectorStrategy.ts` were also not modified — they remain exercised only through E2E.

## 6. E2E smoke baseline

| Flow      | Command                                                                                               | Result | Order         |
| --------- | ----------------------------------------------------------------------------------------------------- | ------ | ------------- |
| FR pickup | `TEST_DELIVERY_MODE_FR=pickup SEND_EMAIL_REPORT=false npm run test:e2e:headed -- --project=celine-fr` | PASS   | FRD0083787-01 |
| FR home   | `TEST_DELIVERY_MODE_FR=home SEND_EMAIL_REPORT=false npm run test:e2e:headed -- --project=celine-fr`   | PASS   | FRD0083788-01 |

Both smokes were executed after the full Prettier formatting of `pages/checkout/CheckoutShippingPage.ts`, confirming runtime stability of the shipping → payment → order-confirmation flow on FR for both delivery modes.

## 6b. Adyen iframe fix baseline

| Check                                    | Status                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adyen iframe selector fix                | PASS                                                                                                                                                                                  |
| FR home Adyen (post-patch)               | PASS — FRD0083792-01 — 42.5s                                                                                                                                                          |
| US home Adyen (post-patch)               | PASS — USD0073212-01 — 46.0s                                                                                                                                                          |
| AU home Adyen (post-patch)               | PASS — AUD0021165-01 — 44.5s                                                                                                                                                          |
| TH home Cybersource (post-patch)         | PASS — THD0016815-01 — 51.1s                                                                                                                                                          |
| Observed Adyen duration after fix        | 42–46s across FR/US/AU home (single run each)                                                                                                                                         |
| Observed Adyen gain (FR home reference)  | ~47s (1.5m → 42.5s)                                                                                                                                                                   |
| Previous ~30s pre-fill delay             | Removed: not observed on FR/US/AU after the fix                                                                                                                                       |
| `ADYEN_IFRAME_TITLES`                    | Removed                                                                                                                                                                               |
| `frameLocator` in `utils/adyenHelper.ts` | Removed                                                                                                                                                                               |
| `findAdyenFrame`                         | Used directly                                                                                                                                                                         |
| `data-fieldtype` selectors               | Preserved                                                                                                                                                                             |
| `waitForTimeout(1_000)` pre-payment      | Kept                                                                                                                                                                                  |
| `utils/cybersourceHelper.ts`             | Untouched and validated through TH home                                                                                                                                               |
| Adyen helper regression coverage         | PASS — `tests/unit/adyenHelper.spec.ts` (5 tests; `utils/adyenHelper.ts` unchanged)                                                                                                   |
| Cybersource helper regression coverage   | PASS — `tests/unit/cybersourceHelper.spec.ts` (5 tests; `utils/cybersourceHelper.ts` unchanged; expiry/cardholder TH out of helper scope)                                             |
| Credit Card label trigger patch          | PASS — `#lb_scheme` is now the primary trigger; `.adyen-checkout__card-input` visible is the source of truth; `#rb_scheme.click({ force: true })` retained as fallback only (see §6c) |
| AU home Adyen (label-patch smoke)        | PASS — AUD0021167-01 — 42.7s — label trigger                                                                                                                                          |
| AU pickup Adyen (label-patch smoke)      | PASS — AUD0021168-01 — 40.6s — label trigger, no input fallback                                                                                                                       |
| AU home Adyen headless (label-patch)     | PASS — AUD0021169-01 — 56.7s — label trigger, no input fallback                                                                                                                       |
| FR home Adyen (label-patch smoke)        | PASS — FRD0083798-01 — 45.8s — label trigger                                                                                                                                          |
| US home Adyen (label-patch smoke)        | PASS — USD0073213-01 — 43.6s — label trigger                                                                                                                                          |
| TH home Cybersource (label-patch smoke)  | PASS — THD0016816-01 — 47.7s — Cybersource branch unaffected                                                                                                                          |

Summary:

- The slow `iframe[title="..."]` Adyen path was removed from `utils/adyenHelper.ts`.
- The helper now resolves the Adyen iframe directly via `findAdyenFrame`, which iterates `page.frames()` and matches the input by `data-fieldtype`.
- The previous ~30s wait before Adyen field filling (caused by the `frameLocator(iframe[title="..."])` primary path timing out at 30s) is no longer observed.
- The ~5s wait per filled field (`fillCardNumber` / `fillExpiryDate` / `fillCvv` primary path timing out at 5s) is also gone.
- Total observed gain: ~47s on FR home (single run, 1.5m → 42.5s). FR home is the only region with a pre-fix and post-fix measurement; US/AU were only smoked post-fix.
- Cross-region validation: FR, US, and AU home Adyen flows were all re-smoked after the fix and pass. The three regions converge in the 42–46s range (single run each), with no run exhibiting the previous ~30s pre-fill delay.
- TH Cybersource detection remains intact: `detectCybersource()` was not touched by the patch, and the Cybersource branch in `CheckoutPaymentPage.fillPaymentInfo` exits before any Adyen helper call. TH home re-smoked at 51.1s with `THD0016815-01`.
- FR pickup was not revalidated after the fix: the sandbox PICK-UP tab was absent from the DOM before payment, so the Adyen helper was never reached. Historical FR pickup PASS (see §1 and §6) remains valid; post-fix FR pickup status is unverified runtime.
- JP home was not revalidated: it remains blocked by a known sandbox issue (see §8).
- AdyenHelper regression coverage: a dedicated unit spec (`tests/unit/adyenHelper.spec.ts`, added 2026-05-12) exercises the `findAdyenFrame` resolution path through the public API (`fillCardNumber`, `fillExpiryDate`, `fillCvv`, `waitForPaymentForm` success and failure). Coverage is unit-scoped via mocked `Page.frames()` only (no browser, no network). It would surface a regression if `frameLocator(iframe[title="..."])`, `ADYEN_IFRAME_TITLES`, or another non-`data-fieldtype` resolution path were reintroduced. It does not replace runtime smokes for real Adyen behavior.
- CybersourceHelper regression coverage: a dedicated unit spec (`tests/unit/cybersourceHelper.spec.ts`, added 2026-05-12) exercises the `findFrameContaining` iframe-resolution path through the public API (`fillCardNumber` success and failure, `fillCvv` success, `waitForPaymentForm` success and failure). Coverage is unit-scoped via mocked `Page.frames()` only (no browser, no network). The helper's `aria-label`-based selectors (`Card number` for the card iframe; `security code` / `card security` for the CVV iframe) are exercised as opaque strings; a regression would surface if the resolution strategy diverged from `page.frames()` + selector probing. The Cybersource expiration date and cardholder name are regular page inputs (not in iframes) and are filled outside `utils/cybersourceHelper.ts`, so this unit spec does not cover them — they remain covered only by the TH home E2E smoke (THD0016815-01 — 51.1s). `utils/cybersourceHelper.ts` is unchanged by the addition of this spec. The unit spec does not replace the runtime smoke for real Cybersource Flex Microform behavior.

## 6c. Credit Card label patch baseline

Observed issue (2026-05-12, AU sandbox `dev.celine.com/en-au/...`):

- `#rb_scheme.click({ force: true })` became a false positive on AU. Playwright reported the click as successful, but the radio stayed unchecked and the Adyen panel never mounted. `holderName` stayed `hidden`, and `AdyenHelper.fillCardNumber/fillExpiryDate/fillCvv` then failed with `element is not visible`.
- FR home headed kept passing on the same code path during the same session (proof the regression is sandbox-scoped to AU, not code).
- Diagnosed via the `ADYEN-AU-CLICK-TIMING-SPIKE V1` lot: `#lb_scheme.click()` without `force` selected the radio reliably and mounted the Adyen panel; `#rb_scheme.click({ force: true })` left `rbChecked: false` and `panelVisible: false`.

Patch applied (`pages/checkout/CheckoutPaymentPage.ts` only):

- Primary trigger: `#lb_scheme.click()` without `force`.
- Fallback 1: `label[for="rb_scheme"].click()` without `force` (with `expandPaymentSection()` if not yet visible).
- Fallback 2: `#rb_scheme.click({ force: true })` (legacy, retained as last resort for backward compatibility).
- Functional source of truth: `.adyen-checkout__card-input` becomes visible after the trigger. `#rb_scheme.isChecked()` is not used as a sole verdict.
- If the Adyen panel does not become visible after all three triggers, the method now throws `Credit Card panel did not become visible after all triggers` (fail-fast).
- `utils/adyenHelper.ts` unchanged (hash `bd101f71…`).
- `utils/cybersourceHelper.ts` unchanged (hash `9c75bb1a…`).
- TH Cybersource branch (`detectCybersource()` short-circuit) is unaffected and runs before the Adyen triggers.

Runtime validation (single run each, 2026-05-12, all `--headed --workers=1`):

| Region                   | Order         | Duration | Trigger used                                  |
| ------------------------ | ------------- | -------: | --------------------------------------------- |
| AU home Adyen            | AUD0021167-01 |    42.7s | `#lb_scheme` (primary)                        |
| AU pickup Adyen          | AUD0021168-01 |    40.6s | `#lb_scheme` (primary)                        |
| AU home Adyen (headless) | AUD0021169-01 |    56.7s | `#lb_scheme` (primary)                        |
| FR home Adyen            | FRD0083798-01 |    45.8s | `#lb_scheme` (primary)                        |
| US home Adyen            | USD0073213-01 |    43.6s | `#lb_scheme` (primary)                        |
| TH home Cybersource      | THD0016816-01 |    47.7s | Cybersource branch (`#lb_scheme` not reached) |

All six smokes used the primary trigger; no fallback path was exercised in any of these validations. The AU smoke `AUD0021167-01` is the post-patch counterpart to the historical AU pass `AUD0021165-01` (§6b) which was captured before the sandbox regression. AU pickup (`AUD0021168-01`) was added in a follow-up smoke and confirms the label trigger works for both AU delivery modes (home and Click & Collect) on the same shared payment-page code path. The AU home headless smoke (`AUD0021169-01`, 56.7s — slower than headed as expected for headless Chromium on this flow) confirms that the label trigger also removes the original headless symptom: no `element is not visible` error, no `Timeout 3000ms` on Adyen fields. No source/config file was modified for any of the AU pickup or headless smokes.

Email safety:

- `SEND_EMAIL_REPORT=false` was used for every smoke and every validate. Global teardown logged `📧 Email reporting is disabled (SEND_EMAIL_REPORT=false)` for the six E2E runs and `📧 Email reporting skipped (unit test run)` for the validates. No email was sent.
- `test-data/orders.json` is the only side-effect of these smokes: it grew from 1 to 5 entries during the initial label-patch validation (`FRD0083797-01` from a prior session, then `AUD0021167-01`, `FRD0083798-01`, `USD0073213-01`, `THD0016816-01`), to 6 entries after the AU pickup follow-up smoke (`AUD0021168-01`), then to 7 entries after the AU home headless follow-up smoke (`AUD0021169-01`).

Diff scope:

- Only `pages/checkout/CheckoutPaymentPage.ts` was modified (sha `f6c190cb…` → `c9709d69…`).
- `package.json`, `package-lock.json`, `playwright.config.ts`, `global-teardown.ts`, `.env`, `utils/**`, `tests/**` are all unchanged.

## 7. Email safety

| Check                                            | Status                                                         |
| ------------------------------------------------ | -------------------------------------------------------------- |
| `npm run validate` email behavior                | Disabled by hard guard in `global-teardown.ts`                 |
| Unit project guard                               | `--project=unit` skips email immediately                       |
| `.env SEND_EMAIL_REPORT=true` impact on validate | Ignored for unit runs                                          |
| E2E email path                                   | Still opt-in through `SEND_EMAIL_REPORT=true`                  |
| E2E email regression check                       | PASS — FR home `FRD0083794-01` (2026-05-12)                    |
| `SEND_EMAIL_REPORT=true` on non-unit E2E         | Email report sent successfully via `transporter.sendMail`      |
| `CLEAR_ORDERS_AFTER_EMAIL=all`                   | Clears `test-data/orders.json` after a successful email report |
| `SEND_EMAIL_REPORT=false`                        | Safe default for local validation and smokes                   |
| `transporter.sendMail` during validate           | Not executed                                                   |

Notes:

- `global-teardown.ts` skips email immediately when the run includes `--project=unit` (matched by `/--project[= ]+unit\b/` against `process.argv`). This is the path used by `npm run test:unit`, which is in turn called by `npm run validate`.
- This guarantees `npm run validate` never sends an email, even if `.env` contains `SEND_EMAIL_REPORT=true` (which is currently the case).
- Non-unit runs still go through the existing `SEND_EMAIL_REPORT === 'true'` guard. The E2E email path remains explicit opt-in via `SEND_EMAIL_REPORT=true npm run test:e2e:headed -- --project=celine-fr`.
- During the post-Adyen-fix smokes, `SEND_EMAIL_REPORT=false` was used and the global teardown confirmed `📧 Email reporting is disabled (SEND_EMAIL_REPORT=false)`. No email was sent.
- E2E email regression check (2026-05-12): a non-unit E2E run with `SEND_EMAIL_REPORT=true` on FR home was executed deliberately to verify the path. The order `FRD0083794-01` was placed and the global teardown logged `✅ Email configuration verified successfully`, `📧 Sending email report to: …`, and `✅ Email report sent successfully!`. The validate that ran immediately after re-confirmed `📧 Email reporting skipped (unit test run)` — proving the unit-only guard does not interfere with the E2E path.
- The SMTP Message ID returned by the server is intentionally not stored in this baseline (kept in the local run log only).
- Because `CLEAR_ORDERS_AFTER_EMAIL=all` is enabled in the environment, `test-data/orders.json` is cleared after a successful email report. This is the observed behavior after the regression check; the file went from 5 entries to 0.
- Edge case: a mixed Playwright run containing both `--project=unit` and an E2E project would trigger the unit guard and skip email. This is not a normal project workflow.

## 8. Known limitations

- FR pickup is currently blocked on the sandbox: the PICK-UP tab is absent from the `/fr-fr/checkout` DOM (observed 2026-05-12). Failure happens at `CheckoutShippingPage.ts:1060` before payment, unrelated to the Adyen iframe fix. Retry once the sandbox restores Click & Collect for FR.
- JP standard delivery is currently affected by a known sandbox issue (dev.celine.com, observed 2026-05-11) — JP Click & Collect is unaffected.
- US and AU home Adyen flows were re-smoked after the Adyen iframe fix and pass (USD0073212-01 — 46.0s, AUD0021165-01 — 44.5s). Combined with FR home (FRD0083792-01 — 42.5s), all three currently testable Adyen regions are validated runtime.
- TH home Cybersource was re-smoked after the Adyen iframe fix and passes (THD0016815-01 — 51.1s).
- Cybersource expiration date and cardholder name are regular page inputs and are filled outside `utils/cybersourceHelper.ts` (in `pages/checkout/CheckoutPaymentPage.ts`); the new `tests/unit/cybersourceHelper.spec.ts` is intentionally scoped to the helper's iframe-based fields (`Card number`, security code) and does not assert anything about expiry/cardholder TH inputs. Those remain covered only by the TH home E2E smoke.
- AU Adyen home regression observed on 2026-05-12 (sandbox: `#rb_scheme.click({ force: true })` no longer mounted the Adyen panel) was worked around in automation by the Credit Card label trigger patch (see §6c). The sandbox-side root cause has not been confirmed fixed by Celine; the patch keeps the legacy force-click as a final fallback so the previous behaviour remains supported if the sandbox reverts. AU pickup is now validated against the label patch in a follow-up smoke (`AUD0021168-01` — 40.6s, see §6c). AU home headless is also validated against the label patch in a separate follow-up smoke (`AUD0021169-01` — 56.7s, see §6c) — the original headless symptom (`element is not visible`, `Timeout 3000ms` on Adyen fields) is gone. Headless was only validated on AU home; FR/US/TH headless and AU pickup headless were not exercised. Remaining unverified paths after the patch: JP home (sandbox issue, see above). FR pickup remains sandbox-dependent (PICK-UP tab still absent from the DOM as of 2026-05-12).
- FormHelper unit coverage is partial: `forceElementVisible` is the only `formHelper.ts` symbol currently imported by `pages/checkout/` (`CheckoutShippingPage.ts:6`, used at `:330`) and remains outside `tests/unit/formHelper.spec.ts`. `clickElement`, `selectDropdownOption`, `toggleCheckbox`, and `validateFieldValue` are likewise not covered by the unit spec. `CheckoutShippingPage.ts:267` reimplements a private `fillField` that does not delegate to the helper, so the unit spec is best understood as a regression guard for the public API contract rather than a proxy for checkout flow correctness.
- `test-data/orders.json` grows after each E2E run when no email report is sent. With `CLEAR_ORDERS_AFTER_EMAIL=all` (current `.env` setting), it is cleared after every successful email report, so it is not a long-term cumulative journal. To preserve a journal, set `CLEAR_ORDERS_AFTER_EMAIL=` empty or `=old`. Manual trim via `scripts/test-cleanup.js` is also available.
- Tracker concurrency is now validated on a real FR/US/AU parallel home campaign (3 workers, see §12). Remaining limitations: no large-N stress campaign; no TH parallel campaign; JP home and FR pickup remain sandbox-dependent (see bullets above); email-report parallel runs are not validated.
- PayPal (`TEST_PAYMENT_METHOD=paypal`) was validated on FR, US, AU, and TH home delivery only (see §13). JP was explicitly excluded by user instruction; PayPal C&C (pickup) was not validated on any region in this lot. The PayPal flow uses two locator conventions OR'd together (Adyen `#rb_paypal` / Cybersource `#select-payment-method-PAYPAL`); a new payment provider could require extending the OR.
- Project has no Git repository at the moment (intentional, local-only project).
- Root `README.md` and `SECURITY_NOTES.md` remain intentionally excluded from Prettier coverage (anchored patterns in `.prettierignore`); `scripts/README.md` and `QUALITY_BASELINE.md` are now covered by `format:check` (see §4).

## 9. Recommended next steps

1. Retry FR pickup once the PICK-UP tab is available again on the sandbox.
2. Retry JP home once the sandbox standard-delivery issue is fixed.
3. Review orders cleanup policy if `test-data/orders.json` should remain a cumulative journal (currently `CLEAR_ORDERS_AFTER_EMAIL=all` purges it after every successful email report).
4. Add multi-run stability if repeated-run confidence is needed (current Adyen smokes are single runs).
5. Extend unit coverage to the remaining helpers where useful (`utils/retryHelper.ts`, `utils/selectorStrategy.ts`, plus the FormHelper symbols left out of `tests/unit/formHelper.spec.ts`: `forceElementVisible`/`clickElement`/`selectDropdownOption`/`toggleCheckbox`/`validateFieldValue` — only if a meaningful non-browser test can validate behavior without becoming a shallow mock). `AdyenHelper`, `CybersourceHelper`, and `FormHelper` already have dedicated coverage (see §5); the rest is still exercised only through E2E.
6. Optional: JP home retry once the sandbox standard-delivery issue is fixed (see §8) — JP was not validated against the Credit Card label patch.
7. Optional: FR pickup retry once the PICK-UP tab returns on the FR sandbox (see §8) — currently blocks before payment, so the label patch cannot be exercised on FR pickup yet.
8. Optional: cross-region headless smokes (FR/US/TH home and AU pickup) only if headless becomes the CI convention — only AU home headless was validated against the label patch in §6c.
9. Add CI gate only if the project is moved to Git.
10. Add baseline auto-verification if documentation/config drift becomes a recurring issue.
11. Optional: large-N tracker stress campaign (5+ workers, FR/US/AU home with multiple repetitions per project) only if parallel E2E becomes a heavy CI workload — current validation is a single 3-worker run (see §12).
12. Optional: TH home parallel validation (Cybersource branch) only if the parallel scope is extended beyond Adyen regions — current validation covers FR/US/AU home only (see §12).
13. Optional: email-report parallel validation (`SEND_EMAIL_REPORT=true` with multi-worker E2E) only if email reporting needs to coexist with parallel runs — currently `SEND_EMAIL_REPORT=false` is the validated default for parallel campaigns.
14. Optional: PayPal C&C (pickup) validation per region — currently only home delivery was smoked with PayPal in §13. Activate via `TEST_PAYMENT_METHOD=paypal TEST_DELIVERY_MODE_<REGION>=pickup`.
15. Optional: validate PayPal on JP once the JP standard-delivery sandbox issue is fixed (see §8). PayPal was explicitly excluded from JP in the §13 campaign per user instruction.

## 10. Baseline rule

Before any future risky change:

```bash
npm run validate
```

After checkout-related changes:

```bash
TEST_DELIVERY_MODE_FR=pickup SEND_EMAIL_REPORT=false npm run test:e2e:headed -- --project=celine-fr
TEST_DELIVERY_MODE_FR=home SEND_EMAIL_REPORT=false npm run test:e2e:headed -- --project=celine-fr
```

## 11. E2E execution policy

The runtime persistence layer is now **hardened for inter-worker concurrency** by the cross-process file lock added in §12. The serial-only mode below is kept as the recommended conservative default for local smoke work, but parallel multi-project E2E is no longer a hard constraint for the JSON trackers — it has been validated empirically in §12 (FR/US/AU home, 3 workers).

Historical context (pre-hardening, kept here for the rationale trail):

- `utils/orderTracker.ts` previously serialized writes only **within a single Node process** via an in-process `writeQueue`. Inter-worker concurrency was not protected.
- `utils/testResultTracker.ts` previously had **no write queue at all**, so concurrent writes from multiple Playwright workers would last-writer-wins on `test-data/test-results.json`.
- `playwright.config.ts:32-35` declares `fullyParallel: true` and locally defaults to `workers: undefined` (all CPUs). Without an explicit `--workers=1`, a non-headed E2E run on this machine shards tests across all CPUs.

Current state (post-hardening, see §12 for the full design and proof):

- Both trackers wrap their read-modify-write cycles in a cross-process advisory file lock (`utils/fileLock.ts`).
- A real parallel campaign with 3 workers (FR + US + AU home) has been executed and persisted 3 orders and 3 test results without loss, JSON corruption, or `.tmp.*` / `.lock` leftovers.
- Email-reporting parallel runs have **not** been validated; keep `SEND_EMAIL_REPORT=false` unless a dedicated email-report parallel validation is planned.
- TH parallel, JP, and FR pickup parallel paths have **not** been validated (sandbox dependencies + scope choice — see §8).
- Large-N (5+ workers) stress campaigns have **not** been executed.

Operational rule: **Serial E2E remains the recommended default for local smoke work; parallel multi-project E2E is now safe for the JSON trackers within the validated scope (FR/US/AU home, 3 workers, `SEND_EMAIL_REPORT=false`).**

Current command surface:

| Command                         | Workers                               | Tracker safety                                                                                                       |
| ------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `npm run test:e2e:headed`       | 1                                     | Safe — `--headed --workers=1` hard-coded in `package.json:14`                                                        |
| `npm run test:e2e:debug`        | 1                                     | Safe — `--debug` forces a single worker                                                                              |
| `npm run test:orders -- --xx=N` | 1 (sequential per N)                  | Safe — `scripts/run-orders.js` runs each test sequentially per locale (see `scripts/README.md`)                      |
| `npm run test:e2e`              | undefined (all CPUs) or `--workers=N` | Safe for the JSON trackers under the file lock added in §12 (validated with `--workers=3` on FR/US/AU home, see §12) |

Recommended invocation patterns:

```bash
# Default smoke pattern — matches §6, §6b, §6c:
SEND_EMAIL_REPORT=false npm run test:e2e:headed -- --project=celine-fr

# Single worker, headless:
SEND_EMAIL_REPORT=false npm run test:e2e -- --project=celine-fr --workers=1

# Validated parallel pattern (FR + US + AU home, 3 workers — see §12):
TEST_DELIVERY_MODE_FR=home TEST_DELIVERY_MODE_US=home TEST_DELIVERY_MODE_AU=home \
  SEND_EMAIL_REPORT=false npm run test:e2e \
  -- --project=celine-fr --project=celine-us --project=celine-au --workers=3
```

Status decision: **STOP — PARALLEL TRACKERS VALIDATED.** TRACKER-CONCURRENCY-HARDENING V1 (§12) is in place and has been confirmed by a real 3-worker E2E campaign. No `TRACKER-CONCURRENCY-HARDENING V2` is required. The serial-only default above remains the recommended pattern for local smoke work.

## 12. Tracker concurrency hardening

`utils/orderTracker.ts` and `utils/testResultTracker.ts` now serialize their read-modify-write cycles through a cross-process advisory file lock. This closes the inter-worker race documented in §11.

Strategy:

- New helper `utils/fileLock.ts` exposes `withFileLock(lockPath, fn, options)` (async) and `withFileLockSync(lockPath, fn, options)` (sync).
- Acquisition primitive: `fs.openSync(lockPath, 'wx')` — atomic exclusive create on Windows / macOS / Linux. No external dependency.
- Retry loop with `retryDelayMs` backoff (default 50 ms), bounded by `timeoutMs` (default 5 000 ms). The error message names the lock file path.
- Stale lock files (mtime older than `staleAfterMs`, default 30 000 ms) are removed before retrying so a crashed worker cannot block successors indefinitely.
- Lock release runs in `finally` (`closeSync` then `unlinkSync`, both with `try/catch`).
- Sync sleep uses `Atomics.wait` on a `SharedArrayBuffer`-backed `Int32Array` so the sync variant does not burn CPU while waiting.
- Atomic JSON write is preserved (temp file + `renameSync`). `orderTracker` now also unlinks its temp file in the catch path so a partial write cannot leave `.tmp.*` leftovers.

Tracker integration:

- `OrderTracker.save()`, `clear()`, and `cleanupOld()` are wrapped in `withFileLock(this.lockFile, ...)` (async). The previous in-process `writeQueue` / `serialize()` was removed — the file lock subsumes it (and adds inter-worker safety).
- `TestResultTracker.record()` and `clear()` are wrapped in `withFileLockSync(this.lockFile, ...)` (sync) — the `record()` API stays sync to preserve callers in `global-teardown.ts`, `utils/emailReporter.ts`, and `tests/celine-purchase.spec.ts`.
- `TestResultTracker` is now exported as a class (in addition to the existing singleton) so unit tests can instantiate per-test trackers via `testInfo.outputPath()`. The default singleton path (`test-data/test-results.json`) is unchanged.
- Lock file path: `${jsonFile}.lock` (e.g. `test-data/orders.json.lock`). The `.lock` suffix is the only on-disk artifact of the locking scheme.

Public API preservation:

- `OrderTracker` — every method keeps the same signature (`Promise<…>`).
- `TestResultTracker` — every method keeps the same signature (sync `void` for `record` / `clear`, sync getters).
- File format on disk for both `orders.json` and `test-results.json` is unchanged.
- `CLEAR_ORDERS_AFTER_EMAIL` is unchanged.

Test coverage (added 2026-05-12, see §5):

- `tests/unit/fileLock.spec.ts` (8 tests) — acquire/release for both variants, in-process `Promise.all` serialization, stale lock cleanup, timeout error, and a cross-process test spawning 3 child Node processes that each perform 5 read-modify-write cycles via an inlined sync-lock equivalent. Asserts all 15 entries are preserved with no `.tmp.*` or `.lock` leftovers.
- `tests/unit/testResultTracker.spec.ts` (5 tests) — `record()` persistence, append, `clear()`, `getStats()`, and a cross-process test (3 children × 5 records → 15 entries preserved).
- `tests/unit/orderTracker.spec.ts` — the previously skipped `concurrent saves` test is re-enabled and now asserts strict `length === 5` plus the exact set of order numbers under in-process `Promise.all`.

What the hardening lot DID validate:

- Tracker write paths are unit-tested for concurrent writes, both in-process (Promise.all) and cross-process (spawned child Node processes).
- `validate` is green: 57 unit tests pass, 0 vulnerabilities, lint/format clean.
- No `.tmp.*` or `.lock` leftover in `test-data/` or `test-results/` after the unit suite.

Parallel E2E validation (E2E-PARALLEL-VALIDATION-CAMPAIGN V1, executed 2026-05-12):

- Campaign: FR home + US home + AU home, 3 projects, 3 workers, headless, single attempt.
- Command:

  ```bash
  TEST_DELIVERY_MODE_FR=home TEST_DELIVERY_MODE_US=home TEST_DELIVERY_MODE_AU=home \
    SEND_EMAIL_REPORT=false npm run test:e2e \
    -- --project=celine-fr --project=celine-us --project=celine-au --workers=3
  ```

- Result: `Running 3 tests using 3 workers` → `3 passed (53.0s)`, exit code 0.
- Orders captured (1 per project): `AUD0021170-01`, `FRD0083799-01`, `USD0073214-01`.
- `test-data/orders.json` moved from 7 entries to 10 entries (3 new, 0 lost).
- `test-data/test-results.json` moved from 11 entries to 14 entries (3 new, 0 lost).
- The lock contention was real: AU and FR wrote to `orders.json` 471 ms apart (`2026-05-12T19:13:54.506Z` vs `2026-05-12T19:13:54.977Z`), and to `test-results.json` 470 ms apart (timestamps `1778613234515` vs `1778613234985`). Without the file lock, one of each pair would have been lost to a read-modify-write race.
- No JSON corruption: both files parsed cleanly, no duplicate entries, no malformed records.
- No `.tmp.*` or `.lock` leftover in `test-data/` or `test-results/` after the campaign.
- No email was sent: global teardown logged `📧 Email reporting is disabled (SEND_EMAIL_REPORT=false)`.
- No source/config/doc file changed during the campaign: 21 source/config/doc files SHA-256-hashed before and after the campaign — all identical.
- Final `validate` after the campaign: PASS (57 unit tests, 0 vulnerabilities).

This validates the tracker write path under a real 3-worker E2E campaign for the FR/US/AU home Adyen flow. It is **not** a stress test for large N workers, and TH (Cybersource), JP, FR pickup, and email-report parallel runs were not included in this campaign.

What is still NOT validated by this campaign:

- Large-N stress (5+ workers, dozens of writes per second).
- TH (Cybersource) home parallel — code path is provider-agnostic for the lock, but no empirical run.
- JP home parallel — sandbox standard delivery still affected by a known issue (see §8).
- FR pickup parallel — PICK-UP tab still absent from the DOM (see §8).
- Email-report parallel runs — keep `SEND_EMAIL_REPORT=false` for parallel campaigns until a dedicated email-report parallel validation is executed.

## 13. PayPal payment method baseline

PayPal was added as an alternative payment method alongside the existing credit card flow (Adyen for FR/US/AU, Cybersource for TH). Activation is opt-in per run via `TEST_PAYMENT_METHOD=paypal` (default `card` — credit card flow unchanged).

Implementation surface:

- `pages/checkout/CheckoutPaymentPage.ts` — new public method `payViaPayPal(email, password)` orchestrates: PayPal radio selection → terms acceptance → PayPal SDK CTA click → popup handling (email/Next, password/Log In) → "Agree & Pay Now" → popup close. Sibling `placeOrder()` is bypassed for the PayPal branch (PayPal submits the order from inside the popup).
- `config/testData.ts` — new exported constant `PAYPAL_CREDENTIALS` reading `PAYPAL_EMAIL` / `PAYPAL_PASSWORD` from env only. Sprint 1 removed the hardcoded sandbox fallbacks that used to sit here; the accessor now throws a clear "missing env var" error when unset.
- `tests/celine-purchase.spec.ts` — STEP 6 ("Enter payment information") branches on `TEST_PAYMENT_METHOD`: PayPal calls `payViaPayPal()` and returns immediately; card flow runs `selectCreditCardPayment()` + `fillPaymentInfo()` unchanged. STEP 7 ("Submit order and validate confirmation") skips `placeOrder()` + `handle3DSChallenge()` when paymentMethod is `paypal` (the popup has already submitted), then waits for Order-Confirm exactly as before.

Locator strategy:

- Radio selectors are OR'd to cover both provider conventions on Celine:
  - Adyen (FR/US/AU): `#lb_paypal` / `#rb_paypal`
  - Cybersource (TH): `label[for="select-payment-method-PAYPAL"]` / `#select-payment-method-PAYPAL`
- PayPal SDK CTA selector is OR'd to cover the multiple render variants observed: `[data-funding-source="paypal"]`, `div.paypal-button-label-container`, `div[class*="paypal-button-row"]`, `img.paypal-button-logo[aria-label="paypal"]`, `[class*="paypal-button"][role="link"]`, `[class*="paypal-button"][role="button"]`. Lookup is iframe-aware: the top frame is probed first, then any frame whose URL matches `/paypal/i`. PayPal Smart Buttons v7 typically renders in a cross-origin iframe served from `sandbox.paypal.com/smart/buttons` or `/smart/button`.
- Popup is captured via `this.page.context().waitForEvent('page', { timeout: TIMEOUTS.navigation })` armed **before** the CTA click. Re-entrancy with the iframe-click is safe because popups are emitted at the `BrowserContext` level.
- PayPal popup login covers two variants:
  - Single-form: email + password visible together → fill both, click `#btnLogin` once.
  - Email-first: email field only → fill email, click `#btnNext` to advance, fill password on the next view, click `#btnLogin`. This is the variant currently served on the Celine sandbox.
- Pre-click hardening on PayPal radio: a 2 s `waitForTimeout` is inserted before the label click to let Celine's billing form fully hydrate its change-event listeners. Without this, a too-early click sets `el.checked = true` without the page reacting, and the Submit / PayPal CTA stays absent. After the click, the radio's `change` event is also dispatched explicitly via `el.dispatchEvent(...)` as a belt-and-suspenders measure.

3DS interaction:

- PayPal flow does **not** go through `handle3DSChallenge()` (3DS is bound to the Adyen card flow only — `4089670000000014` EFTPos AU triggers the Adyen 3DS simulator). PayPal handles its own auth inside the popup.
- The PayPal branch returns from STEP 6 (`payViaPayPal()`) before STEP 7's `placeOrder()` call. The 3DS handler is therefore never reached on a PayPal run, by design.

Runtime validation (single sequential headless run per region, 2026-05-21):

| Region              | Provider convention | Order         | Duration | PayPal flow steps observed                                                                                  |
| ------------------- | ------------------- | ------------- | -------: | ----------------------------------------------------------------------------------------------------------- |
| FR home PayPal      | Adyen               | FRD0083988-01 |     1.3m | Radio → CGV → CTA (iframe `paypal.com/smart/buttons`) → popup → email → Next → password → Log In → Pay Now  |
| US home PayPal      | Adyen               | USD0073312-01 |     1.2m | Same path                                                                                                   |
| AU home PayPal      | Adyen               | AUD0021359-01 |     1.8m | Same path (shipping retries observed before payment, unrelated to PayPal)                                   |
| TH home PayPal      | Cybersource         | THD0016905-01 |     1.1m | Radio (`#select-payment-method-PAYPAL`) → CGV → CTA (iframe `paypal.com/smart/button`) → same popup pattern |
| AU home PayPal (HD) | Adyen (headed)      | AUD0021358-01 |     1.1m | Initial headed validation that drove the implementation                                                     |

All five PayPal smokes passed end-to-end on the first attempt with the final implementation (the headed AU validation `AUD0021358-01` preceded the headless campaign and used the same code). No retries inside the PayPal flow itself.

Files changed in this lot:

- `pages/checkout/CheckoutPaymentPage.ts` — added `payViaPayPal()` (and unrelated `handle3DSChallenge()` earlier in the same session).
- `config/testData.ts` — added `PAYPAL_CREDENTIALS` constant + AU card catalog (`AU_CARDS` with Visa default and EFTPos alternative, exposed via `TEST_CARD_SCHEME_AU` and overridable raw via `TEST_CARD_NUMBER_AU`/`TEST_CARD_EXPIRY_AU`/`TEST_CARD_CVV_AU`).
- `tests/celine-purchase.spec.ts` — added `TEST_PAYMENT_METHOD` branching in STEP 6 + STEP 7.
- AU default product URL switched from the gladiator sandal (`352463778C.19DK`) to the block sneakers (`346163338C.01OP`) for stock reliability — independent of PayPal but in the same edit session.

Email safety:

- `SEND_EMAIL_REPORT=false` was set for every PayPal smoke. Global teardown logged `📧 Email reporting is disabled (SEND_EMAIL_REPORT=false)` for each.
- No `orders.json` write race was observed because the §13 campaign was sequential (per-region one process at a time), not parallel.

What is NOT validated by this campaign:

- PayPal C&C (pickup) on any region — only home delivery was smoked.
- PayPal on JP — explicitly excluded per user instruction (and JP home is still blocked by the sandbox issue documented in §8).
- PayPal in parallel multi-region runs — the popup capture (`context.waitForEvent('page')`) is per-context and would work, but it has not been empirically run in parallel.
- PayPal credentials override path (`TEST_PAYPAL_EMAIL` / `TEST_PAYPAL_PASSWORD`) — only the default sandbox account was used.
- PayPal failure paths — wrong password, account locked, declined payment, popup blocker, popup closed mid-flow. The current implementation throws on each step failure but no negative-path smoke was executed.
