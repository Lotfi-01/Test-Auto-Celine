import { Page, Frame } from '@playwright/test';
import { logger } from './logger';
import { TIMEOUTS } from '../config/testConfig';

/**
 * Adyen field types for iframe fields
 */
export type AdyenFieldType = 'cardNumber' | 'expiryDate' | 'cvv';

/**
 * Mapping of field types to Adyen data-fieldtype attributes
 */
const ADYEN_FIELD_SELECTORS: Record<AdyenFieldType, string> = {
  cardNumber: 'input[data-fieldtype="encryptedCardNumber"]',
  expiryDate: 'input[data-fieldtype="encryptedExpiryDate"]',
  cvv: 'input[data-fieldtype="encryptedSecurityCode"]',
};

/**
 * Adyen Helper
 * Provides utilities for interacting with Adyen payment iframes
 *
 * Adyen uses iframes for secure payment fields (card number, expiry, CVV).
 * This helper abstracts the iframe-finding logic and provides a clean API.
 *
 * Usage:
 *   import { AdyenHelper } from '../utils/adyenHelper';
 *   await AdyenHelper.fillCardNumber(page, '4111111111111111');
 *   await AdyenHelper.fillExpiryDate(page, '03/30');
 *   await AdyenHelper.fillCvv(page, '737');
 */
export class AdyenHelper {
  private static readonly IFRAME_TIMEOUT = 5000;
  private static readonly FILL_TIMEOUT = 3000;

  /**
   * Find the Adyen iframe containing a specific field type
   * @param page - Playwright Page object
   * @param fieldType - Type of field to find
   * @returns Frame if found, null otherwise
   */
  static async findAdyenFrame(page: Page, fieldType: AdyenFieldType): Promise<Frame | null> {
    const selector = ADYEN_FIELD_SELECTORS[fieldType];
    const frames = page.frames();

    for (const frame of frames) {
      try {
        const locator = frame.locator(selector);
        const count = await locator.count();
        if (count > 0) {
          logger.debug(`Found Adyen frame for ${fieldType}`);
          return frame;
        }
      } catch {
        // Frame might have been detached, continue to next
        continue;
      }
    }

    return null;
  }

  /**
   * Fill a field in an Adyen iframe by locating the frame via data-fieldtype
   * @param page - Playwright Page object
   * @param fieldType - Type of field to fill
   * @param value - Value to fill
   * @returns true if successful, false otherwise
   */
  static async fillIframeField(page: Page, fieldType: AdyenFieldType, value: string): Promise<boolean> {
    const inputSelector = ADYEN_FIELD_SELECTORS[fieldType];

    try {
      const frame = await this.findAdyenFrame(page, fieldType);

      if (!frame) {
        logger.warn(`Adyen frame for ${fieldType} not found`);
        return false;
      }

      const input = frame.locator(inputSelector).first();
      await input.fill(value, { timeout: this.FILL_TIMEOUT });

      logger.success(`${this.getFieldDisplayName(fieldType)} filled`);
      return true;
    } catch (error) {
      logger.error(`Failed to fill ${fieldType}`, error as Error);
      return false;
    }
  }

  /**
   * Fill card number in Adyen iframe
   */
  static async fillCardNumber(page: Page, cardNumber: string): Promise<boolean> {
    return this.fillIframeField(page, 'cardNumber', cardNumber);
  }

  /**
   * Fill expiry date in Adyen iframe
   */
  static async fillExpiryDate(page: Page, expiryDate: string): Promise<boolean> {
    return this.fillIframeField(page, 'expiryDate', expiryDate);
  }

  /**
   * Fill CVV in Adyen iframe
   */
  static async fillCvv(page: Page, cvv: string): Promise<boolean> {
    return this.fillIframeField(page, 'cvv', cvv);
  }

  /**
   * Fill all Adyen payment fields
   * @param page - Playwright Page object
   * @param options - Payment details
   * @returns Object with success status for each field
   */
  static async fillAllPaymentFields(
    page: Page,
    options: {
      cardNumber: string;
      expiryDate: string;
      cvv: string;
    }
  ): Promise<{
    cardNumber: boolean;
    expiryDate: boolean;
    cvv: boolean;
    allSuccessful: boolean;
  }> {
    const cardNumberSuccess = await this.fillCardNumber(page, options.cardNumber);
    const expiryDateSuccess = await this.fillExpiryDate(page, options.expiryDate);
    const cvvSuccess = await this.fillCvv(page, options.cvv);

    return {
      cardNumber: cardNumberSuccess,
      expiryDate: expiryDateSuccess,
      cvv: cvvSuccess,
      allSuccessful: cardNumberSuccess && expiryDateSuccess && cvvSuccess,
    };
  }

  /**
   * Wait for Adyen payment form to be ready
   * @param page - Playwright Page object
   * @param timeout - Maximum time to wait
   * @returns true if form is ready, false otherwise
   */
  static async waitForPaymentForm(page: Page, timeout: number = this.IFRAME_TIMEOUT): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const frame = await this.findAdyenFrame(page, 'cardNumber');
      if (frame) {
        logger.debug('Adyen payment form is ready');
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.focusDelay));
    }

    logger.warn('Adyen payment form not ready within timeout');
    return false;
  }

  /**
   * Get display name for field type (for logging)
   */
  private static getFieldDisplayName(fieldType: AdyenFieldType): string {
    const names: Record<AdyenFieldType, string> = {
      cardNumber: 'Card number',
      expiryDate: 'Expiration date',
      cvv: 'CVV',
    };
    return names[fieldType];
  }

  /**
   * Check if a specific Adyen field is present
   */
  static async isFieldPresent(page: Page, fieldType: AdyenFieldType): Promise<boolean> {
    const frame = await this.findAdyenFrame(page, fieldType);
    return frame !== null;
  }

  /**
   * Clear all Adyen payment fields
   */
  static async clearAllFields(page: Page): Promise<void> {
    const fieldTypes: AdyenFieldType[] = ['cardNumber', 'expiryDate', 'cvv'];

    for (const fieldType of fieldTypes) {
      try {
        const frame = await this.findAdyenFrame(page, fieldType);
        if (frame) {
          const selector = ADYEN_FIELD_SELECTORS[fieldType];
          const input = frame.locator(selector).first();
          await input.clear();
        }
      } catch {
        // Field might not be clearable
      }
    }
  }
}
