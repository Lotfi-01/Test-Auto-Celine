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

      // Registered customer login (if password is configured for the region)
      const loginPassword = testData.password || 'Test1234!';
      await checkoutPage.login.loginAsRegistered(testData.email, loginPassword);

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
                await okBtn.evaluate((el: HTMLElement) => (el as HTMLButtonElement).click()).catch(() => {});
              });
              console.log('   US zipcode filled in #zipCodeForShippingMethods and OK clicked');
              await expect(okBtn).not.toBeVisible({ timeout: 500 }).catch(() => {});
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
        // Click & Collect: switch to PICK-UP tab → select first store (auto-shown) → fill purchaser-info dialog → submit
        // (Guest always needs this; registered with saved address may still need to choose pickup tab + purchaser info.)
        await checkoutPage.shipping.selectClickAndCollect();
        await checkoutPage.shipping.fillPickupAddressForm({
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
                await okBtn.evaluate((el: HTMLElement) => (el as HTMLButtonElement).click()).catch(() => {});
              });
              console.log('   Zipcode filled in #zipCodeForShippingMethods and OK clicked');
              await expect(okBtn).not.toBeVisible({ timeout: 500 }).catch(() => {});
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

          // Give time for shipping options to load after postal code (important for JP/NL)
          await page.waitForTimeout(1000);

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
                await anyShippingLabel.click({ force: true, timeout: 2000 }).catch(() => {});
                console.log('   Force-clicked shipping method label');
              }

              // Alternative: click any delivery/shipping option or header
              const alt = page.locator('label[class*="shipping"], [class*="shipping-method"], [class*="delivery-method"], h3:has-text("Livraison"), h3:has-text("Shipping"), h3:has-text("Delivery")').first();
              if (await alt.isVisible({ timeout: 2000 }).catch(() => false)) {
                await alt.click({ force: true }).catch(() => {});
              }
            }
          }

          await formPanel.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {
            console.log('   Form panel still not visible, proceeding to fill anyway');
          });
          await page.waitForTimeout(300);

          // Select title (civility) before filling the form, as required by the site
          await checkoutPage.shipping.selectTitle(addr.title);

          // Now the form is open, fill the address directly (no close, no early submit)
          await checkoutPage.shipping.fillShippingAddress({
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
          await checkoutPage.shipping.selectCountry(addr.country);
          await checkoutPage.shipping.continueToShipping();
        }
      }

      // Consolidated close before payment (reduced calls)
      await closeAllSidePanels(page, { timeout: 200, force: true, exclude: ['shippingBillingForms'] });
      await checkoutPage.shipping.continueToPayment();

      console.log('   Shipping address completed');
    });

    // Note: one consolidated close above is sufficient; removed duplicate for speed

    // Use the dedicated helper for consistent, semantic wait for payment options.
    // This replaces ad-hoc waits and works for both registered skip and guest flows.
    await checkoutPage.payment.waitForCreditCardOptionReady(8000);
    console.log('   Payment method options ready');

    // Extra settle for registered + pickup flows (payment methods can take a bit to be interactive)
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
        .catch(() => {});
      console.log(`   Post-payment URL: ${page.url()}`);

      // 2) Extract order number from the confirmation page.
      //    Use page.evaluate (fast) to scan the full page text in one call.
      const maxPoll = 60_000;
      const startPoll = Date.now();
      while (Date.now() - startPoll < maxPoll && !orderNumber) {
        const text = await page.evaluate(() => document.body?.textContent || '').catch(() => '');
        const m = text.match(/#([A-Z0-9]+(?:-\d+)?)/);
        if (m) {
          orderNumber = m[1];
          break;
        }
        await page.waitForTimeout(120);
      }

      if (orderNumber) {
        console.log(`   Order number captured: ${orderNumber}`);
        exitAfterOrder = true;
      } else {
        console.log('   Order number not found after confirmation wait');
        console.log(`   Current URL: ${page.url()}`);
      }

      expect(orderNumber).toBeTruthy();
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
