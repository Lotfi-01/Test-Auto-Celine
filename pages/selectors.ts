/**
 * Centralized Selectors
 * Single source of truth for all page element selectors
 * Makes maintenance easier and reduces duplication
 */

export const SELECTORS = {
  /**
   * Checkout page selectors - organized by step
   */
  CHECKOUT: {
    // ===== LOGIN STEP =====
    LOGIN: {
      EMAIL_INPUT: '#login-form-email, input[name="loginEmail"], input[type="email"]',
      CONTINUE_BUTTON:
        'button[data-ocheckoutlogin-continue], button.o-form__action__continue[type="submit"], button.o-form__action__continue',
      GUEST_CHECKOUT:
        'button[class*="guest"], button[data-testid*="guest"], button:has-text("Guest"), button:has-text("Invité")',
      PASSWORD_INPUT: '#login-form-password, input[name="loginPassword"], input[type="password"][name*="loginPassword"]',
      LOGIN_SUBMIT_BUTTON: 'button[data-login="SIGN IN"], button.o-form__action__submit[type="submit"]',
    },

    // ===== SHIPPING STEP =====
    SHIPPING: {
      // Postal code entry (unlocks shipping methods)
      ZIPCODE_INPUT:
        'input#zipCodeForShippingMethods, input.shippingZipCode, input[name="dwfrm_shipping_shippingAddress_addressFields_postalCode"]',
      ZIPCODE_OK_BUTTON: 'button[type="submit"], button[class*="ok-btn"], button:has-text("OK")',
      ZIPCODE_OK_LINK: 'a[class*="ok"], span[class*="ok"], a:has-text("OK"), span:has-text("OK")',

      // Shipping method selection
      SHIPPING_METHOD_RADIO: 'input[type="radio"][id*="shipping" i]:not([disabled])',
      SHIPPING_METHOD_CHECKBOX: 'input[type="checkbox"][id*="shipping" i]:not([disabled])',
      SHIPPING_METHOD_BY_NAME: 'input[name="dwfrm_shipping_shippingAddress_shippingMethodID"]',

      // Title selection
      TITLE_MR_LABEL: 'label[for="shippingmr"]',
      TITLE_MRS_LABEL: 'label[for="shippingmrs"]',
      TITLE_MS_LABEL: 'label[for="shippingms"]',
      TITLE_MR_INPUT: '#shippingmr',
      TITLE_MRS_INPUT: '#shippingmrs',
      TITLE_MS_INPUT: '#shippingms',

      // Address form - use specific IDs first, then class selectors
      FIRST_NAME: 'input#shippingFirstNamedefault',
      LAST_NAME: 'input#shippingLastNamedefault',
      FIRST_NAME_KATAKANA:
        'input#shippingcelFirstnameAlternate, input[name*="celFirstnameAlternate"], input[name*="firstNameKatakana"], input.japaneseTextKatakana[name*="Firstname"]',
      LAST_NAME_KATAKANA:
        'input#shippingcelLastnameAlternate, input[name*="celLastnameAlternate"], input[name*="lastNameKatakana"], input.japaneseTextKatakana[name*="Lastname"]',
      ADDRESS: 'input#shippingAddressOnedefault, input.shippingAddressOne',
      ADDRESS_2: 'input#shippingAddressTwodefault, input[name*="address2"]',
      CITY: 'input#shippingAddressCitydefault, input[name*="city"]',
      COUNTRY: 'select#shippingCountrydefault, select[name*="country"]',
      PREFECTURE: 'select#shippingStatedefault',
      ZIPCODE_ADDRESS_FIELD: 'input#shippingZipCodedefault',
      PHONE_PREFIX: 'select#phonePrefix',
      PHONE: 'input#shippingPhoneNumberdefault, input[name*="phone"]',

      // Navigation
      VALIDATE_ADDRESS_BUTTON:
        'button#submitAddressShipping, button.submit-address[type="submit"], button[name="submit"][value="submit-address"], button[class*="submit-address"], button[type="submit"][class*="address"], button:has-text("VALIDER")',
      CONTINUE_BUTTON:
        'button[type="submit"][class*="shipping"], button[data-testid*="continue"], button:has-text("Continuer"), button:has-text("Continue")',
      SUBMIT_SHIPPING_BUTTON: '#submitShippingBtn, button.submit-shipping, button[name="submit"][value="submit-shipping"]',

      // Section headers
      DELIVERY_HEADER: 'h2:has-text("DELIVERY"), h2:has-text("LIVRAISON"), [class*="shipping"]',
    },

    // ===== PAYMENT STEP =====
    PAYMENT: {
      // Payment method selection
      // Updated for current NL/FR site variations - include text-based and role-based
      CREDIT_CARD_LABEL: 'label#lb_scheme, label[for="rb_scheme"], label.m-field__label--radio[for="rb_scheme"], label:has-text("CREDIT CARD"), label:has-text("Credit Card"), label:has-text("Kaart"), [role="radio"]:has-text("credit"), label:has-text("CARTE")',
      CREDIT_CARD_INPUT: 'input[id="rb_scheme"], #rb_scheme, input[type="radio"][name*="credit"], input[type="radio"][value*="card"]',
      CREDIT_CARD_TEXT: 'label:has-text("CARTE DE CRÉDIT"), label:has-text("Carte bancaire"), label:has-text("CREDIT CARD"), label:has-text("Credit Card")',
      PAYMENT_HEADER: 'h2:has-text("PAIEMENT"), h2:has-text("Payment"), h2:has-text("BETALING"), button:has-text("PAIEMENT"), button:has-text("Payment"), [class*="payment"]:has-text("PAIEMENT"), [class*="payment"]:has-text("Payment")',

      // Card fields (non-iframe)
      CARDHOLDER_NAME: 'input[name="holderName"], input.adyen-checkout__card__holderName__input',

      // Installment payment (Japan-specific)
      INSTALLMENT_METHOD: 'select#installmentPaymentMethods, select[name="payment_methods"]',
      NUMBER_OF_PAYMENTS: 'select#numberOfTimes, select[name="number_of_times"]',

      // Terms & conditions
      TERMS_CHECKBOX: 'input#privacy\\.policy, input[id="privacy.policy"], input[type="checkbox"][id*="privacy"]',

      // Submit
      PLACE_ORDER_BUTTON:
        '#showSubmitPayment, button.submit-payment[type="submit"], button.a-btn--primary.submit-payment, button[type="submit"]:has-text("Place Order")',
    },

    // Adyen iframe selectors (by title attribute)
    ADYEN_IFRAMES: {
      CARD_NUMBER: 'iframe[title="Iframe for card number"]',
      EXPIRY_DATE: 'iframe[title="Iframe for expiry date"]',
      SECURITY_CODE: 'iframe[title="Iframe for security code"]',
    },

    // ===== CONFIRMATION STEP =====
    CONFIRMATION: {
      TITLE: 'h2.f-title, h1:has-text("Thank"), h1:has-text("Merci")',
      ORDER_NUMBER: 'h2.f-title, [class*="order-number"], .order-confirmation__number',
      ORDER_NUMBER_PATTERN: /#([A-Z0-9]+(?:-\d+)?)/,
    },
  },

  /**
   * Product page selectors
   */
  PRODUCT: {
    TITLE: 'h1, [class*="product-name"], [class*="product-title"]',
    PRICE: '[class*="price"]',
    SIZE_SELECTOR: '[class*="size-selector"] button, button[class*="size"]',
    SIZE_SELECTOR_RADIO: 'input[name="selector-size"][type="radio"]',
    SIZE_SELECTOR_LABEL:
      'label[data-gtm-track-interaction-type="Size Selector"], label.m-selector__item[for^="selector-size"]',
    COLOR_SELECTOR: '[class*="color-selector"] button, button[class*="color"]',
    ADD_TO_CART:
      'button.add-to-cart[type="submit"][form="form-product"], form#form-product button.add-to-cart, button.add-to-cart[type="submit"]',
    BUY_NOW: 'button.add-to-cart-buy-now, button[type="button"].add-to-cart-buy-now',
  },

  /**
   * Cart page selectors
   */
  CART: {
    ICON: '.minicart',
    TITLE: 'h2, [class*="cart-title"]',
    CHECKOUT_BUTTON: 'button.a-btn.checkout-btn[type="submit"], button.checkout-btn, button.checkout, a[href*="checkout"]',
    ITEM_QUANTITY: 'input[name*="quantity"]',
    REMOVE_ITEM: 'button[class*="remove"], a[class*="remove"]',
  },

  /**
   * Common/shared selectors
   */
  COMMON: {
    SUBMIT_BUTTON: 'button[type="submit"]',
    CLOSE_BUTTON: 'button[aria-label="Close"], button.close',
    LOADING_SPINNER: '.loader, .spinner, [class*="loading"]',
    ERROR_MESSAGE: '.error, .alert-error, [class*="error-message"]',
    SUCCESS_MESSAGE: '.success, .alert-success, [class*="success-message"]',
  },

  /**
   * Navigation selectors
   */
  NAV: {
    HOME_LINK: 'h1 a[href*="/home"]',
    SEARCH: 'input[type="search"], [class*="search-input"]',
    ACCOUNT: '[class*="account"], a[href*="account"]',
    WISHLIST: '[class*="wishlist"], a[href*="wishlist"]',
  },
} as const;

/**
 * Helper function to combine multiple selectors with comma
 * Useful when you want to try multiple selectors in order
 */
export function combineSelectors(...selectors: string[]): string {
  return selectors.join(', ');
}

/**
 * Helper function to create a data-testid selector
 */
export function testId(id: string): string {
  return `[data-testid="${id}"]`;
}

/**
 * Helper function to create a text content selector
 */
export function hasText(text: string): string {
  return `:has-text("${text}")`;
}
