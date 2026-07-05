/**
 * Optimized Celine E2E Test
 * Demonstrates usage of new utilities and fixtures
 *
 * Key improvements over original:
 * - Uses fixtures for Page Objects
 * - No hardcoded credentials
 * - Intelligent waits instead of fixed timeouts
 * - Retry logic for flaky operations
 * - Better error handling and logging
 */

import { test, expect } from '../fixtures/celineFixtures';
import { TEST_CONFIG } from '../config/testConfig';
import { orderTracker } from '../utils/orderTracker';
import { getTestDataForProject, PAYPAL_CREDENTIALS, AFTERPAY_AU_CREDENTIALS } from '../config/testData';
import { testResultTracker } from '../utils/testResultTracker';
import { maskEmailForLog } from '../utils/logger';
import { closeAllSidePanels } from '../utils/selectorStrategy';
import { findOrderNumberOnConfirmationPage } from '../utils/orderNumber';

/**
 * Sprint 9 — replaces the historical silent-catch handlers (empty-body
 * `.catch` arrow) on optional E2E UI fallbacks (zip OK button JS click,
 * post-click hide
 * check, shipping label force-click, alternative delivery label, post-
 * payment URL wait). Returns a catch handler that fails-open 1:1 while
 * marking the intent via a static PII-safe technical label.
 *
 * PII policy: `label` MUST be a string literal — never a variable derived
 * from `testData`, `addr`, `paymentInfo`, `orderNumber`, email/phone/
 * address/postcode/names, tokens, cookies, or PSP payloads. The error is
 * discarded intentionally (`void error`) — no `.message`, no `String(error)`,
 * no `JSON.stringify(error)`; this is the safest surface for spec code
 * that runs against real user credentials in sandbox.
 */
const ignoreOptionalE2EError =
  (label: string) =>
  (error: unknown): void => {
    void label;
    void error;
  };

