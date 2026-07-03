import { Page, Locator } from '@playwright/test';
import { TIMEOUTS } from '../config/testConfig';
// Inline Result types (formerly in utils/result.ts — removed as standalone module)
type Result<T, E = Error> = { success: true; value: T } | { success: false; error: E };
function ok<T>(value: T): Result<T, never> {
  return { success: true, value };
}
function fail<E>(error: E): Result<never, E> {
  return { success: false, error };
}
async function tryAsync<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e instanceof Error ? e : new Error(String(e)));
  }
}
interface FieldResult {
  fieldName: string;
  filled: boolean;
  error?: string;
}
interface FormFillResult {
  success: boolean;
  results: FieldResult[];
  failedFields: string[];
}
function createFormResult(results: FieldResult[]): FormFillResult {
  const failedFields = results.filter((r) => !r.filled).map((r) => r.fieldName);
  return { success: failedFields.length === 0, results, failedFields };
}
import { TestLogger } from './logger';

/**
 * Form Helper Utilities
 *
 * Centralized form filling logic extracted from page objects.
 * Reduces code duplication and provides consistent error handling.
 */

const logger = TestLogger.scoped('FormHelper');

/**
 * Options for filling a form field
 */
export interface FillFieldOptions {
  /** Clear field before filling */
  clear?: boolean;
  /** Scroll into view before filling */
  scroll?: boolean;
  /** Press Tab after filling to trigger validation */
  pressTab?: boolean;
  /** Custom timeout */
  timeout?: number;
  /** Force visibility (for hidden fields) */
  forceVisible?: boolean;
}

/**
 * Options for clicking a form element
 */
export interface ClickOptions {
  /** Force click even if element is covered */
  force?: boolean;
  /** Custom timeout */
  timeout?: number;
  /** Number of retry attempts */
  retries?: number;
  /** Try clicking associated label if direct click fails */
  tryLabel?: boolean;
}

/**
 * Safely fill a form field with comprehensive error handling
 *
 * @param locator - Playwright Locator for the field
 * @param value - Value to fill
 * @param fieldName - Name for logging and error messages
 * @param options - Fill options
 * @returns Result indicating success or failure
 */
export async function fillField(
  locator: Locator,
  value: string,
  fieldName: string,
  options: FillFieldOptions = {}
): Promise<Result<void, Error>> {
  const { clear = true, scroll = true, pressTab = false, timeout = TIMEOUTS.element, forceVisible = false } = options;

  return tryAsync(async () => {
    // Wait for element to be attached
    await locator.waitFor({ state: 'attached', timeout });

    // Force visibility if needed
    if (forceVisible) {
      await forceElementVisible(locator);
    }

    // Scroll into view
    if (scroll) {
      await locator.scrollIntoViewIfNeeded().catch(() => {});
    }

    // Clear existing value
    if (clear) {
      await locator.clear().catch(() => {});
    }

    // Fill the value
    await locator.fill(value);

    // Trigger validation
    if (pressTab) {
      await locator.press('Tab');
    }

    logger.success(`${fieldName} filled`);
  });
}

/**
 * Fill multiple form fields at once
 *
 * @param page - Playwright Page
 * @param fields - Array of field definitions
 * @returns FormFillResult with status of each field
 */
export async function fillMultipleFields(
  page: Page,
  fields: Array<{
    selector: string;
    value: string;
    name: string;
    options?: FillFieldOptions;
  }>
): Promise<FormFillResult> {
  const results: FieldResult[] = [];

  for (const field of fields) {
    const locator = page.locator(field.selector).first();
    const result = await fillField(locator, field.value, field.name, field.options);

    results.push({
      fieldName: field.name,
      filled: result.success,
      error: result.success ? undefined : result.error.message,
    });
  }

  return createFormResult(results);
}

/**
 * Safely click a form element (button, radio, checkbox)
 * with retry logic and label fallback
 *
 * @param locator - Playwright Locator for the element
 * @param elementName - Name for logging
 * @param options - Click options
 * @returns Result indicating success or failure
 */
export async function clickElement(
  locator: Locator,
  elementName: string,
  options: ClickOptions = {}
): Promise<Result<void, Error>> {
  const { force = false, timeout = TIMEOUTS.element, retries = 3, tryLabel = true } = options;

  const page = locator.page();

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await locator.waitFor({ state: 'visible', timeout });
      await locator.scrollIntoViewIfNeeded();
      await locator.click({ force, timeout: TIMEOUTS.short });
      logger.success(`${elementName} clicked`);
      return ok(undefined);
    } catch (error) {
      logger.warn(`Click failed (attempt ${attempt}/${retries}): ${(error as Error).message}`);

      if (attempt === retries && tryLabel) {
        // Try clicking the associated label
        const labelResult = await clickAssociatedLabel(locator, page);
        if (labelResult.success) {
          logger.success(`${elementName} clicked via label`);
          return ok(undefined);
        }
      }

      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.animation));
      }
    }
  }

  return fail(new Error(`Failed to click ${elementName} after ${retries} attempts`));
}

/**
 * Click the label associated with an input element
 * Useful for radio buttons and checkboxes where the input is hidden
 */
async function clickAssociatedLabel(inputLocator: Locator, page: Page): Promise<Result<void, Error>> {
  return tryAsync(async () => {
    const inputId = await inputLocator.getAttribute('id');
    if (!inputId) {
      throw new Error('Input has no ID for label lookup');
    }

    const label = page.locator(`label[for="${inputId}"]`).first();
    if (await label.isVisible({ timeout: TIMEOUTS.short })) {
      await label.click({ force: true });
    } else {
      throw new Error(`Label for ${inputId} not visible`);
    }
  });
}

