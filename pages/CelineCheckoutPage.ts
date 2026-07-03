import { Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { CheckoutLoginPage } from './checkout/CheckoutLoginPage';
import { CheckoutShippingPage } from './checkout/CheckoutShippingPage';
import { CheckoutPaymentPage } from './checkout/CheckoutPaymentPage';

/**
 * Celine Checkout Page - Facade Pattern
 * Coordinates login, shipping, and payment steps.
 *
 * Use sub-pages directly for individual step interactions:
 *   checkoutPage.login.fillEmail(...)
 *   checkoutPage.shipping.fillShippingAddress(...)
 *   checkoutPage.payment.placeOrder()
 */
export class CelineCheckoutPage extends BasePage {
  readonly login: CheckoutLoginPage;
  readonly shipping: CheckoutShippingPage;
  readonly payment: CheckoutPaymentPage;

  constructor(page: Page) {
    super(page, 'Checkout');

    this.login = new CheckoutLoginPage(page);
    this.shipping = new CheckoutShippingPage(page);
    this.payment = new CheckoutPaymentPage(page);
  }

  /**
   * Check if currently on checkout page
   */
  async isOnCheckoutPage(): Promise<boolean> {
    const url = this.page.url();
    return url.includes('checkout') || url.includes('paiement');
  }
}
