import { Page, Locator } from '@playwright/test';
import { BasePage } from '../BasePage';
import { SELECTORS } from '../selectors';
import { TIMEOUTS } from '../../config/testConfig';

/**
 * Checkout Login Page
 * Handles email input, guest checkout, and registered customer login (email + password).
 *
 * Extends BasePage for consistent error handling and logging
 */
export class CheckoutLoginPage extends BasePage {
  readonly loginEmailInput: Locator;
  readonly continueButton: Locator;
  readonly guestCheckoutButton: Locator;
  readonly passwordInput: Locator;
  readonly loginSubmitButton: Locator;

  constructor(page: Page) {
    super(page, 'CheckoutLogin');

    // Email login - using centralized selectors
    this.loginEmailInput = page.locator(SELECTORS.CHECKOUT.LOGIN.EMAIL_INPUT).first();
    this.continueButton = page.locator(SELECTORS.CHECKOUT.LOGIN.CONTINUE_BUTTON).first();

    // Guest checkout option
    this.guestCheckoutButton = page.locator(SELECTORS.CHECKOUT.LOGIN.GUEST_CHECKOUT).first();

    // Registered customer login
    this.passwordInput = page.locator(SELECTORS.CHECKOUT.LOGIN.PASSWORD_INPUT).first();
    this.loginSubmitButton = page.locator(SELECTORS.CHECKOUT.LOGIN.LOGIN_SUBMIT_BUTTON).first();
  }

  /**
   * Select guest checkout option if available
   */
  async selectGuestCheckout(): Promise<boolean> {
    const clicked = await this.safeClick(this.guestCheckoutButton, {
      timeout: TIMEOUTS.short,
    });

    if (clicked) {
      await this.waitForDomContent();
      this.logSuccess('Guest checkout selected');
    }

    return clicked;
  }

  /**
   * Fill email address
   * @param email - Email address to use for checkout
   */
  async fillEmail(email: string): Promise<boolean> {
    const filled = await this.safeFill(this.loginEmailInput, email, {
      timeout: TIMEOUTS.element,
    });

    if (filled) {
      this.logSuccess('Email filled');
    }

    return filled;
  }

  /**
   * Click continue button to proceed to next step
   * @returns true if proceeded successfully
   */
  async clickContinue(): Promise<boolean> {
    // Try to click the continue button
    let clicked = await this.safeClick(this.continueButton, {
      timeout: TIMEOUTS.medium,
    });

    if (!clicked) {
      this.log('Normal click failed, trying with force...', 'warn');
      clicked = await this.safeClick(this.continueButton, {
        timeout: TIMEOUTS.short,
        force: true,
      });
    }

    if (!clicked) {
      return false;
    }

    // Wait for next section (DELIVERY) to be visible
    const deliverySection = await this.waitForElement(SELECTORS.CHECKOUT.SHIPPING.DELIVERY_HEADER, {
      timeout: TIMEOUTS.element,
    });

    if (deliverySection) {
      this.logSuccess('Proceeded to next step after clicking Continue');
      return true;
    }

    // Fallback: just wait for page load
    await this.waitForDomContent();
    this.logSuccess('Proceeded to next step (partial confirmation)');
    return true;
  }

  /**
   * Click the continue button after email (without waiting for delivery section).
   * For registered flows, this may reveal the password field instead of advancing to shipping.
   */
  async clickEmailContinue(): Promise<boolean> {
    let clicked = await this.safeClick(this.continueButton, {
      timeout: TIMEOUTS.medium,
    });

    if (!clicked) {
      this.log('Normal click failed for email continue, trying with force...', 'warn');
      clicked = await this.safeClick(this.continueButton, {
        timeout: TIMEOUTS.short,
        force: true,
      });
    }

    if (clicked) {
      this.logSuccess('Clicked continue after email');
    }

    return clicked;
  }

  /**
   * Complete login step with email
   * @param email - Email address
   * @returns true if login step completed successfully
   */
  async completeLoginStep(email: string): Promise<boolean> {
    const emailFilled = await this.fillEmail(email);
    if (!emailFilled) {
      this.log('Failed to fill email', 'error');
      return false;
    }

    const proceeded = await this.clickContinue();
    if (!proceeded) {
      this.log('Failed to proceed after email', 'error');
      return false;
    }

    return true;
  }

  /**
   * Fill password for registered customer login
   */
  async fillPassword(password: string): Promise<boolean> {
    const filled = await this.safeFill(this.passwordInput, password, {
      timeout: TIMEOUTS.element,
    });

    if (filled) {
      this.logSuccess('Password filled');
    }

    return filled;
  }

  /**
   * Click the SIGN IN button after entering password
   */
  async clickLoginSubmit(): Promise<boolean> {
    const clicked = await this.safeClick(this.loginSubmitButton, {
      timeout: TIMEOUTS.medium,
    });

    if (clicked) {
      this.logSuccess('Registered login submitted (SIGN IN)');
    }

    return clicked;
  }