/**
 * Force an element to be visible by removing hidden styles
 * Use sparingly - prefer proper selectors when possible
 */
export async function forceElementVisible(locator: Locator): Promise<void> {
  await locator.evaluate((el: HTMLElement) => {
    // Remove hidden styles from element
    el.style.removeProperty('display');
    el.style.removeProperty('visibility');
    el.style.removeProperty('opacity');
    el.removeAttribute('hidden');

    // Expand parent containers
    let parent = el.parentElement;
    while (parent) {
      parent.style.removeProperty('display');
      parent.style.removeProperty('visibility');
      parent.removeAttribute('hidden');

      // Handle Bootstrap collapse
      if (parent.classList.contains('collapse') || parent.classList.contains('collapsed')) {
        parent.classList.remove('collapse', 'collapsed');
        parent.classList.add('show');
      }

      parent = parent.parentElement;
    }
  });

  await locator.scrollIntoViewIfNeeded();
}

/**
 * Select an option from a dropdown
 *
 * @param locator - Select element locator
 * @param value - Value to select
 * @param fieldName - Name for logging
 * @param options - Additional options
 */
export async function selectDropdownOption(
  locator: Locator,
  value: string,
  fieldName: string,
  options: { timeout?: number } = {}
): Promise<Result<void, Error>> {
  const { timeout = TIMEOUTS.element } = options;

  return tryAsync(async () => {
    const isVisible = await locator.isVisible({ timeout });
    if (!isVisible) {
      throw new Error(`${fieldName} dropdown not visible`);
    }

    await locator.selectOption(value);
    logger.success(`${fieldName} selected: ${value}`);
  });
}

/**
 * Check or uncheck a checkbox
 *
 * @param locator - Checkbox locator
 * @param fieldName - Name for logging
 * @param shouldCheck - Whether to check (true) or uncheck (false)
 */
export async function toggleCheckbox(
  locator: Locator,
  fieldName: string,
  shouldCheck: boolean = true
): Promise<Result<void, Error>> {
  return tryAsync(async () => {
    await locator.waitFor({ state: 'visible', timeout: TIMEOUTS.element });
    await locator.scrollIntoViewIfNeeded();

    const isChecked = await locator.isChecked();

    if (shouldCheck && !isChecked) {
      await locator.check({ force: true });
      logger.success(`${fieldName} checked`);
    } else if (!shouldCheck && isChecked) {
      await locator.uncheck({ force: true });
      logger.success(`${fieldName} unchecked`);
    } else {
      logger.info(`${fieldName} already ${shouldCheck ? 'checked' : 'unchecked'}`);
    }
  });
}

/**
 * Wait for a form to be ready (all fields attached to DOM)
 *
 * @param page - Playwright Page
 * @param requiredSelectors - Selectors that must be present
 * @param timeout - Maximum wait time
 */
export async function waitForFormReady(
  page: Page,
  requiredSelectors: string[],
  timeout: number = TIMEOUTS.element
): Promise<Result<void, Error>> {
  return tryAsync(async () => {
    const startTime = Date.now();

    for (const selector of requiredSelectors) {
      const remaining = timeout - (Date.now() - startTime);
      if (remaining <= 0) {
        throw new Error('Timeout waiting for form fields');
      }

      await page.locator(selector).first().waitFor({
        state: 'attached',
        timeout: remaining,
      });
    }

    logger.success('Form ready');
  });
}

/**
 * Validate that a field contains expected value
 *
 * @param locator - Field locator
 * @param expectedValue - Expected value
 * @param fieldName - Name for error messages
 */
export async function validateFieldValue(
  locator: Locator,
  expectedValue: string,
  fieldName: string
): Promise<Result<boolean, Error>> {
  return tryAsync(async () => {
    const actualValue = await locator.inputValue();
    if (actualValue !== expectedValue) {
      throw new Error(`${fieldName} validation failed. Expected: "${expectedValue}", Got: "${actualValue}"`);
    }
    return true;
  });
}

/**
 * Sets the value of an input/select element using the native prototype setter.
 * This bypasses many framework (React/Vue) input handlers that can cause
 * re-renders, autocomplete, or field clearing during typing.
 * 
 * Always dispatches input/change/blur by default for Celine's custom forms.
 */
export async function setNativeValue(
  locator: Locator,
  value: string,
  options: { dispatchEvents?: boolean; blur?: boolean } = {}
): Promise<void> {
  const { dispatchEvents = true, blur = true } = options;

  await locator.evaluate((el: HTMLInputElement | HTMLSelectElement, val) => {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
      setter.call(el, val);
    } else {
      (el as any).value = val;
    }

    if (dispatchEvents) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (blur) {
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }
  }, value);
}

/**
 * Force-checks a radio button in a way that works with Celine's custom styling
 * (where normal .check() or label clicks are swallowed).
 * Uses prototype setter + multiple events + direct click.
 */
export async function forceCheckRadio(locator: Locator): Promise<void> {
  await locator.evaluate((el: HTMLInputElement) => {
    if (el.checked) return;

    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'checked')?.set;
    if (setter) {
      setter.call(el, true);
    } else {
      el.checked = true;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.click();
  });
}
