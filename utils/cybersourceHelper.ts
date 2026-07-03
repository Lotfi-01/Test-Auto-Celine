import { Page, Frame } from '@playwright/test';
import { logger } from './logger';

/**
 * Cybersource Flex Microform Helper
 *
 * Cybersource (TH region) uses iframes for the secure card number and CVV fields,
 * but expiration date and cardholder name are regular inputs in the page.
 *
 * Iframes are found by inspecting their content (aria-label) rather than by id/src,
 * because the iframe ids are dynamically generated tokens.
 */
export class CybersourceHelper {
  private static readonly IFRAME_TIMEOUT = 8000;
  private static readonly FILL_TIMEOUT = 3000;

  /**
   * Find the Cybersource iframe whose body contains an input matching the given selector.
   */
  private static async findFrameContaining(page: Page, inputSelector: string): Promise<Frame | null> {
    for (const frame of page.frames()) {
      try {
        const count = await frame.locator(inputSelector).count();
        if (count > 0) return frame;
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Wait for at least one Cybersource iframe to be ready (card number input present).
   */
  static async waitForPaymentForm(page: Page, timeout: number = this.IFRAME_TIMEOUT): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const frame = await this.findFrameContaining(page, 'input[aria-label="Card number" i]');
      if (frame) {
        logger.debug('Cybersource Flex card-number iframe ready');
        return true;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    logger.warn('Cybersource Flex form not ready within timeout');
    return false;
  }

  static async fillCardNumber(page: Page, value: string): Promise<boolean> {
    const frame = await this.findFrameContaining(page, 'input[aria-label="Card number" i]');
    if (!frame) {
      logger.warn('Cybersource frame for card number not found');
      return false;
    }
    try {
      const input = frame.locator('input[aria-label="Card number" i]').first();
      await input.fill(value, { timeout: this.FILL_TIMEOUT });
      logger.success('Card number filled (Cybersource)');
      return true;
    } catch (error) {
      logger.error('Failed to fill Cybersource card number', error as Error);
      return false;
    }
  }

  static async fillCvv(page: Page, value: string): Promise<boolean> {
    const frame = await this.findFrameContaining(
      page,
      'input[aria-label*="security code" i], input[aria-label*="card security" i]'
    );
    if (!frame) {
      logger.warn('Cybersource frame for CVV not found');
      return false;
    }
    try {
      const input = frame.locator('input[aria-label*="security code" i], input[aria-label*="card security" i]').first();
      await input.fill(value, { timeout: this.FILL_TIMEOUT });
      logger.success('CVV filled (Cybersource)');
      return true;
    } catch (error) {
      logger.error('Failed to fill Cybersource CVV', error as Error);
      return false;
    }
  }
}