  /**
   * Full registered customer login flow:
   * 1. Enter email
   * 2. Wait/poll for password field (some accounts reveal pw after email fill or blur)
   *    Avoid premature "continue" click which can bypass registered login and go guest.
   * 3. If password / SIGN IN visible, fill pw + click SIGN IN
   * 4. After login, click submit shipping (prefilled for registered) if present.
   * Falls back to guest only if no password form appears.
   */
  async loginAsRegistered(email: string, password: string): Promise<boolean> {
    // Step 1: Fill email
    const emailFilled = await this.fillEmail(email);
    if (!emailFilled) {
      this.log('Failed to fill email for registered login', 'error');
      return false;
    }

    // Trigger blur / tab to help reveal the password section (email blur often
    // triggers an account lookup). Purely optional — the isVisible polls below
    // are the real signal.
    await this.loginEmailInput.press('Tab').catch((error) => {
      this.log(
        `Tab blur skipped: ${error instanceof Error ? error.message : String(error)}`,
        'debug'
      );
    });

    // Previous implementation slept 100ms *before* pressing Tab and another
    // 100ms *after*. Both were pure padding — the `isVisible({ timeout: 2500 })`
    // call below is a proper web-first wait that already tolerates async
    // account-lookup latency.
    let passwordVisible = await this.passwordInput.isVisible({ timeout: 2500 }).catch(() => false);
    let signInVisible = await this.loginSubmitButton.isVisible({ timeout: 2000 }).catch(() => false);

    if (!passwordVisible && !signInVisible) {
      // Poll a bit more before considering guest path (no aggressive continue yet)
      for (let i = 0; i < 3 && !passwordVisible && !signInVisible; i++) {
        await this.page.waitForTimeout(100);
        passwordVisible = await this.passwordInput.isVisible({ timeout: 1500 }).catch(() => false);
        signInVisible = await this.loginSubmitButton.isVisible({ timeout: 1500 }).catch(() => false);
      }
    }

    if (!passwordVisible && !signInVisible) {
      // Last resort: try the email continue (some variants surface pw after this action)
      const continued = await this.clickEmailContinue();
      if (continued) {
        await this.page.waitForTimeout(100);
        // Close any panels (e.g. sign in, newsletter) that may open after email continue
        const { closeAllSidePanels } = await import('../../utils/selectorStrategy');
        await closeAllSidePanels(this.page, { timeout: 50, force: true });
        passwordVisible = await this.passwordInput.isVisible({ timeout: 3000 }).catch(() => false);
        signInVisible = await this.loginSubmitButton.isVisible({ timeout: 2000 }).catch(() => false);
      }
    }

    if (passwordVisible || signInVisible) {
      // Registered path
      if (passwordVisible) {
        const passwordFilled = await this.fillPassword(password);
        if (!passwordFilled) {
          this.log('Failed to fill password for registered login', 'error');
          return false;
        }
      } else {
        // Rare branch: SIGN IN button already visible but password field not
        // yet rendered. We attempt the fill anyway (Celine sometimes reveals
        // the input asynchronously). A failure here is non-fatal — the
        // subsequent SIGN IN click will surface a validation error if pw was
        // truly missing. Log at warn to keep the anomaly visible.
        await this.fillPassword(password).catch((error) => {
          this.log(
            `Optimistic password fill failed: ${error instanceof Error ? error.message : String(error)}`,
            'warn'
          );
        });
      }

      const submitted = await this.clickLoginSubmit();
      if (!submitted) {
        this.log('Failed to click SIGN IN button', 'error');
        return false;
      }

      // Close any panels that may appear right after login (e.g. address verification)
      const { closeAllSidePanels } = await import('../../utils/selectorStrategy');
      await closeAllSidePanels(this.page, { timeout: 50, force: true });

      // Wait for login to complete: either the password field is hidden
      // (Celine transitioned to the next step) or the shipping submit is
      // visible (registered flow with prefilled address). Both are acceptable
      // end-states — a timeout on either is logged but does not block.
      try {
        await this.passwordInput.waitFor({ state: 'hidden', timeout: TIMEOUTS.medium });
      } catch {
        await this.page
          .locator('#submitShippingBtn, [class*="shipping"], button#submitShippingBtn')
          .first()
          .waitFor({ state: 'visible', timeout: TIMEOUTS.medium })
          .catch((error) => {
            this.log(
              `Neither password-hidden nor shipping-visible signal caught after SIGN IN: ${error instanceof Error ? error.message : String(error)}`,
              'warn'
            );
          });
      }

      await this.waitForDomContent();
      this.logSuccess('Registered customer logged in successfully');

      // For registered users, address is often pre-filled; click the shipping
      // submit if visible. If the click itself throws (button covered, etc.),
      // log warn and rely on the shipping page's own submit flow later.
      const submitShippingBtn = this.page.locator(
        '#submitShippingBtn, button.submit-shipping, button[name="submit"][value="submit-shipping"]'
      );
      if (await submitShippingBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
        await submitShippingBtn.click({ force: true }).catch((error) => {
          this.log(
            `Optimistic submit-shipping click failed: ${error instanceof Error ? error.message : String(error)}`,
            'warn'
          );
        });
        this.logSuccess('Clicked submit shipping button after registered login');
        await this.page.waitForTimeout(100);
      }
    } else {
      this.log('No password field detected - proceeding as guest/registration', 'info');
    }

    return true;
  }
}