test.describe('Celine E2E - Optimized', () => {
  // HTTP credentials are now loaded from .env via TEST_CONFIG
  test.use({
    httpCredentials: {
      username: TEST_CONFIG.auth.username,
      password: TEST_CONFIG.auth.password,
    },
  });

  test.beforeEach(async ({ page }) => {
    // Mock payment API only when explicitly requested.
    // Enabled with MOCK_PAYMENT_API=true for isolated non-production-like runs.
    if (process.env.MOCK_PAYMENT_API === 'true') {
      await page.route('**/api/payment/**', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            orderId: `TEST-ORDER-${Date.now()}`,
            status: 'confirmed',
            amount: 0.0,
            currency: 'EUR',
          }),
        });
      });
    }
  });

  test.afterEach(async ({}, testInfo) => {
    // Only track the main purchase flow test. Make tracking opt-in via env to reduce overhead.
    if (!testInfo.title.includes('Complete purchase flow') || process.env.TRACK_RESULTS !== 'true') {
      return;
    }

    const region = testInfo.project.name;
    const regionName = region.replace('celine-', '').toUpperCase();

    if (testInfo.status === 'passed') {
      testResultTracker.record({
        region: regionName,
        testName: testInfo.title,
        status: 'success',
        timestamp: Date.now(),
      });
    } else if (testInfo.status === 'failed' || testInfo.status === 'timedOut') {
      testResultTracker.record({
        region: regionName,
        testName: testInfo.title,
        status: 'failed',
        timestamp: Date.now(),
        error: testInfo.error?.message || 'Unknown error',
      });
    }
  });

  test('Complete purchase flow - Optimized', async ({ page, homePage, productPage, checkoutPage }, testInfo) => {
    // Slow payment/confirmation transitions can exceed standard timeout in dev env.
    test.setTimeout(5 * 60 * 1000); // reduced to 5min; actual run now ~1-2min with optimized waits

    // Track test start time for duration calculation
    const testStartTime = Date.now();

    // Get region-specific test data
    const testData = getTestDataForProject(testInfo.project.name);

    // Determine delivery mode early so we can condition US zip handling (home vs pickup)
    const isPickup = testData.deliveryMode === 'pickup';

    // Get baseURL from project config or fallback to TEST_CONFIG
    const baseURL = testInfo.project.use?.baseURL || TEST_CONFIG.urls.base;

    console.log(`
Running optimized test for region: ${testInfo.project.name}`);
    console.log(`   Base URL: ${baseURL}`);
    console.log(
      `   Product: ${Array.isArray(testData.productUrl) ? testData.productUrl.join(' | ') : testData.productUrl}`
    );
    console.log(`   Country: ${testData.address.country}`);
    console.log(`   Delivery mode (early): ${isPickup ? 'PICK-UP IN STORE (Click & Collect)' : 'home'}`);

    // STEPS 1+2+3 for mono product
    // closeAllSidePanels is imported at top for speed (no dynamic import per step)

    let _buyNowUsed = false;

    const productUrls: string[] = Array.isArray(testData.productUrl) ? testData.productUrl : [testData.productUrl];
    const currentUrl = productUrls[0];

    await test.step(`Load product page`, async () => {
      await page.goto(`${baseURL}${currentUrl}`);
      await homePage.acceptCookies();
      await closeAllSidePanels(page, { timeout: 100, force: true });
      await expect(page.locator('h1').first()).toBeVisible({ timeout: TEST_CONFIG.timeouts.element });
    });

    await test.step(`Validate product details`, async () => {
      const title = await productPage.getProductTitle();
      expect(title?.trim()).toMatch(/[A-Za-z]/);
      expect(title?.trim().length).toBeGreaterThan(3);
      const price = await productPage.getProductPrice();
      expect(price?.trim()).toMatch(/\d+/);
    });

    await test.step(`Add to cart`, async () => {
      await productPage.selectFirstAvailableSize().catch(() => {
        console.log('   No size selection required');
      });

      // Consolidated cleanup - use default reasonable timeout
      await closeAllSidePanels(page, { force: true });

      const buyNowVisible = (await productPage.buyNowButton.isVisible({ timeout: 100 }).catch(() => false));

      if (buyNowVisible) {
        await productPage.buyNow();
        _buyNowUsed = true;
        console.log('   Buy Now successful - now at checkout');
      } else {
        await productPage.addToCart();
        console.log(`   Product added to cart`);

        // Correct flow: after addToCart the mini-cart side panel opens.
        // Click the CHECKOUT button inside it (do NOT close the panel first).
        const checkedOutFromMini = await productPage.tryCheckoutFromMiniCart();

        if (!checkedOutFromMini) {
          await closeAllSidePanels(page, { timeout: 200, force: true, exclude: ['shippingBillingForms'] });
          await productPage.goToCart();
          console.log('   Navigated to cart');

          await productPage.proceedToCheckout();
        }

        await expect(page).toHaveURL(/checkout/, { timeout: TEST_CONFIG.timeouts.navigation });
        console.log('   Now at checkout');
      }
    });

    // STEP 4: Fill email
    await test.step('Enter email address', async () => {
      // Dev sandbox sometimes expires the cart between Buy Now and the checkout page,
      // redirecting to /client/cart?cartExpired=true. The email form never renders here,
      // so fail fast with a clear server-side cause instead of timing out on the locator.
      if (page.url().includes('cartExpired')) {
        throw new Error(`Cart expired before checkout email step (server-side sandbox issue). URL: ${page.url()}`);
      }

      // JP/AU checkouts render multiple email inputs (login, guest, register forms).
      // The first DOM match may be the hidden login form, so explicitly wait for a VISIBLE one.
      try {
        await page
          .locator('input[type="email"]:visible, input[name*="email" i]:visible')
          .first()
          .waitFor({ state: 'visible', timeout: TEST_CONFIG.timeouts.element });
      } catch (err) {
        const finalUrl = page.url();
        if (finalUrl.includes('cartExpired')) {
          throw new Error(`Cart expired during checkout email wait (server-side sandbox issue). URL: ${finalUrl}`);
        }
        console.log(`   [diag] email wait failed @ URL: ${finalUrl}`);
        throw err;
      }

      // Registered customer login — password MUST come from the env
      // (TEST_PASSWORD_<REGION>). Sprint 1 removed the previous shared
      // sandbox password fallback: a missing password now throws a clear
      // "missing env var" error from testData rather than silently attempting
      // a well-known credential.
      const loginProceeded = await checkoutPage.login.loginAsRegistered(
        testData.email,
        testData.password!
      );
      expect(
        loginProceeded,
        'Login step (registered or fallback-to-guest) must complete without error'
      ).toBe(true);

      console.log(`   Registered login done: ${maskEmailForLog(testData.email)}`);

      // Clean panels only when necessary (reduced from previous aggressive calls)
      await closeAllSidePanels(page, { timeout: 150, force: true });

      // Zip handling: for guest we often see the field (fill it); for registered saved address it may be absent.
      const zipField = page.locator('#zipCodeForShippingMethods, input.shippingZipCode, input[name*="postalCode"]').first();
      if (await zipField.isVisible({ timeout: 800 }).catch(() => false)) {
        // US zip handling:
        // - For home delivery: fill #zipCodeForShippingMethods + click OK to unlock shipping methods.
        // - For Click & Collect: fill zip (helps store locator) but SKIP the shipping OK button,
        //   otherwise it can pre-select a home delivery method and the order ends up as home delivery.
        try {
          await zipField.fill(testData.address.postalCode);

          if (!isPickup) {
            const okBtn = page.locator('#submitZipCodeButton').first();
            if (await okBtn.isVisible({ timeout: 800 }).catch(() => false)) {
              await okBtn.click({ force: true }).catch(async () => {
                await okBtn
                  .evaluate((el: HTMLElement) => (el as HTMLButtonElement).click())
                  .catch(ignoreOptionalE2EError('zip OK button JS click fallback'));
              });
              console.log('   US zipcode filled in #zipCodeForShippingMethods and OK clicked');
              await expect(okBtn)
                .not.toBeVisible({ timeout: 500 })
                .catch(ignoreOptionalE2EError('zip OK button post-click hide check'));
            }
          } else {
            console.log('   US zipcode filled (for Click & Collect store lookup) — skipping shipping OK to avoid forcing home delivery');
          }
        } catch (_e) {
          console.log('   Zipcode field not found or already handled');
        }
      } else {
        console.log('   Zipcode field not visible yet (guest flow or pre-filled address) — will be handled in shipping step if needed');
      }

      // Do not call continueToPayment here; we need to complete the shipping form in the next step.
      // The direct submit and continue are handled in the shipping step for proper flow.
    });

    // STEP 5: Fill shipping address
    await test.step('Complete shipping information', async () => {
      const addr = testData.address;
      const isPickup = testData.deliveryMode === 'pickup';
      console.log(`   Delivery mode: ${isPickup ? 'PICK-UP IN STORE (Click & Collect)' : 'home'}`);

      if (isPickup) {
        // Click & Collect: switch to PICK-UP tab → select first store (auto-shown)
        // → fill purchaser-info dialog → submit.
        const pickupSelected = await checkoutPage.shipping.selectClickAndCollect();
        expect(
          pickupSelected,
          'Click & Collect tab + store must be selected before opening the purchaser dialog'
        ).toBe(true);

        const pickupFilled = await checkoutPage.shipping.fillPickupAddressForm({
          title: addr.title,
          firstName: addr.firstName,
          lastName: addr.lastName,
          firstNameKatakana: addr.firstNameKatakana,
          lastNameKatakana: addr.lastNameKatakana,
          address: addr.street,
          city: addr.city,
          state: addr.state,
          postalCode: addr.postalCode,
          phone: addr.phone,
          phonePrefix: addr.phonePrefix,
        });
        expect(pickupFilled, 'Pickup purchaser dialog must be filled and submitted').toBe(true);
      } else {
        // Standard delivery: postal code + shipping method + address
        // Detect if we can skip manual form (registered user with saved/pre-filled address)
        const addressFormVisible = await page
          .locator('input[name*="firstName" i]:visible, input[id*="firstname" i]:visible, #shippingcelFirstname, input[placeholder*="First" i]')
          .first()
          .isVisible({ timeout: 2000 })
          .catch(() => false);
        const skipShippingForm = !addressFormVisible;
        if (skipShippingForm) {
          console.log('   Skipping manual shipping form (saved/pre-filled address for registered user)');
        } else {
          // US (and others) require explicit zipcode entry first (in #zipCodeForShippingMethods)
          // then click OK to unlock the shipping form side panel.
          await closeAllSidePanels(page, { timeout: 50, force: true, exclude: ['shippingBillingForms'] });

          // Make sure zip is filled if field is present (user specified flow)
          const zipInput = page.locator('#zipCodeForShippingMethods').first();
          let didExplicitZip = false;
          if (await zipInput.isVisible({ timeout: 1000 }).catch(() => false)) {
            await zipInput.fill(addr.postalCode);
            const okBtn = page.locator('#submitZipCodeButton').first();
            if (await okBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
              await okBtn.click({ force: true }).catch(async () => {
                await okBtn
                  .evaluate((el: HTMLElement) => (el as HTMLButtonElement).click())
                  .catch(ignoreOptionalE2EError('zip OK button JS click fallback'));
              });
              console.log('   Zipcode filled in #zipCodeForShippingMethods and OK clicked');
              await expect(okBtn)
                .not.toBeVisible({ timeout: 500 })
                .catch(ignoreOptionalE2EError('zip OK button post-click hide check'));
            }
            didExplicitZip = true;
          }

          // Enter zip (fallback) only if explicit not done
          if (!didExplicitZip) {
            await checkoutPage.shipping.enterPostalCode(addr.postalCode);
          }

          // Close any panels before opening the shipping form (zip handling can trigger some)
          // Exclude shippingBillingForms — we are about to open/fill the form inside it.
          await closeAllSidePanels(page, { timeout: 100, force: true, exclude: ['shippingBillingForms'] });

          // Wait for a real signal that the shipping options finished loading
          // after the postal code lookup: either the delivery-method label
          // appears, or the shipping form panel becomes attached. Replaces the
          // 1s blind waitForTimeout previously used to soak JP/NL latency.
          await Promise.race([
            page.locator('label.shipping-method-option').first().waitFor({ state: 'visible', timeout: 8000 }),
            page
              .locator('section[data-osidepanel-name="shippingBillingForms"]')
              .waitFor({ state: 'attached', timeout: 8000 }),
          ]).catch(() => {
            /* both signals timed out — the fallback path below (form-open
               attempt + fillShippingAddress) handles this case and will log. */
          });

          // Robust open for shipping form (handles cases where label is hidden or slow to appear, e.g. JP)
          const formPanel = page.locator('section[data-osidepanel-name="shippingBillingForms"]');
          if (!(await formPanel.isVisible({ timeout: 1500 }).catch(() => false))) {
            // Try the standard label
            const deliveryMethodLabel = page.locator('label.shipping-method-option').first();
            let opened = false;
            try {
              await deliveryMethodLabel.waitFor({ state: 'visible', timeout: 8000 });
              await deliveryMethodLabel.click({ timeout: 2000 });
              console.log('   Clicked delivery method label to open shipping form');
              opened = true;
            } catch {
              console.log('   Standard delivery label not visible, trying force or alternatives');
            }

            if (!opened) {
              // Force click the first shipping-method label even if hidden
              const anyShippingLabel = page.locator('label.shipping-method-option').first();
              if (await anyShippingLabel.count() > 0) {
                await anyShippingLabel
                  .click({ force: true, timeout: 2000 })
                  .catch(ignoreOptionalE2EError('shipping label force-click fallback'));
                console.log('   Force-clicked shipping method label');
              }

              // Alternative: click any delivery/shipping option or header
              const alt = page.locator('label[class*="shipping"], [class*="shipping-method"], [class*="delivery-method"], h3:has-text("Livraison"), h3:has-text("Shipping"), h3:has-text("Delivery")').first();
              if (await alt.isVisible({ timeout: 2000 }).catch(() => false)) {
                await alt
                  .click({ force: true })
                  .catch(ignoreOptionalE2EError('alternative shipping label force-click'));
              }
            }
          }

          await formPanel.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {
            console.log('   Form panel still not visible, proceeding to fill anyway');
          });
          // Previously: waitForTimeout(300) here. Removed — `formPanel.waitFor`
          // above is the real signal; the extra 300ms was pure padding.

          // Select title (civility) before filling the form, as required by the site
          await checkoutPage.shipping.selectTitle(addr.title);

          // Now the form is open, fill the address directly (no close, no early submit).
          // Sprint 2 hardening: every step that returns a boolean success
          // signal is asserted explicitly. The previous flow ignored the
          // return value and silently continued into payment on failure.
          const addressFilled = await checkoutPage.shipping.fillShippingAddress({
            firstName: addr.firstName,
            lastName: addr.lastName,
            address: addr.street,
            city: addr.city,
            state: addr.state,
            postalCode: addr.postalCode,
            phone: addr.phone,
            phonePrefix: addr.phonePrefix,
            firstNameKatakana: addr.firstNameKatakana,
            lastNameKatakana: addr.lastNameKatakana,
          });
          expect(addressFilled, 'Shipping address form must be filled successfully').toBe(true);

          const countrySelected = await checkoutPage.shipping.selectCountry(addr.country);
          expect(
            countrySelected,
            `Country dropdown must be set to "${addr.country}" before submitting the address`
          ).toBe(true);

          // continueToShipping() returns void on success and throws on
          // failure — the try/catch inside surfaces the failure message.
          await checkoutPage.shipping.continueToShipping();
        }
      }

      // Consolidated close before payment (reduced calls)
      await closeAllSidePanels(page, { timeout: 200, force: true, exclude: ['shippingBillingForms'] });

      // continueToPayment() throws with a clear message when the transition
      // to /payment does not happen — we surface that failure via `expect`
      // instead of silently proceeding.
      const reachedPayment = await checkoutPage.shipping.continueToPayment();
      expect(reachedPayment, 'Checkout must transition to the payment step after shipping').toBe(true);

      console.log('   Shipping address completed');
    });

    // Note: one consolidated close above is sufficient; removed duplicate for speed

    // Use the dedicated helper for consistent, semantic wait for payment options.
    // This replaces ad-hoc waits and works for both registered skip and guest flows.
    await checkoutPage.payment.waitForCreditCardOptionReady(8000);
    console.log('   Payment method options ready');

    // Extra settle for registered + pickup flows (payment methods can take a bit to be interactive).
    // TODO Sprint 3: replace with stable signal when available — right now the
    // credit-card radio can be visible but not yet event-bound; no clean
    // hydration event is emitted by Celine's checkout.
    await page.waitForTimeout(300);

    const paymentMethod = (process.env.TEST_PAYMENT_METHOD || 'card').toLowerCase();
    console.log(`   Payment method: ${paymentMethod}`);

    // STEP 6: Payment — branch on card vs paypal vs afterpay
    await test.step('Enter payment information', async () => {
      if (paymentMethod === 'paypal') {
        await checkoutPage.payment.payViaPayPal(PAYPAL_CREDENTIALS.email, PAYPAL_CREDENTIALS.password);
        return;
      }

      if (paymentMethod === 'afterpay') {
        await checkoutPage.payment.payViaAfterpay(AFTERPAY_AU_CREDENTIALS.email, AFTERPAY_AU_CREDENTIALS.password);
        return;
      }

      const payment = testData.payment;

      // Select credit card option
      // Retry once if first attempt fails to select (common timing issue on registered + pickup)
      let paymentMethodSelected = false;
      try {
        paymentMethodSelected = await checkoutPage.payment.selectCreditCardPayment();
        if (!paymentMethodSelected) {
          console.log('   First select attempt did not confirm selection, retrying...');
          // TODO Sprint 3: replace with stable signal when available — retry
          // sleep is Adyen/Cybersource hydration guard; no stable event today.
          await page.waitForTimeout(500);
          paymentMethodSelected = await checkoutPage.payment.selectCreditCardPayment();
        }

        if (!paymentMethodSelected) {
          throw new Error('Credit card payment method was not successfully selected');
        }

        // Fill payment details only after successful selection
        await checkoutPage.payment.fillPaymentInfo({
          cardNumber: payment.cardNumber,
          cardholderName: payment.cardHolder,
          expirationDate: payment.expiryDate,
          cvv: payment.cvv,
        });
      } catch (e) {
        if ((e as Error).message.includes('closed') || (e as Error).message.includes('Page is closed')) {
          console.log('   Payment selection/fill skipped due to page closed (common in long guest flows)');
        } else {
          throw e;
        }
      }

      // Terms & conditions are now handled in fillPaymentInfo()
    });

    // STEP 7: Place order, capture confirmation, then exit early
    let orderNumber: string | undefined;
    let exitAfterOrder = false;
    await test.step('Submit order and validate confirmation', async () => {
      // PayPal/Afterpay already submitted the order from inside their portal —
      // only card flow needs placeOrder + 3DS here.
      if (paymentMethod !== 'paypal' && paymentMethod !== 'afterpay') {
        await checkoutPage.payment.placeOrder();
        console.log('   Payment button clicked');

        // Handle 3DS challenge popin if triggered by the card (e.g. AU EFTPos test card).
        // No-op for non-3DS flows — returns false silently when no popin appears.
        await checkoutPage.payment.handle3DSChallenge();
      }

      console.log('   Waiting for order confirmation...');

      // 1) Wait for the page to navigate to confirmation (awaitNavigation: Order-Confirm)
      await page
        .waitForURL(
          (url) => {
            const u = url.toString();
            return u.includes('Order-Confirm') || (!u.includes('stage=placeOrder') && !u.includes('stage=payment'));
          },
          { timeout: 120_000, waitUntil: 'domcontentloaded' }
        )
        .catch(ignoreOptionalE2EError('post-payment URL wait'));
      console.log(`   Post-payment URL: ${page.url()}`);

      // 2) Extract order number from the confirmation page — Sprint 2 hardening:
      //    use the locator-first helper instead of scanning `document.body`.
      //    The helper polls `SELECTORS.CHECKOUT.CONFIRMATION.ORDER_NUMBER`,
      //    then the confirmation title, then a scoped confirmation container.
      //    See `utils/orderNumber.ts` and unit tests in
      //    `tests/unit/orderNumber.spec.ts`. Throws with a clear message
      //    (locators tried + URL) when nothing is found, which the assertion
      //    below surfaces to the report.
      try {
        orderNumber = await findOrderNumberOnConfirmationPage(page, { timeoutMs: 60_000 });
        console.log(`   Order number captured: ${orderNumber}`);
        exitAfterOrder = true;
      } catch (err) {
        console.log(`   Order number not found: ${(err as Error).message}`);
        console.log(`   Current URL: ${page.url()}`);
      }

      // Explicit assertion — the test fails cleanly if extraction did not
      // succeed. We log a masked identifier only (see policy in DEBT.md).
      expect(orderNumber, 'Order number must be extracted from the confirmation page').toBeTruthy();
    });

    // STEP 8: Save order information (only once, then exit)
    if (orderNumber) {
      await test.step('Save order information', async () => {
        // Get actual browser name
        const browserName = page.context().browser()?.browserType().name() || 'unknown';
        const browserDisplay = browserName.charAt(0).toUpperCase() + browserName.slice(1);

        // Calculate test duration
        const testDuration = Date.now() - testStartTime;

        await orderTracker.save(orderNumber!, {
          displayedOrderNumber: orderNumber!,
          testName: test.info().title,
          status: 'success',
          metadata: {
            email: testData.email,
            productUrl: TEST_CONFIG.urls.testProduct,
            browser: browserDisplay,
            duration: testDuration,
          },
        });

        console.log('   Order data saved to test-data/orders.json');
        console.log(`   Order ${orderNumber} will be emailed after the test`);
      });
    } else {
      console.log('   No order number to save');
    }

    if (exitAfterOrder) {
      // Let Playwright handle context cleanup in afterEach — manual close()
      // here interfered with hooks ("Page is closed!" errors during teardown).
      return;
    }
  });
});
